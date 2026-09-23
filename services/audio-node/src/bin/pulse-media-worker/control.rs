//! Line-delimited JSON control protocol between the listen gateway and this worker.
//!
//! stdin carries commands and stdout carries events, one compact JSON object per line.
//! Audio never crosses this channel.

use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::net::IpAddr;
use std::sync::mpsc::SyncSender;

use crate::Event;
use crate::capture::CaptureHeader;

const COMMAND_LIMIT_BYTES: usize = 128 * 1024;
const OFFER_LIMIT_BYTES: usize = 64 * 1024;
const SESSION_ID_LIMIT: usize = 64;
const MAX_CHANNEL_INDEX: u64 = 255;

#[derive(Debug, Eq, PartialEq)]
pub enum Command {
    Open {
        session_id: String,
        channel: usize,
        offer: String,
        candidate_ip: IpAddr,
    },
    Select {
        session_id: String,
        channel: usize,
    },
    Close {
        session_id: String,
    },
}

fn exact_keys(record: &serde_json::Map<String, Value>, expected: &[&str]) -> Result<(), String> {
    let mut keys: Vec<&str> = record.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = expected.to_vec();
    expected.sort_unstable();
    if keys == expected {
        Ok(())
    } else {
        Err("command fields do not match the control protocol".to_owned())
    }
}

fn session_id(record: &serde_json::Map<String, Value>) -> Result<String, String> {
    record
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= SESSION_ID_LIMIT
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .map(str::to_owned)
        .ok_or_else(|| "sessionId is invalid".to_owned())
}

fn channel(record: &serde_json::Map<String, Value>) -> Result<usize, String> {
    record
        .get("channel")
        .and_then(Value::as_u64)
        .filter(|channel| *channel <= MAX_CHANNEL_INDEX)
        .and_then(|channel| usize::try_from(channel).ok())
        .ok_or_else(|| "channel is invalid".to_owned())
}

pub fn parse_command(line: &str) -> Result<Command, String> {
    let value: Value =
        serde_json::from_str(line).map_err(|_| "command is not valid JSON".to_owned())?;
    let record = value
        .as_object()
        .ok_or_else(|| "command must be a JSON object".to_owned())?;
    match record.get("type").and_then(Value::as_str) {
        Some("open") => {
            exact_keys(
                record,
                &["type", "sessionId", "channel", "offer", "candidateAddress"],
            )?;
            let offer = record
                .get("offer")
                .and_then(Value::as_str)
                .filter(|offer| !offer.is_empty() && offer.len() <= OFFER_LIMIT_BYTES)
                .ok_or_else(|| "offer is invalid".to_owned())?;
            let candidate_ip = record
                .get("candidateAddress")
                .and_then(Value::as_str)
                .and_then(|address| address.parse::<IpAddr>().ok())
                .filter(|address| !address.is_unspecified() && !address.is_multicast())
                .ok_or_else(|| "candidateAddress is invalid".to_owned())?;
            Ok(Command::Open {
                session_id: session_id(record)?,
                channel: channel(record)?,
                offer: offer.to_owned(),
                candidate_ip,
            })
        }
        Some("select") => {
            exact_keys(record, &["type", "sessionId", "channel"])?;
            Ok(Command::Select {
                session_id: session_id(record)?,
                channel: channel(record)?,
            })
        }
        Some("close") => {
            exact_keys(record, &["type", "sessionId"])?;
            Ok(Command::Close {
                session_id: session_id(record)?,
            })
        }
        _ => Err("command type is unsupported".to_owned()),
    }
}

/// Runs on its own thread. A malformed command is a gateway bug, so it ends the worker
/// rather than being skipped silently.
pub fn read_commands(input: impl BufRead, events: SyncSender<Event>) {
    let mut input = input.take(0);
    loop {
        let mut line = Vec::new();
        input.set_limit(COMMAND_LIMIT_BYTES as u64 + 1);
        match input.read_until(b'\n', &mut line) {
            Ok(0) => {
                let _ = events.send(Event::ControlClosed);
                return;
            }
            Ok(_) => {}
            Err(error) => {
                let _ = events.send(Event::ControlFailed(format!(
                    "control read failed: {error}"
                )));
                return;
            }
        }
        if line.last() != Some(&b'\n') {
            let _ = events.send(Event::ControlFailed(
                "control command exceeds the size limit or is unterminated".into(),
            ));
            return;
        }
        line.pop();
        let parsed = std::str::from_utf8(&line)
            .map_err(|_| "command is not UTF-8".to_owned())
            .and_then(parse_command);
        let event = match parsed {
            Ok(command) => Event::Command(command),
            Err(detail) => Event::ControlFailed(detail),
        };
        let failed = matches!(event, Event::ControlFailed(_));
        if events.send(event).is_err() || failed {
            return;
        }
    }
}

pub struct EventWriter<W: Write> {
    output: W,
}

impl<W: Write> EventWriter<W> {
    pub fn new(output: W) -> Self {
        Self { output }
    }

    fn emit(&mut self, value: Value) -> std::io::Result<()> {
        serde_json::to_writer(&mut self.output, &value)?;
        self.output.write_all(b"\n")?;
        self.output.flush()
    }

    pub fn ready(&mut self, header: &CaptureHeader) -> std::io::Result<()> {
        self.emit(json!({
            "type": "ready",
            "deviceName": header.device_name,
            "sampleRateHz": header.sample_rate_hz,
            "channelCount": header.channel_count,
        }))
    }

    pub fn answer(&mut self, session_id: &str, answer: &str) -> std::io::Result<()> {
        self.emit(json!({ "type": "answer", "sessionId": session_id, "answer": answer }))
    }

    pub fn rejected(&mut self, session_id: &str, detail: &str) -> std::io::Result<()> {
        self.emit(json!({ "type": "rejected", "sessionId": session_id, "detail": detail }))
    }

    pub fn connected(&mut self, session_id: &str) -> std::io::Result<()> {
        self.emit(json!({ "type": "connected", "sessionId": session_id }))
    }

    pub fn closed(&mut self, session_id: &str, reason: &str) -> std::io::Result<()> {
        self.emit(json!({ "type": "closed", "sessionId": session_id, "reason": reason }))
    }

    pub fn stats(&mut self, sessions: usize, dropped_blocks: u64) -> std::io::Result<()> {
        self.emit(json!({
            "type": "stats",
            "sessions": sessions,
            "droppedCaptureBlocks": dropped_blocks,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_three_commands_strictly() {
        assert_eq!(
            parse_command(
                r#"{"type":"open","sessionId":"a-1","channel":3,"offer":"v=0","candidateAddress":"192.168.1.20"}"#
            ),
            Ok(Command::Open {
                session_id: "a-1".into(),
                channel: 3,
                offer: "v=0".into(),
                candidate_ip: "192.168.1.20".parse().unwrap(),
            })
        );
        assert_eq!(
            parse_command(r#"{"type":"select","sessionId":"a-1","channel":0}"#),
            Ok(Command::Select {
                session_id: "a-1".into(),
                channel: 0
            })
        );
        assert_eq!(
            parse_command(r#"{"type":"close","sessionId":"a-1"}"#),
            Ok(Command::Close {
                session_id: "a-1".into()
            })
        );
    }

    #[test]
    fn rejects_unknown_fields_bad_identifiers_and_unusable_addresses() {
        for line in [
            r#"{"type":"close","sessionId":"a-1","extra":true}"#,
            r#"{"type":"close","sessionId":"a 1"}"#,
            r#"{"type":"select","sessionId":"a-1","channel":-1}"#,
            r#"{"type":"select","sessionId":"a-1","channel":256}"#,
            r#"{"type":"open","sessionId":"a","channel":0,"offer":"v=0","candidateAddress":"0.0.0.0"}"#,
            r#"{"type":"open","sessionId":"a","channel":0,"offer":"","candidateAddress":"127.0.0.1"}"#,
            r#"{"type":"restart"}"#,
            "[]",
        ] {
            assert!(parse_command(line).is_err(), "{line}");
        }
    }

    #[test]
    fn events_are_single_json_lines() {
        let mut output = Vec::new();
        let mut writer = EventWriter::new(&mut output);
        writer.answer("a-1", "v=0\r\na=x\r\n").unwrap();
        writer.closed("a-1", "requested").unwrap();
        let text = String::from_utf8(output).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(
            serde_json::from_str::<Value>(lines[0]).unwrap()["answer"],
            "v=0\r\na=x\r\n"
        );
    }
}
