//! One browser listener: an ICE-lite `str0m` peer that sends a single mono Opus stream.
//!
//! The session owns its encoder so a source change can crossfade in the PCM domain before
//! encoding instead of splicing two unrelated Opus streams.

use opus::{Application, Bandwidth, Bitrate, Channels, Encoder, Signal};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use str0m::change::SdpOffer;
use str0m::crypto::CryptoProvider;
use str0m::format::Codec;
use str0m::media::{Direction, Frequency, MediaKind, MediaTime, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

use a2_audio_node::replay_reader::{Read, ReplayReader};

use crate::capture::{CaptureBlock, FRAMES_PER_BLOCK, SAMPLE_RATE_HZ};

/// CELT-only mono at this rate is transparent for monitoring and a small fraction of any LAN.
pub const OPUS_BITRATE_BPS: i32 = 128_000;
const OPUS_COMPLEXITY: i32 = 10;
const MAX_OPUS_PACKET_BYTES: usize = 1_275;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionEvent {
    Connected,
    Closed(&'static str),
}

pub struct Transmit<'a> {
    pub source: SocketAddr,
    pub destination: SocketAddr,
    pub contents: &'a [u8],
}

/// A listener hearing recorded audio of one input instead of live.
struct Replay {
    reader: ReplayReader,
    gain: f32,
    /// Ramp the first block in so starting or seeking never steps.
    fade_in: bool,
}

pub struct ListenSession {
    replay: Option<Replay>,
    replay_ended: bool,
    rtc: Rtc,
    encoder: Encoder,
    audio_mid: Mid,
    opus_pt: Pt,
    /// What this listener hears: one or more inputs, summed.
    sources: Vec<Source>,
    /// The sources a pending change fades from, crossfaded over the next block.
    fade_from: Vec<Source>,
    fading: bool,
    connected: bool,
    closed: Option<&'static str>,
    connect_deadline: Instant,
    next_timeout: Instant,
    mono: Vec<f32>,
    packet: Vec<u8>,
}

fn opus_encoder() -> Result<Encoder, opus::Error> {
    // Restricted low delay is CELT-only: 2.5 ms look-ahead and no speech-model processing.
    let mut encoder = Encoder::new(SAMPLE_RATE_HZ, Channels::Mono, Application::LowDelay)?;
    encoder.set_bitrate(Bitrate::Bits(OPUS_BITRATE_BPS))?;
    encoder.set_complexity(OPUS_COMPLEXITY)?;
    encoder.set_signal(Signal::Music)?;
    encoder.set_max_bandwidth(Bandwidth::Fullband)?;
    encoder.set_vbr(true)?;
    encoder.set_vbr_constraint(true)?;
    encoder.set_dtx(false)?;
    encoder.set_inband_fec(false)?;
    encoder.set_packet_loss_perc(0)?;
    Ok(encoder)
}

/// Writes one mono block for `channel`. A pending source change fades linearly across the
/// block so switching never produces a step discontinuity.
pub fn mix_block(
    block: &CaptureBlock,
    channel: usize,
    fade_from: Option<usize>,
    output: &mut [f32],
) {
    let sample = |frame: usize, source: usize| {
        if source < block.channel_count {
            block.sample(frame, source)
        } else {
            0.0
        }
    };
    for (frame, value) in output.iter_mut().enumerate().take(FRAMES_PER_BLOCK) {
        let next = sample(frame, channel);
        *value = match fade_from {
            Some(previous) if previous != channel => {
                let gain = (frame as f32 + 0.5) / FRAMES_PER_BLOCK as f32;
                sample(frame, previous) * (1.0 - gain) + next * gain
            }
            _ => next,
        };
    }
}

/// The most inputs one listener can hear at once.
pub const MAX_SOURCES: usize = 16;

/// One input in a listener's mix, at the linear gain of its channel trim.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Source {
    pub channel: usize,
    pub gain: f32,
}

/// One frame of a listener's mix: the sources summed, each at its trim, the sum at
/// −3 dB per doubling of sources so several speaking together stay near one's level.
/// No sources is silence; an input beyond the device is silent too.
fn mix_frame(block: &CaptureBlock, sources: &[Source], frame: usize) -> f32 {
    if sources.is_empty() {
        return 0.0;
    }
    let sum: f32 = sources
        .iter()
        .filter(|source| source.channel < block.channel_count)
        .map(|source| block.sample(frame, source.channel) * source.gain)
        .sum();
    sum / (sources.len() as f32).sqrt()
}

/// Writes one mono block of `sources`. A pending change fades linearly from the previous
/// mix across the block, so adding, removing or switching inputs never steps.
pub fn mix_sources(
    block: &CaptureBlock,
    sources: &[Source],
    fade_from: Option<&[Source]>,
    output: &mut [f32],
) {
    for (frame, value) in output.iter_mut().enumerate().take(FRAMES_PER_BLOCK) {
        let next = mix_frame(block, sources, frame);
        *value = match fade_from {
            Some(previous) => {
                let gain = (frame as f32 + 0.5) / FRAMES_PER_BLOCK as f32;
                mix_frame(block, previous, frame) * (1.0 - gain) + next * gain
            }
            None => next,
        };
    }
}

/// Finds the `a=mid` of the first audio section whose answered direction lets this node send.
fn sending_audio_mid(answer: &str) -> Option<Mid> {
    let mut sections = answer.split("\r\nm=").skip(1);
    sections.find_map(|section| {
        if !section.starts_with("audio ") {
            return None;
        }
        let lines = || section.split("\r\n");
        let sending = lines().any(|line| line == "a=sendonly" || line == "a=sendrecv");
        let mid = lines().find_map(|line| line.strip_prefix("a=mid:"))?;
        sending.then(|| Mid::from(mid))
    })
}

impl ListenSession {
    /// Accepts a browser offer and returns the session and its SDP answer.
    pub fn open(
        crypto: Arc<CryptoProvider>,
        local: SocketAddr,
        offer_sdp: &str,
        sources: &[Source],
        now: Instant,
    ) -> Result<(Self, String), String> {
        let offer = SdpOffer::from_sdp_string(offer_sdp)
            .map_err(|_| "offer is not valid SDP".to_owned())?;
        let mut rtc = RtcConfig::new()
            .set_crypto_provider(crypto)
            .set_ice_lite(true)
            .clear_codecs()
            .enable_opus(true)
            .build(now);
        let candidate =
            Candidate::host(local, "udp").map_err(|_| "local candidate is invalid".to_owned())?;
        rtc.add_local_candidate(candidate);
        let answer = rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|_| "offer could not be negotiated".to_owned())?;

        let answer = answer.to_sdp_string();

        // str0m announces remote media only once SRTP is ready, so validate the negotiated
        // result directly: exactly the first audio section this node may send on is used.
        let mid = sending_audio_mid(&answer)
            .filter(|mid| {
                rtc.media(*mid).is_some_and(|media| {
                    media.kind() == MediaKind::Audio
                        && matches!(media.direction(), Direction::SendOnly | Direction::SendRecv)
                })
            })
            .ok_or_else(|| "offer has no audio media this node can send".to_owned())?;
        let opus_pt = rtc
            .writer(mid)
            .and_then(|writer| {
                writer
                    .payload_params()
                    .find(|params| params.spec().codec == Codec::Opus)
                    .map(|params| params.pt())
            })
            .ok_or_else(|| "offer does not accept Opus".to_owned())?;

        let encoder = opus_encoder().map_err(|_| "Opus encoder could not be created".to_owned())?;
        let session = Self {
            replay: None,
            replay_ended: false,
            rtc,
            encoder,
            audio_mid: mid,
            opus_pt,
            sources: {
                let mut owned = Vec::with_capacity(MAX_SOURCES);
                owned.extend_from_slice(&sources[..sources.len().min(MAX_SOURCES)]);
                owned
            },
            fade_from: Vec::with_capacity(MAX_SOURCES),
            fading: false,
            connected: false,
            closed: None,
            connect_deadline: now + CONNECT_TIMEOUT,
            next_timeout: now,
            mono: vec![0.0; FRAMES_PER_BLOCK],
            packet: vec![0; MAX_OPUS_PACKET_BYTES],
        };
        Ok((session, answer))
    }

    pub fn next_deadline(&self) -> Instant {
        if self.connected {
            self.next_timeout
        } else {
            self.next_timeout.min(self.connect_deadline)
        }
    }

    /// Changes what this listener hears. The switch is crossfaded, never renegotiated.
    pub fn select(&mut self, sources: &[Source]) {
        if self.replay.take().is_some() {
            // Back to live: ramp in from silence rather than step from the replay.
            self.fade_from.clear();
            self.sources.clear();
            self.sources.extend_from_slice(sources);
            self.fading = true;
            return;
        }
        if sources != self.sources.as_slice() {
            self.fade_from.clear();
            self.fade_from.extend_from_slice(&self.sources);
            self.sources.clear();
            self.sources.extend_from_slice(sources);
            self.fading = true;
        }
    }

    /// Plays recorded audio instead of live until `select` or the recording runs out.
    pub fn start_replay(&mut self, reader: ReplayReader, gain: f32) {
        self.replay = Some(Replay {
            reader,
            gain,
            fade_in: true,
        });
    }

    /// True once after replay caught up with the end of the recording and went back to live.
    pub fn take_replay_ended(&mut self) -> bool {
        std::mem::take(&mut self.replay_ended)
    }

    pub fn close(&mut self, reason: &'static str) {
        if self.closed.is_none() {
            self.closed = Some(reason);
            self.rtc.disconnect();
        }
    }

    /// Returns false when this datagram belongs to another session.
    pub fn receive(
        &mut self,
        now: Instant,
        source: SocketAddr,
        destination: SocketAddr,
        contents: &[u8],
    ) -> bool {
        let Ok(receive) = Receive::new(Protocol::Udp, source, destination, contents) else {
            return false;
        };
        let input = Input::Receive(now, receive);
        if !self.rtc.accepts(&input) {
            return false;
        }
        if self.rtc.handle_input(input).is_err() {
            self.close("rtc-error");
        }
        true
    }

    pub fn handle_timeout(&mut self, now: Instant) {
        if !self.connected && now >= self.connect_deadline {
            self.close("connect-timeout");
            return;
        }
        if now >= self.next_timeout && self.rtc.handle_input(Input::Timeout(now)).is_err() {
            self.close("rtc-error");
        }
    }

    pub fn write_block(&mut self, block: &CaptureBlock, now: Instant) {
        if !self.connected || self.closed.is_some() {
            return;
        }
        if let Some(replay) = self.replay.as_mut() {
            let outcome = replay.reader.read_block(&mut self.mono);
            for (frame, sample) in self.mono.iter_mut().enumerate() {
                let ramp = if replay.fade_in {
                    (frame as f32 + 0.5) / FRAMES_PER_BLOCK as f32
                } else {
                    1.0
                };
                *sample *= replay.gain * ramp;
            }
            replay.fade_in = false;
            if outcome == Read::EndOfRecording {
                // Caught up with the recording: back to live, ramped in.
                self.replay = None;
                self.replay_ended = true;
                self.fade_from.clear();
                self.fading = true;
            }
        } else {
            let fade_from = self.fading.then_some(self.fade_from.as_slice());
            mix_sources(block, &self.sources, fade_from, &mut self.mono);
            self.fading = false;
        }
        let Ok(length) = self.encoder.encode_float(&self.mono, &mut self.packet) else {
            self.close("encoder-error");
            return;
        };
        let media_time = MediaTime::new(block.first_frame, Frequency::FORTY_EIGHT_KHZ);
        let pt = self.opus_pt;
        let written = self
            .rtc
            .writer(self.audio_mid)
            .map(|writer| writer.write(pt, now, media_time, self.packet[..length].to_vec()));
        if !matches!(written, Some(Ok(()))) {
            self.close("rtc-error");
        }
    }

    /// Drains str0m output. Returns the session-level transitions it produced.
    pub fn poll(&mut self, transmit: &mut dyn FnMut(Transmit<'_>)) -> Option<SessionEvent> {
        let mut transition = None;
        loop {
            match self.rtc.poll_output() {
                Ok(Output::Timeout(timeout)) => {
                    self.next_timeout = timeout;
                    break;
                }
                Ok(Output::Transmit(packet)) => transmit(Transmit {
                    source: packet.source,
                    destination: packet.destination,
                    contents: &packet.contents,
                }),
                Ok(Output::Event(event)) => match event {
                    Event::Connected if self.closed.is_none() => {
                        self.connected = true;
                        transition = Some(SessionEvent::Connected);
                    }
                    Event::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                        self.close("disconnected");
                    }
                    _ => {}
                },
                Err(_) => {
                    self.close("rtc-error");
                    break;
                }
            }
            if !self.rtc.is_alive() {
                break;
            }
        }
        if let Some(reason) = self.closed {
            return Some(SessionEvent::Closed(reason));
        }
        transition
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use str0m::media::MediaData;

    fn block(first_frame: u64, channels: usize, fill: impl Fn(u64, usize) -> f32) -> CaptureBlock {
        let mut samples = Vec::with_capacity(FRAMES_PER_BLOCK * channels);
        for frame in 0..FRAMES_PER_BLOCK {
            for channel in 0..channels {
                samples.push(fill(first_frame + frame as u64, channel));
            }
        }
        CaptureBlock {
            first_frame,
            channel_count: channels,
            samples,
        }
    }

    #[test]
    fn mixes_the_selected_channel_and_crossfades_a_switch() {
        let source = block(0, 2, |_, channel| if channel == 0 { 1.0 } else { -1.0 });
        let mut output = vec![0.0; FRAMES_PER_BLOCK];

        mix_block(&source, 1, None, &mut output);
        assert!(output.iter().all(|sample| *sample == -1.0));

        mix_block(&source, 1, Some(0), &mut output);
        assert!(output[0] > 0.99);
        assert!(output[FRAMES_PER_BLOCK - 1] < -0.99);
        assert!(output.windows(2).all(|pair| pair[1] <= pair[0]));

        mix_block(&source, 7, None, &mut output);
        assert!(output.iter().all(|sample| *sample == 0.0));
    }

    #[test]
    fn sums_several_sources_at_their_trims_and_crossfades_a_change() {
        let source = block(0, 3, |_, channel| [0.4, 0.2, -0.3][channel]);
        let one = |channel, gain| Source { channel, gain };
        let mut output = vec![0.0; FRAMES_PER_BLOCK];

        mix_sources(&source, &[one(0, 1.0)], None, &mut output);
        assert!(output.iter().all(|sample| (*sample - 0.4).abs() < 1e-6));

        // Two sources: summed, each at its trim, the sum at -3 dB.
        mix_sources(&source, &[one(0, 1.0), one(1, 2.0)], None, &mut output);
        let expected = (0.4 + 0.2 * 2.0) / 2.0_f32.sqrt();
        assert!(
            output
                .iter()
                .all(|sample| (*sample - expected).abs() < 1e-6)
        );

        // Nothing selected, or an input the device lacks, is silence.
        mix_sources(&source, &[], None, &mut output);
        assert!(output.iter().all(|sample| *sample == 0.0));
        mix_sources(&source, &[one(9, 1.0)], None, &mut output);
        assert!(output.iter().all(|sample| *sample == 0.0));

        // Adding an input fades from the old mix to the new one over the block.
        mix_sources(
            &source,
            &[one(0, 1.0), one(2, 1.0)],
            Some(&[one(0, 1.0)]),
            &mut output,
        );
        assert!((output[0] - 0.4).abs() < 0.01);
        let after = (0.4 - 0.3) / 2.0_f32.sqrt();
        assert!((output[FRAMES_PER_BLOCK - 1] - after).abs() < 0.01);
    }

    type Datagram = (SocketAddr, SocketAddr, Vec<u8>);

    fn drive_server(
        session: &mut ListenSession,
        to_client: &mut Vec<Datagram>,
        connected: &mut bool,
    ) {
        match session.poll(&mut |packet| {
            to_client.push((packet.source, packet.destination, packet.contents.to_vec()));
        }) {
            Some(SessionEvent::Connected) => *connected = true,
            Some(SessionEvent::Closed(reason)) => panic!("session closed: {reason}"),
            None => {}
        }
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// Negotiates with an in-memory str0m browser stand-in, streams two capture channels and
    /// decodes what arrives: the selected channel is heard, and a switch moves to the other.
    #[test]
    fn delivers_the_selected_channel_as_opus_to_a_webrtc_peer() {
        let crypto = Arc::new(str0m::crypto::from_feature_flags());
        let start = Instant::now();
        let client_addr: SocketAddr = (Ipv4Addr::new(10, 0, 0, 2), 50_000).into();
        let server_addr: SocketAddr = (Ipv4Addr::new(10, 0, 0, 1), 40_000).into();

        let mut client = RtcConfig::new()
            .set_crypto_provider(Arc::clone(&crypto))
            .build(start);
        client.add_local_candidate(Candidate::host(client_addr, "udp").unwrap());
        let mut change = client.sdp_api();
        change.add_media(MediaKind::Audio, Direction::RecvOnly, None, None, None);
        let (offer, pending) = change.apply().unwrap();

        let (mut session, answer) = ListenSession::open(
            crypto,
            server_addr,
            &offer.to_sdp_string(),
            &[Source {
                channel: 1,
                gain: 1.0,
            }],
            start,
        )
        .unwrap();
        assert!(answer.contains("opus/48000/2"));
        assert!(answer.contains("a=ice-lite"));
        client
            .sdp_api()
            .accept_answer(
                pending,
                str0m::change::SdpAnswer::from_sdp_string(&answer).unwrap(),
            )
            .unwrap();

        let tone = |frame: u64| {
            (frame as f32 * 2.0 * std::f32::consts::PI * 1_000.0 / 48_000.0).sin() * 0.5
        };
        let mut decoder = opus::Decoder::new(SAMPLE_RATE_HZ, Channels::Mono).unwrap();
        let mut decoded: Vec<(u64, Vec<f32>)> = Vec::new();
        let mut to_client: Vec<Datagram> = Vec::new();
        let mut connected = false;
        let mut next_frame = 0_u64;
        let mut switched = false;

        for step in 0..3_000_u64 {
            let now = start + Duration::from_millis(step);

            // Client output -> server. Like the worker loop, poll after every datagram so
            // ICE-discovered remote addresses are known before the DTLS flight arrives.
            loop {
                match client.poll_output().unwrap() {
                    Output::Timeout(_) => break,
                    Output::Transmit(packet) => {
                        assert!(session.receive(
                            now,
                            packet.source,
                            packet.destination,
                            &packet.contents
                        ));
                        drive_server(&mut session, &mut to_client, &mut connected);
                    }
                    Output::Event(Event::MediaData(MediaData { data, time, .. })) => {
                        let mut pcm = vec![0.0; FRAMES_PER_BLOCK];
                        let count = decoder.decode_float(&data, &mut pcm, false).unwrap();
                        assert_eq!(count, FRAMES_PER_BLOCK);
                        decoded.push((time.numer(), pcm));
                    }
                    Output::Event(_) => {}
                }
            }

            session.handle_timeout(now);
            if connected && step % 10 == 0 {
                let current = block(
                    next_frame,
                    2,
                    |frame, channel| {
                        if channel == 1 { tone(frame) } else { 0.0 }
                    },
                );
                session.write_block(&current, now);
                next_frame += FRAMES_PER_BLOCK as u64;
            }
            drive_server(&mut session, &mut to_client, &mut connected);
            for (source, destination, contents) in to_client.drain(..) {
                client
                    .handle_input(Input::Receive(
                        now,
                        Receive::new(Protocol::Udp, source, destination, &contents).unwrap(),
                    ))
                    .unwrap();
            }
            client.handle_input(Input::Timeout(now)).unwrap();

            if decoded.len() == 30 && !switched {
                session.select(&[Source {
                    channel: 0,
                    gain: 1.0,
                }]);
                switched = true;
            }
            if decoded.len() >= 60 {
                break;
            }
        }

        assert!(connected, "ICE-lite/DTLS did not connect");
        assert!(decoded.len() >= 60, "received {} packets", decoded.len());
        // RTP media time advances by exactly one 10 ms packet.
        assert!(
            decoded
                .windows(2)
                .all(|pair| pair[1].0.wrapping_sub(pair[0].0) == 480)
        );

        let before_switch = rms(&decoded[20].1);
        let after_switch = rms(&decoded[59].1);
        assert!(
            before_switch > 0.3,
            "selected tone was not audible: {before_switch}"
        );
        assert!(
            after_switch < 0.01,
            "switch to silent input still audible: {after_switch}"
        );
    }
}
