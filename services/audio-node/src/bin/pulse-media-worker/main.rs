//! `pulse-media-worker`: WebRTC/Opus listen transport for the local MVP (ADR 0026).
//!
//! The worker starts `pulse-device-capture` as its child, reads its PCM pipe, and serves each
//! browser listener one ICE-lite WebRTC session carrying a 10 ms mono Opus stream of the
//! selected input. The capture callback stays in the capture process; this process owns
//! only network-facing media work. The listen gateway controls it over stdin/stdout.

mod capture;
mod control;
mod session;

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, BufReader, ErrorKind};
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::process::{Child, Command as ProcessCommand, ExitCode, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender, SyncSender};
use std::thread;
use std::time::{Duration, Instant};

use capture::{CaptureBlock, CaptureHeader};
use control::{Command, EventWriter};
use session::{ListenSession, SessionEvent};
use socket2::{Domain, Protocol, Socket, Type};

const MAX_SESSIONS: usize = 32;
const EVENT_QUEUE: usize = 256;
const MAX_DATAGRAM_BYTES: usize = 2_048;
const IDLE_WAKE: Duration = Duration::from_millis(50);
const STATS_INTERVAL: Duration = Duration::from_secs(5);

pub enum Event {
    CaptureReady(CaptureHeader),
    Capture(CaptureBlock),
    CaptureEnded(String),
    Command(Command),
    ControlClosed,
    ControlFailed(String),
    Datagram {
        local: SocketAddr,
        source: SocketAddr,
        contents: Vec<u8>,
    },
}

#[derive(Debug, Eq, PartialEq)]
struct Args {
    capture_binary: OsString,
    device_name: OsString,
}

fn parse_args<I>(mut args: I) -> Result<Args, &'static str>
where
    I: Iterator<Item = OsString>,
{
    const USAGE: &str =
        "usage: pulse-media-worker --capture-bin <path> --device <exact-device-name>";
    match (
        args.next(),
        args.next(),
        args.next(),
        args.next(),
        args.next(),
    ) {
        (Some(bin_flag), Some(capture_binary), Some(device_flag), Some(device_name), None)
            if bin_flag == "--capture-bin" && device_flag == "--device" =>
        {
            if capture_binary.is_empty() || device_name.is_empty() {
                return Err(USAGE);
            }
            Ok(Args {
                capture_binary,
                device_name,
            })
        }
        _ => Err(USAGE),
    }
}

struct Sockets {
    by_ip: HashMap<IpAddr, Arc<UdpSocket>>,
    by_local: HashMap<SocketAddr, Arc<UdpSocket>>,
    events: SyncSender<Event>,
}

impl Sockets {
    /// One UDP socket per advertised address, shared by every session on it; ICE credentials
    /// demultiplex. It is bound to that exact address so replies leave from the candidate.
    fn for_ip(&mut self, ip: IpAddr) -> io::Result<SocketAddr> {
        if let Some(socket) = self.by_ip.get(&ip) {
            return socket.local_addr();
        }
        let socket = Arc::new(bind_media_socket(ip)?);
        let local = socket.local_addr()?;
        let reader = Arc::clone(&socket);
        let events = self.events.clone();
        thread::Builder::new()
            .name(format!("udp-{local}"))
            .spawn(move || receive_datagrams(&reader, local, &events))?;
        self.by_ip.insert(ip, Arc::clone(&socket));
        self.by_local.insert(local, socket);
        Ok(local)
    }

    fn send(&self, source: SocketAddr, destination: SocketAddr, contents: &[u8]) {
        if let Some(socket) = self.by_local.get(&source) {
            // UDP send failures are loss; ICE consent and RTCP surface a dead path.
            let _ = socket.send_to(contents, destination);
        }
    }
}

/// DSCP EF (46). Wi-Fi access points map it to the WMM voice access category, which gets
/// the shortest contention window on a busy channel; wired switches may use it for priority
/// queueing. Marking is best effort: a platform that refuses it still gets working media.
const DSCP_EXPEDITED_FORWARDING_TOS: u32 = 46 << 2;

fn bind_media_socket(ip: IpAddr) -> io::Result<UdpSocket> {
    let address = SocketAddr::new(ip, 0);
    let socket = Socket::new(
        Domain::for_address(address),
        Type::DGRAM,
        Some(Protocol::UDP),
    )?;
    if ip.is_ipv4() {
        let _ = socket.set_tos_v4(DSCP_EXPEDITED_FORWARDING_TOS);
    }
    socket.bind(&address.into())?;
    Ok(socket.into())
}

fn receive_datagrams(socket: &UdpSocket, local: SocketAddr, events: &SyncSender<Event>) {
    let mut buffer = [0_u8; MAX_DATAGRAM_BYTES];
    loop {
        match socket.recv_from(&mut buffer) {
            Ok((count, source)) => {
                let event = Event::Datagram {
                    local,
                    source,
                    contents: buffer[..count].to_vec(),
                };
                if events.send(event).is_err() {
                    return;
                }
            }
            // Windows reports ICMP port-unreachable from an earlier send as a receive error.
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::Interrupted | ErrorKind::ConnectionReset | ErrorKind::WouldBlock
                ) => {}
            Err(_) => return,
        }
    }
}

struct Worker<W: io::Write> {
    crypto: Arc<str0m::crypto::CryptoProvider>,
    output: EventWriter<W>,
    sockets: Sockets,
    sessions: HashMap<String, ListenSession>,
    channel_count: Option<usize>,
    recycle: Sender<Vec<f32>>,
    dropped_blocks: Arc<AtomicU64>,
}

impl<W: io::Write> Worker<W> {
    fn handle_command(&mut self, command: Command, now: Instant) -> io::Result<()> {
        match command {
            Command::Open {
                session_id,
                channel,
                offer,
                candidate_ip,
            } => {
                let Some(channel_count) = self.channel_count else {
                    return self.output.rejected(&session_id, "capture is not ready");
                };
                if channel >= channel_count {
                    return self.output.rejected(&session_id, "channel is out of range");
                }
                if self.sessions.contains_key(&session_id) {
                    return self.output.rejected(&session_id, "session already exists");
                }
                if self.sessions.len() >= MAX_SESSIONS {
                    return self
                        .output
                        .rejected(&session_id, "listener capacity reached");
                }
                let local = match self.sockets.for_ip(candidate_ip) {
                    Ok(local) => local,
                    Err(_) => {
                        return self
                            .output
                            .rejected(&session_id, "media socket could not be bound");
                    }
                };
                match ListenSession::open(Arc::clone(&self.crypto), local, &offer, channel, now) {
                    Ok((session, answer)) => {
                        self.sessions.insert(session_id.clone(), session);
                        self.output.answer(&session_id, &answer)
                    }
                    Err(detail) => self.output.rejected(&session_id, &detail),
                }
            }
            Command::Select {
                session_id,
                channel,
            } => match self.sessions.get_mut(&session_id) {
                Some(session) if self.channel_count.is_some_and(|count| channel < count) => {
                    session.select(channel);
                    Ok(())
                }
                Some(session) => {
                    session.close("channel-out-of-range");
                    Ok(())
                }
                None => self.output.closed(&session_id, "unknown-session"),
            },
            Command::Close { session_id } => match self.sessions.get_mut(&session_id) {
                Some(session) => {
                    session.close("requested");
                    Ok(())
                }
                None => self.output.closed(&session_id, "unknown-session"),
            },
        }
    }

    fn handle_block(&mut self, block: CaptureBlock, now: Instant) {
        for session in self.sessions.values_mut() {
            session.write_block(&block, now);
        }
        let _ = self.recycle.send(block.samples);
    }

    fn handle_datagram(
        &mut self,
        local: SocketAddr,
        source: SocketAddr,
        contents: &[u8],
        now: Instant,
    ) {
        for session in self.sessions.values_mut() {
            if session.receive(now, source, local, contents) {
                return;
            }
        }
    }

    fn drive(&mut self, now: Instant) -> io::Result<()> {
        let mut transitions = Vec::new();
        for (id, session) in &mut self.sessions {
            session.handle_timeout(now);
            let sockets = &self.sockets;
            if let Some(event) = session.poll(&mut |packet| {
                sockets.send(packet.source, packet.destination, packet.contents);
            }) {
                transitions.push((id.clone(), event));
            }
        }
        for (id, event) in transitions {
            match event {
                SessionEvent::Connected => self.output.connected(&id)?,
                SessionEvent::Closed(reason) => {
                    self.sessions.remove(&id);
                    self.output.closed(&id, reason)?;
                }
            }
        }
        Ok(())
    }

    fn next_deadline(&self, now: Instant) -> Instant {
        self.sessions
            .values()
            .map(ListenSession::next_deadline)
            .fold(now + IDLE_WAKE, Instant::min)
    }
}

fn spawn_capture(args: &Args) -> io::Result<Child> {
    ProcessCommand::new(&args.capture_binary)
        .arg("--device")
        .arg(&args.device_name)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}

fn run(args: &Args) -> Result<(), String> {
    let mut child =
        spawn_capture(args).map_err(|error| format!("capture process could not start: {error}"))?;
    let capture_output = child
        .stdout
        .take()
        .ok_or_else(|| "capture process has no output pipe".to_owned())?;

    let (events_tx, events) = mpsc::sync_channel(EVENT_QUEUE);
    let (recycle_tx, recycle_rx) = mpsc::channel();
    let dropped_blocks = Arc::new(AtomicU64::new(0));

    {
        let events = events_tx.clone();
        let dropped = Arc::clone(&dropped_blocks);
        thread::Builder::new()
            .name("capture-reader".into())
            .spawn(move || capture::read_capture(capture_output, events, recycle_rx, dropped))
            .map_err(|error| error.to_string())?;
    }
    {
        let events = events_tx.clone();
        thread::Builder::new()
            .name("control-reader".into())
            .spawn(move || control::read_commands(BufReader::new(io::stdin()), events))
            .map_err(|error| error.to_string())?;
    }

    let mut worker = Worker {
        crypto: Arc::new(str0m::crypto::from_feature_flags()),
        output: EventWriter::new(io::stdout().lock()),
        sockets: Sockets {
            by_ip: HashMap::new(),
            by_local: HashMap::new(),
            events: events_tx,
        },
        sessions: HashMap::new(),
        channel_count: None,
        recycle: recycle_tx,
        dropped_blocks,
    };

    let result = event_loop(&mut worker, &events);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn event_loop<W: io::Write>(
    worker: &mut Worker<W>,
    events: &mpsc::Receiver<Event>,
) -> Result<(), String> {
    let io_error = |error: io::Error| format!("control output failed: {error}");
    let mut next_stats = Instant::now() + STATS_INTERVAL;
    loop {
        let now = Instant::now();
        let wait = worker.next_deadline(now).saturating_duration_since(now);
        match events.recv_timeout(wait) {
            Ok(Event::CaptureReady(header)) => {
                worker.channel_count = Some(header.channel_count);
                worker.output.ready(&header).map_err(io_error)?;
            }
            Ok(Event::Capture(block)) => worker.handle_block(block, Instant::now()),
            Ok(Event::Datagram {
                local,
                source,
                contents,
            }) => worker.handle_datagram(local, source, &contents, Instant::now()),
            Ok(Event::Command(command)) => worker
                .handle_command(command, Instant::now())
                .map_err(io_error)?,
            Ok(Event::CaptureEnded(detail)) => return Err(detail),
            Ok(Event::ControlClosed) => return Ok(()),
            Ok(Event::ControlFailed(detail)) => return Err(detail),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("event queue closed".into()),
        }
        let now = Instant::now();
        worker.drive(now).map_err(io_error)?;
        if now >= next_stats {
            next_stats = now + STATS_INTERVAL;
            worker
                .output
                .stats(
                    worker.sessions.len(),
                    worker.dropped_blocks.load(Ordering::Relaxed),
                )
                .map_err(io_error)?;
        }
    }
}

fn main() -> ExitCode {
    let result = parse_args(std::env::args_os().skip(1))
        .map_err(str::to_owned)
        .and_then(|args| run(&args));
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("pulse-media-worker: {error}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_an_explicit_capture_binary_and_device() {
        let args = |values: &[&str]| parse_args(values.iter().map(OsString::from));
        assert_eq!(
            args(&["--capture-bin", "/bin/capture", "--device", "DVS"]),
            Ok(Args {
                capture_binary: "/bin/capture".into(),
                device_name: "DVS".into(),
            })
        );
        assert!(args(&["--device", "DVS"]).is_err());
        assert!(args(&["--capture-bin", "/bin/capture", "--device", ""]).is_err());
        assert!(args(&["--capture-bin", "/bin/capture", "--device", "DVS", "extra"]).is_err());
    }
}
