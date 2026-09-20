use prost::Message;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const CONTROL_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MessageKind {
    HealthProbe,
    WorkerReady,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ControlBody {
    HealthProbe { deadline_ms: u32 },
    WorkerReady { boot_id: u64, worker_kind: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlMessage {
    pub protocol_version: u32,
    pub message_kind: MessageKind,
    pub request_id: u64,
    pub authority_epoch: Option<u64>,
    pub capture_epoch: Option<u64>,
    pub body: ControlBody,
}

impl ControlMessage {
    fn validate(&self) -> Result<(), CodecError> {
        let matches = matches!(
            (self.message_kind, &self.body),
            (MessageKind::HealthProbe, ControlBody::HealthProbe { .. })
                | (MessageKind::WorkerReady, ControlBody::WorkerReady { .. })
        );
        if !matches {
            return Err(CodecError::InvalidSemantic(
                "message kind does not match its body",
            ));
        }
        if self.protocol_version != CONTROL_PROTOCOL_VERSION {
            return Err(CodecError::InvalidSemantic("unsupported protocol version"));
        }
        if let ControlBody::WorkerReady { worker_kind, .. } = &self.body
            && (worker_kind.is_empty() || worker_kind.len() > 64)
        {
            return Err(CodecError::InvalidSemantic(
                "worker kind must contain 1 to 64 bytes",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CodecError {
    InvalidMaximum,
    PayloadTooLarge { actual: usize, maximum: usize },
    Malformed(&'static str),
    InvalidSemantic(&'static str),
}

impl Display for CodecError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMaximum => write!(formatter, "codec maximum must be greater than zero"),
            Self::PayloadTooLarge { actual, maximum } => {
                write!(formatter, "payload size {actual} exceeds maximum {maximum}")
            }
            Self::Malformed(codec) => write!(formatter, "malformed {codec} control message"),
            Self::InvalidSemantic(reason) => write!(formatter, "invalid control message: {reason}"),
        }
    }
}

impl Error for CodecError {}

pub trait ControlCodec {
    fn encode(&self, message: &ControlMessage) -> Result<Vec<u8>, CodecError>;
    fn decode(&self, payload: &[u8]) -> Result<ControlMessage, CodecError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CanonicalJsonCodec {
    maximum: usize,
}

impl CanonicalJsonCodec {
    pub fn new(maximum: usize) -> Result<Self, CodecError> {
        bounded_maximum(maximum).map(|maximum| Self { maximum })
    }
}

impl ControlCodec for CanonicalJsonCodec {
    fn encode(&self, message: &ControlMessage) -> Result<Vec<u8>, CodecError> {
        message.validate()?;
        let encoded = serde_json::to_vec(&JsonMessage::from(message))
            .map_err(|_| CodecError::Malformed("JSON"))?;
        enforce_maximum(encoded.len(), self.maximum)?;
        Ok(encoded)
    }

    fn decode(&self, payload: &[u8]) -> Result<ControlMessage, CodecError> {
        enforce_maximum(payload.len(), self.maximum)?;
        let wire: JsonMessage =
            serde_json::from_slice(payload).map_err(|_| CodecError::Malformed("JSON"))?;
        let semantic = ControlMessage::try_from(wire)?;
        semantic.validate()?;
        Ok(semantic)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProtobufCodec {
    maximum: usize,
}

impl ProtobufCodec {
    pub fn new(maximum: usize) -> Result<Self, CodecError> {
        bounded_maximum(maximum).map(|maximum| Self { maximum })
    }
}

impl ControlCodec for ProtobufCodec {
    fn encode(&self, message: &ControlMessage) -> Result<Vec<u8>, CodecError> {
        message.validate()?;
        let wire = WireMessage::from(message);
        let encoded_len = wire.encoded_len();
        enforce_maximum(encoded_len, self.maximum)?;
        let mut encoded = Vec::with_capacity(encoded_len);
        wire.encode(&mut encoded)
            .map_err(|_| CodecError::Malformed("Protobuf"))?;
        Ok(encoded)
    }

    fn decode(&self, payload: &[u8]) -> Result<ControlMessage, CodecError> {
        enforce_maximum(payload.len(), self.maximum)?;
        let wire = WireMessage::decode(payload).map_err(|_| CodecError::Malformed("Protobuf"))?;
        let semantic = ControlMessage::try_from(wire)?;
        semantic.validate()?;
        Ok(semantic)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodecComparison {
    pub canonical_json: Vec<u8>,
    pub protobuf: Vec<u8>,
}

/// Encodes and semantically round-trips one message through both candidates.
pub fn compare_codecs(
    message: &ControlMessage,
    maximum: usize,
) -> Result<CodecComparison, CodecError> {
    let json_codec = CanonicalJsonCodec::new(maximum)?;
    let protobuf_codec = ProtobufCodec::new(maximum)?;
    let canonical_json = json_codec.encode(message)?;
    let protobuf = protobuf_codec.encode(message)?;
    if json_codec.decode(&canonical_json)? != *message
        || protobuf_codec.decode(&protobuf)? != *message
    {
        return Err(CodecError::InvalidSemantic(
            "codec comparison did not round-trip",
        ));
    }
    Ok(CodecComparison {
        canonical_json,
        protobuf,
    })
}

fn bounded_maximum(maximum: usize) -> Result<usize, CodecError> {
    if maximum == 0 || maximum > u32::MAX as usize {
        return Err(CodecError::InvalidMaximum);
    }
    Ok(maximum)
}

fn enforce_maximum(actual: usize, maximum: usize) -> Result<(), CodecError> {
    if actual > maximum {
        return Err(CodecError::PayloadTooLarge { actual, maximum });
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JsonMessage {
    // Alphabetical declaration order makes the compact representation stable.
    authority_epoch: Option<String>,
    body: JsonBody,
    capture_epoch: Option<String>,
    message_kind: JsonMessageKind,
    protocol_version: u32,
    request_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum JsonMessageKind {
    HealthProbe,
    WorkerReady,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum JsonBody {
    HealthProbe(JsonHealthProbe),
    WorkerReady(JsonWorkerReady),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JsonHealthProbe {
    deadline_ms: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JsonWorkerReady {
    boot_id: String,
    worker_kind: String,
}

impl From<&ControlMessage> for JsonMessage {
    fn from(message: &ControlMessage) -> Self {
        let body = match &message.body {
            ControlBody::HealthProbe { deadline_ms } => JsonBody::HealthProbe(JsonHealthProbe {
                deadline_ms: *deadline_ms,
            }),
            ControlBody::WorkerReady {
                boot_id,
                worker_kind,
            } => JsonBody::WorkerReady(JsonWorkerReady {
                boot_id: boot_id.to_string(),
                worker_kind: worker_kind.clone(),
            }),
        };
        Self {
            authority_epoch: message.authority_epoch.map(|value| value.to_string()),
            body,
            capture_epoch: message.capture_epoch.map(|value| value.to_string()),
            message_kind: match message.message_kind {
                MessageKind::HealthProbe => JsonMessageKind::HealthProbe,
                MessageKind::WorkerReady => JsonMessageKind::WorkerReady,
            },
            protocol_version: message.protocol_version,
            request_id: message.request_id.to_string(),
        }
    }
}

impl TryFrom<JsonMessage> for ControlMessage {
    type Error = CodecError;

    fn try_from(message: JsonMessage) -> Result<Self, Self::Error> {
        let parse_u64 = |value: &str| {
            value
                .parse::<u64>()
                .map_err(|_| CodecError::InvalidSemantic("invalid unsigned 64-bit decimal string"))
        };
        Ok(Self {
            protocol_version: message.protocol_version,
            message_kind: match message.message_kind {
                JsonMessageKind::HealthProbe => MessageKind::HealthProbe,
                JsonMessageKind::WorkerReady => MessageKind::WorkerReady,
            },
            request_id: parse_u64(&message.request_id)?,
            authority_epoch: message
                .authority_epoch
                .as_deref()
                .map(parse_u64)
                .transpose()?,
            capture_epoch: message
                .capture_epoch
                .as_deref()
                .map(parse_u64)
                .transpose()?,
            body: match message.body {
                JsonBody::HealthProbe(body) => ControlBody::HealthProbe {
                    deadline_ms: body.deadline_ms,
                },
                JsonBody::WorkerReady(body) => ControlBody::WorkerReady {
                    boot_id: parse_u64(&body.boot_id)?,
                    worker_kind: body.worker_kind,
                },
            },
        })
    }
}

#[derive(Clone, PartialEq, Message)]
struct WireMessage {
    #[prost(uint32, tag = "1")]
    protocol_version: u32,
    #[prost(enumeration = "WireMessageKind", tag = "2")]
    message_kind: i32,
    #[prost(uint64, tag = "3")]
    request_id: u64,
    #[prost(uint64, optional, tag = "4")]
    authority_epoch: Option<u64>,
    #[prost(uint64, optional, tag = "5")]
    capture_epoch: Option<u64>,
    #[prost(oneof = "wire_message::Body", tags = "10, 11")]
    body: Option<wire_message::Body>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
#[repr(i32)]
enum WireMessageKind {
    Unspecified = 0,
    HealthProbe = 1,
    WorkerReady = 2,
}

mod wire_message {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub(super) enum Body {
        #[prost(message, tag = "10")]
        HealthProbe(super::WireHealthProbe),
        #[prost(message, tag = "11")]
        WorkerReady(super::WireWorkerReady),
    }
}

#[derive(Clone, PartialEq, Message)]
struct WireHealthProbe {
    #[prost(uint32, tag = "1")]
    deadline_ms: u32,
}

#[derive(Clone, PartialEq, Message)]
struct WireWorkerReady {
    #[prost(uint64, tag = "1")]
    boot_id: u64,
    #[prost(string, tag = "2")]
    worker_kind: String,
}

impl From<&ControlMessage> for WireMessage {
    fn from(message: &ControlMessage) -> Self {
        let body = match &message.body {
            ControlBody::HealthProbe { deadline_ms } => {
                wire_message::Body::HealthProbe(WireHealthProbe {
                    deadline_ms: *deadline_ms,
                })
            }
            ControlBody::WorkerReady {
                boot_id,
                worker_kind,
            } => wire_message::Body::WorkerReady(WireWorkerReady {
                boot_id: *boot_id,
                worker_kind: worker_kind.clone(),
            }),
        };
        Self {
            protocol_version: message.protocol_version,
            message_kind: match message.message_kind {
                MessageKind::HealthProbe => WireMessageKind::HealthProbe as i32,
                MessageKind::WorkerReady => WireMessageKind::WorkerReady as i32,
            },
            request_id: message.request_id,
            authority_epoch: message.authority_epoch,
            capture_epoch: message.capture_epoch,
            body: Some(body),
        }
    }
}

impl TryFrom<WireMessage> for ControlMessage {
    type Error = CodecError;

    fn try_from(message: WireMessage) -> Result<Self, Self::Error> {
        let message_kind = match WireMessageKind::try_from(message.message_kind) {
            Ok(WireMessageKind::HealthProbe) => MessageKind::HealthProbe,
            Ok(WireMessageKind::WorkerReady) => MessageKind::WorkerReady,
            _ => return Err(CodecError::InvalidSemantic("unknown message kind")),
        };
        let body = match message.body {
            Some(wire_message::Body::HealthProbe(body)) => ControlBody::HealthProbe {
                deadline_ms: body.deadline_ms,
            },
            Some(wire_message::Body::WorkerReady(body)) => ControlBody::WorkerReady {
                boot_id: body.boot_id,
                worker_kind: body.worker_kind,
            },
            None => return Err(CodecError::InvalidSemantic("message body is required")),
        };
        Ok(Self {
            protocol_version: message.protocol_version,
            message_kind,
            request_id: message.request_id,
            authority_epoch: message.authority_epoch,
            capture_epoch: message.capture_epoch,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn health_probe() -> ControlMessage {
        ControlMessage {
            protocol_version: 1,
            message_kind: MessageKind::HealthProbe,
            request_id: 42,
            authority_epoch: Some(7),
            capture_epoch: None,
            body: ControlBody::HealthProbe { deadline_ms: 250 },
        }
    }

    #[test]
    fn golden_health_probe_matches_both_encodings() {
        let comparison = compare_codecs(&health_probe(), 1024).unwrap();
        assert_eq!(
            comparison.canonical_json,
            br#"{"authority_epoch":"7","body":{"deadline_ms":250},"capture_epoch":null,"message_kind":"health_probe","protocol_version":1,"request_id":"42"}"#
        );
        assert_eq!(
            comparison.protobuf,
            [
                0x08, 0x01, 0x10, 0x01, 0x18, 0x2a, 0x20, 0x07, 0x52, 0x03, 0x08, 0xfa, 0x01
            ]
        );
    }

    #[test]
    fn round_trips_second_representative_message() {
        let message = ControlMessage {
            protocol_version: 1,
            message_kind: MessageKind::WorkerReady,
            request_id: u64::MAX,
            authority_epoch: None,
            capture_epoch: Some(91),
            body: ControlBody::WorkerReady {
                boot_id: 82,
                worker_kind: "media-worker".to_owned(),
            },
        };
        let comparison = compare_codecs(&message, 1024).unwrap();
        assert!(comparison.protobuf.len() < comparison.canonical_json.len());
    }

    #[test]
    fn json_rejects_unknown_fields() {
        let codec = CanonicalJsonCodec::new(1024).unwrap();
        let payload = br#"{"authority_epoch":"7","body":{"deadline_ms":250},"capture_epoch":null,"message_kind":"health_probe","protocol_version":1,"request_id":"42","surprise":true}"#;
        assert_eq!(codec.decode(payload), Err(CodecError::Malformed("JSON")));

        let nested = br#"{"authority_epoch":"7","body":{"deadline_ms":250,"surprise":true},"capture_epoch":null,"message_kind":"health_probe","protocol_version":1,"request_id":"42"}"#;
        assert_eq!(codec.decode(nested), Err(CodecError::Malformed("JSON")));
    }

    #[test]
    fn protobuf_accepts_unknown_fields() {
        let codec = ProtobufCodec::new(1024).unwrap();
        let mut payload = codec.encode(&health_probe()).unwrap();
        // Field 99, varint value 1. Prost discards it during semantic decoding.
        payload.extend_from_slice(&[0x98, 0x06, 0x01]);
        assert_eq!(codec.decode(&payload), Ok(health_probe()));
    }

    #[test]
    fn codecs_reject_oversize_before_decode() {
        let bytes = [0_u8; 5];
        let expected = Err(CodecError::PayloadTooLarge {
            actual: 5,
            maximum: 4,
        });
        assert_eq!(CanonicalJsonCodec::new(4).unwrap().decode(&bytes), expected);
        assert_eq!(ProtobufCodec::new(4).unwrap().decode(&bytes), expected);
    }

    #[test]
    fn malformed_payloads_are_rejected() {
        assert_eq!(
            CanonicalJsonCodec::new(64).unwrap().decode(b"{"),
            Err(CodecError::Malformed("JSON"))
        );
        assert_eq!(
            ProtobufCodec::new(64).unwrap().decode(&[0x52, 0x02, 0x08]),
            Err(CodecError::Malformed("Protobuf"))
        );
    }

    #[test]
    fn codecs_reject_unsupported_protocol_versions() {
        let json_codec = CanonicalJsonCodec::new(1024).unwrap();
        let json_payload = br#"{"authority_epoch":"7","body":{"deadline_ms":250},"capture_epoch":null,"message_kind":"health_probe","protocol_version":2,"request_id":"42"}"#;
        assert_eq!(
            json_codec.decode(json_payload),
            Err(CodecError::InvalidSemantic("unsupported protocol version"))
        );

        let protobuf_codec = ProtobufCodec::new(1024).unwrap();
        let mut protobuf_payload = protobuf_codec.encode(&health_probe()).unwrap();
        assert_eq!(&protobuf_payload[..2], &[0x08, 0x01]);
        protobuf_payload[1] = 0x02;
        assert_eq!(
            protobuf_codec.decode(&protobuf_payload),
            Err(CodecError::InvalidSemantic("unsupported protocol version"))
        );
    }

    #[test]
    fn rejects_kind_body_mismatch_and_unbounded_configuration() {
        let mut message = health_probe();
        message.message_kind = MessageKind::WorkerReady;
        assert_eq!(
            ProtobufCodec::new(1024).unwrap().encode(&message),
            Err(CodecError::InvalidSemantic(
                "message kind does not match its body"
            ))
        );
        assert_eq!(CanonicalJsonCodec::new(0), Err(CodecError::InvalidMaximum));
        if usize::BITS > 32 {
            assert_eq!(
                ProtobufCodec::new(u32::MAX as usize + 1),
                Err(CodecError::InvalidMaximum)
            );
        }
    }
}
