use prost::Message;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const CONTROL_PROTOCOL_VERSION: u32 = 2;
const LEGACY_HEALTH_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MessageKind {
    HealthProbe,
    WorkerReady,
    WorkerHeartbeat,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkerRole {
    AudioEngine,
    Sequencer,
    Media,
    ClientGateway,
    Replay,
    ReceiverAdapter,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkerIdentity {
    pub boot_id: u128,
    pub worker_id: u16,
    pub role: WorkerRole,
    pub generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadinessEvidence {
    Basic,
    DeviceVerified { capture_epoch: u64 },
    LedgerChecked,
    FreshMediaSessions,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ControlBody {
    HealthProbe {
        deadline_ms: u32,
    },
    WorkerReady {
        worker: WorkerIdentity,
        evidence: ReadinessEvidence,
    },
    WorkerHeartbeat {
        worker: WorkerIdentity,
        sequence: u64,
    },
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
                | (
                    MessageKind::WorkerHeartbeat,
                    ControlBody::WorkerHeartbeat { .. }
                )
        );
        if !matches {
            return Err(CodecError::InvalidSemantic(
                "message kind does not match its body",
            ));
        }
        match self.body {
            ControlBody::HealthProbe { deadline_ms: 0 } => {
                return Err(CodecError::InvalidSemantic(
                    "health-probe deadline must be nonzero",
                ));
            }
            ControlBody::WorkerReady { worker, evidence } => {
                if self.protocol_version != CONTROL_PROTOCOL_VERSION {
                    return Err(CodecError::InvalidSemantic(
                        "worker control requires protocol version 2",
                    ));
                }
                if self.authority_epoch.is_some() || self.capture_epoch.is_some() {
                    return Err(CodecError::InvalidSemantic(
                        "worker control envelope epochs must be absent",
                    ));
                }
                validate_worker(worker)?;
                let evidence_matches = matches!(
                    (worker.role, evidence),
                    (
                        WorkerRole::AudioEngine,
                        ReadinessEvidence::DeviceVerified { .. }
                    ) | (WorkerRole::Sequencer, ReadinessEvidence::LedgerChecked)
                        | (WorkerRole::Media, ReadinessEvidence::FreshMediaSessions)
                        | (
                            WorkerRole::ClientGateway
                                | WorkerRole::Replay
                                | WorkerRole::ReceiverAdapter,
                            ReadinessEvidence::Basic
                        )
                );
                if !evidence_matches {
                    return Err(CodecError::InvalidSemantic(
                        "readiness evidence does not match worker role",
                    ));
                }
                if let ReadinessEvidence::DeviceVerified { capture_epoch: 0 } = evidence {
                    return Err(CodecError::InvalidSemantic(
                        "device-verified capture epoch must be nonzero",
                    ));
                }
            }
            ControlBody::WorkerHeartbeat { worker, sequence } => {
                if self.protocol_version != CONTROL_PROTOCOL_VERSION {
                    return Err(CodecError::InvalidSemantic(
                        "worker control requires protocol version 2",
                    ));
                }
                if self.authority_epoch.is_some() || self.capture_epoch.is_some() {
                    return Err(CodecError::InvalidSemantic(
                        "worker control envelope epochs must be absent",
                    ));
                }
                validate_worker(worker)?;
                if sequence == 0 {
                    return Err(CodecError::InvalidSemantic(
                        "heartbeat sequence must be nonzero",
                    ));
                }
            }
            ControlBody::HealthProbe { .. } => {
                if self.protocol_version != LEGACY_HEALTH_PROTOCOL_VERSION
                    && self.protocol_version != CONTROL_PROTOCOL_VERSION
                {
                    return Err(CodecError::InvalidSemantic("unsupported protocol version"));
                }
            }
        }
        Ok(())
    }
}

fn validate_worker(worker: WorkerIdentity) -> Result<(), CodecError> {
    if worker.boot_id == 0 {
        return Err(CodecError::InvalidSemantic(
            "worker boot ID must be nonzero",
        ));
    }
    if worker.generation == 0 {
        return Err(CodecError::InvalidSemantic(
            "worker generation must be nonzero",
        ));
    }
    Ok(())
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
    WorkerHeartbeat,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum JsonBody {
    HealthProbe(JsonHealthProbe),
    WorkerReady(JsonWorkerReady),
    WorkerHeartbeat(JsonWorkerHeartbeat),
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
    evidence: JsonReadinessEvidence,
    generation: String,
    worker_id: u16,
    worker_role: JsonWorkerRole,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JsonWorkerHeartbeat {
    boot_id: String,
    generation: String,
    sequence: String,
    worker_id: u16,
    worker_role: JsonWorkerRole,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum JsonWorkerRole {
    AudioEngine,
    Sequencer,
    Media,
    ClientGateway,
    Replay,
    ReceiverAdapter,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum JsonReadinessEvidence {
    Basic,
    DeviceVerified { capture_epoch: String },
    LedgerChecked,
    FreshMediaSessions,
}

impl From<&ControlMessage> for JsonMessage {
    fn from(message: &ControlMessage) -> Self {
        let body = match &message.body {
            ControlBody::HealthProbe { deadline_ms } => JsonBody::HealthProbe(JsonHealthProbe {
                deadline_ms: *deadline_ms,
            }),
            ControlBody::WorkerReady { worker, evidence } => {
                JsonBody::WorkerReady(JsonWorkerReady {
                    boot_id: format!("{:032x}", worker.boot_id),
                    evidence: (*evidence).into(),
                    generation: worker.generation.to_string(),
                    worker_id: worker.worker_id,
                    worker_role: worker.role.into(),
                })
            }
            ControlBody::WorkerHeartbeat { worker, sequence } => {
                JsonBody::WorkerHeartbeat(JsonWorkerHeartbeat {
                    boot_id: format!("{:032x}", worker.boot_id),
                    generation: worker.generation.to_string(),
                    sequence: sequence.to_string(),
                    worker_id: worker.worker_id,
                    worker_role: worker.role.into(),
                })
            }
        };
        Self {
            authority_epoch: message.authority_epoch.map(|value| value.to_string()),
            body,
            capture_epoch: message.capture_epoch.map(|value| value.to_string()),
            message_kind: match message.message_kind {
                MessageKind::HealthProbe => JsonMessageKind::HealthProbe,
                MessageKind::WorkerReady => JsonMessageKind::WorkerReady,
                MessageKind::WorkerHeartbeat => JsonMessageKind::WorkerHeartbeat,
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
        let parse_boot_id = |value: &str| {
            if value.len() != 32
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(CodecError::InvalidSemantic(
                    "boot ID must be 32 lowercase hexadecimal characters",
                ));
            }
            u128::from_str_radix(value, 16)
                .map_err(|_| CodecError::InvalidSemantic("invalid 128-bit boot ID"))
        };
        Ok(Self {
            protocol_version: message.protocol_version,
            message_kind: match message.message_kind {
                JsonMessageKind::HealthProbe => MessageKind::HealthProbe,
                JsonMessageKind::WorkerReady => MessageKind::WorkerReady,
                JsonMessageKind::WorkerHeartbeat => MessageKind::WorkerHeartbeat,
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
                    worker: WorkerIdentity {
                        boot_id: parse_boot_id(&body.boot_id)?,
                        worker_id: body.worker_id,
                        role: body.worker_role.into(),
                        generation: parse_u64(&body.generation)?,
                    },
                    evidence: body.evidence.try_into()?,
                },
                JsonBody::WorkerHeartbeat(body) => ControlBody::WorkerHeartbeat {
                    worker: WorkerIdentity {
                        boot_id: parse_boot_id(&body.boot_id)?,
                        worker_id: body.worker_id,
                        role: body.worker_role.into(),
                        generation: parse_u64(&body.generation)?,
                    },
                    sequence: parse_u64(&body.sequence)?,
                },
            },
        })
    }
}

impl From<WorkerRole> for JsonWorkerRole {
    fn from(role: WorkerRole) -> Self {
        match role {
            WorkerRole::AudioEngine => Self::AudioEngine,
            WorkerRole::Sequencer => Self::Sequencer,
            WorkerRole::Media => Self::Media,
            WorkerRole::ClientGateway => Self::ClientGateway,
            WorkerRole::Replay => Self::Replay,
            WorkerRole::ReceiverAdapter => Self::ReceiverAdapter,
        }
    }
}

impl From<JsonWorkerRole> for WorkerRole {
    fn from(role: JsonWorkerRole) -> Self {
        match role {
            JsonWorkerRole::AudioEngine => Self::AudioEngine,
            JsonWorkerRole::Sequencer => Self::Sequencer,
            JsonWorkerRole::Media => Self::Media,
            JsonWorkerRole::ClientGateway => Self::ClientGateway,
            JsonWorkerRole::Replay => Self::Replay,
            JsonWorkerRole::ReceiverAdapter => Self::ReceiverAdapter,
        }
    }
}

impl From<ReadinessEvidence> for JsonReadinessEvidence {
    fn from(evidence: ReadinessEvidence) -> Self {
        match evidence {
            ReadinessEvidence::Basic => Self::Basic,
            ReadinessEvidence::DeviceVerified { capture_epoch } => Self::DeviceVerified {
                capture_epoch: capture_epoch.to_string(),
            },
            ReadinessEvidence::LedgerChecked => Self::LedgerChecked,
            ReadinessEvidence::FreshMediaSessions => Self::FreshMediaSessions,
        }
    }
}

impl TryFrom<JsonReadinessEvidence> for ReadinessEvidence {
    type Error = CodecError;

    fn try_from(evidence: JsonReadinessEvidence) -> Result<Self, Self::Error> {
        Ok(match evidence {
            JsonReadinessEvidence::Basic => Self::Basic,
            JsonReadinessEvidence::DeviceVerified { capture_epoch } => Self::DeviceVerified {
                capture_epoch: capture_epoch.parse::<u64>().map_err(|_| {
                    CodecError::InvalidSemantic("invalid unsigned 64-bit decimal string")
                })?,
            },
            JsonReadinessEvidence::LedgerChecked => Self::LedgerChecked,
            JsonReadinessEvidence::FreshMediaSessions => Self::FreshMediaSessions,
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
    #[prost(oneof = "wire_message::Body", tags = "10, 11, 12")]
    body: Option<wire_message::Body>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
#[repr(i32)]
enum WireMessageKind {
    Unspecified = 0,
    HealthProbe = 1,
    WorkerReady = 2,
    WorkerHeartbeat = 3,
}

mod wire_message {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub(super) enum Body {
        #[prost(message, tag = "10")]
        HealthProbe(super::WireHealthProbe),
        #[prost(message, tag = "11")]
        WorkerReady(super::WireWorkerReady),
        #[prost(message, tag = "12")]
        WorkerHeartbeat(super::WireWorkerHeartbeat),
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
    legacy_boot_id: u64,
    // Tag 2 carried the untyped worker-kind string in the initial comparison
    // fixture. Keeping it reserved avoids silently reinterpreting old bytes.
    #[prost(string, optional, tag = "2")]
    legacy_worker_kind: Option<String>,
    #[prost(bytes = "vec", tag = "3")]
    boot_id: Vec<u8>,
    #[prost(uint32, tag = "4")]
    worker_id: u32,
    #[prost(enumeration = "WireWorkerRole", tag = "5")]
    worker_role: i32,
    #[prost(uint64, tag = "6")]
    generation: u64,
    #[prost(message, optional, tag = "7")]
    evidence: Option<WireReadinessEvidence>,
}

#[derive(Clone, PartialEq, Message)]
struct WireWorkerHeartbeat {
    #[prost(bytes = "vec", tag = "1")]
    boot_id: Vec<u8>,
    #[prost(uint32, tag = "2")]
    worker_id: u32,
    #[prost(enumeration = "WireWorkerRole", tag = "3")]
    worker_role: i32,
    #[prost(uint64, tag = "4")]
    generation: u64,
    #[prost(uint64, tag = "5")]
    sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
#[repr(i32)]
enum WireWorkerRole {
    Unspecified = 0,
    AudioEngine = 1,
    Sequencer = 2,
    Media = 3,
    ClientGateway = 4,
    Replay = 5,
    ReceiverAdapter = 6,
}

#[derive(Clone, PartialEq, Message)]
struct WireReadinessEvidence {
    #[prost(oneof = "wire_readiness_evidence::Kind", tags = "1, 2, 3, 4")]
    kind: Option<wire_readiness_evidence::Kind>,
}

mod wire_readiness_evidence {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub(super) enum Kind {
        #[prost(message, tag = "1")]
        Basic(super::WireEmpty),
        #[prost(message, tag = "2")]
        DeviceVerified(super::WireDeviceVerified),
        #[prost(message, tag = "3")]
        LedgerChecked(super::WireEmpty),
        #[prost(message, tag = "4")]
        FreshMediaSessions(super::WireEmpty),
    }
}

#[derive(Clone, PartialEq, Message)]
struct WireEmpty {}

#[derive(Clone, PartialEq, Message)]
struct WireDeviceVerified {
    #[prost(uint64, tag = "1")]
    capture_epoch: u64,
}

impl From<&ControlMessage> for WireMessage {
    fn from(message: &ControlMessage) -> Self {
        let body = match &message.body {
            ControlBody::HealthProbe { deadline_ms } => {
                wire_message::Body::HealthProbe(WireHealthProbe {
                    deadline_ms: *deadline_ms,
                })
            }
            ControlBody::WorkerReady { worker, evidence } => {
                wire_message::Body::WorkerReady(WireWorkerReady {
                    legacy_boot_id: 0,
                    legacy_worker_kind: None,
                    boot_id: worker.boot_id.to_be_bytes().to_vec(),
                    worker_id: u32::from(worker.worker_id),
                    worker_role: WireWorkerRole::from(worker.role) as i32,
                    generation: worker.generation,
                    evidence: Some((*evidence).into()),
                })
            }
            ControlBody::WorkerHeartbeat { worker, sequence } => {
                wire_message::Body::WorkerHeartbeat(WireWorkerHeartbeat {
                    boot_id: worker.boot_id.to_be_bytes().to_vec(),
                    worker_id: u32::from(worker.worker_id),
                    worker_role: WireWorkerRole::from(worker.role) as i32,
                    generation: worker.generation,
                    sequence: *sequence,
                })
            }
        };
        Self {
            protocol_version: message.protocol_version,
            message_kind: match message.message_kind {
                MessageKind::HealthProbe => WireMessageKind::HealthProbe as i32,
                MessageKind::WorkerReady => WireMessageKind::WorkerReady as i32,
                MessageKind::WorkerHeartbeat => WireMessageKind::WorkerHeartbeat as i32,
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
            Ok(WireMessageKind::WorkerHeartbeat) => MessageKind::WorkerHeartbeat,
            _ => return Err(CodecError::InvalidSemantic("unknown message kind")),
        };
        let body = match message.body {
            Some(wire_message::Body::HealthProbe(body)) => ControlBody::HealthProbe {
                deadline_ms: body.deadline_ms,
            },
            Some(wire_message::Body::WorkerReady(body)) => {
                if body.legacy_boot_id != 0 || body.legacy_worker_kind.is_some() {
                    return Err(CodecError::InvalidSemantic(
                        "legacy untyped worker-ready body is unsupported",
                    ));
                }
                ControlBody::WorkerReady {
                    worker: worker_identity(
                        &body.boot_id,
                        body.worker_id,
                        body.worker_role,
                        body.generation,
                    )?,
                    evidence: body
                        .evidence
                        .ok_or(CodecError::InvalidSemantic(
                            "readiness evidence is required",
                        ))?
                        .try_into()?,
                }
            }
            Some(wire_message::Body::WorkerHeartbeat(body)) => ControlBody::WorkerHeartbeat {
                worker: worker_identity(
                    &body.boot_id,
                    body.worker_id,
                    body.worker_role,
                    body.generation,
                )?,
                sequence: body.sequence,
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

fn worker_identity(
    boot_id: &[u8],
    worker_id: u32,
    worker_role: i32,
    generation: u64,
) -> Result<WorkerIdentity, CodecError> {
    let boot_id = <[u8; 16]>::try_from(boot_id)
        .map(u128::from_be_bytes)
        .map_err(|_| CodecError::InvalidSemantic("worker boot ID must contain 16 bytes"))?;
    let worker_id = u16::try_from(worker_id)
        .map_err(|_| CodecError::InvalidSemantic("worker ID exceeds unsigned 16-bit range"))?;
    let role = match WireWorkerRole::try_from(worker_role) {
        Ok(WireWorkerRole::AudioEngine) => WorkerRole::AudioEngine,
        Ok(WireWorkerRole::Sequencer) => WorkerRole::Sequencer,
        Ok(WireWorkerRole::Media) => WorkerRole::Media,
        Ok(WireWorkerRole::ClientGateway) => WorkerRole::ClientGateway,
        Ok(WireWorkerRole::Replay) => WorkerRole::Replay,
        Ok(WireWorkerRole::ReceiverAdapter) => WorkerRole::ReceiverAdapter,
        _ => return Err(CodecError::InvalidSemantic("unknown worker role")),
    };
    Ok(WorkerIdentity {
        boot_id,
        worker_id,
        role,
        generation,
    })
}

impl From<WorkerRole> for WireWorkerRole {
    fn from(role: WorkerRole) -> Self {
        match role {
            WorkerRole::AudioEngine => Self::AudioEngine,
            WorkerRole::Sequencer => Self::Sequencer,
            WorkerRole::Media => Self::Media,
            WorkerRole::ClientGateway => Self::ClientGateway,
            WorkerRole::Replay => Self::Replay,
            WorkerRole::ReceiverAdapter => Self::ReceiverAdapter,
        }
    }
}

impl From<ReadinessEvidence> for WireReadinessEvidence {
    fn from(evidence: ReadinessEvidence) -> Self {
        use wire_readiness_evidence::Kind;
        let kind = match evidence {
            ReadinessEvidence::Basic => Kind::Basic(WireEmpty {}),
            ReadinessEvidence::DeviceVerified { capture_epoch } => {
                Kind::DeviceVerified(WireDeviceVerified { capture_epoch })
            }
            ReadinessEvidence::LedgerChecked => Kind::LedgerChecked(WireEmpty {}),
            ReadinessEvidence::FreshMediaSessions => Kind::FreshMediaSessions(WireEmpty {}),
        };
        Self { kind: Some(kind) }
    }
}

impl TryFrom<WireReadinessEvidence> for ReadinessEvidence {
    type Error = CodecError;

    fn try_from(evidence: WireReadinessEvidence) -> Result<Self, Self::Error> {
        use wire_readiness_evidence::Kind;
        Ok(match evidence.kind {
            Some(Kind::Basic(_)) => Self::Basic,
            Some(Kind::DeviceVerified(body)) => Self::DeviceVerified {
                capture_epoch: body.capture_epoch,
            },
            Some(Kind::LedgerChecked(_)) => Self::LedgerChecked,
            Some(Kind::FreshMediaSessions(_)) => Self::FreshMediaSessions,
            None => {
                return Err(CodecError::InvalidSemantic(
                    "readiness evidence kind is required",
                ));
            }
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

    fn worker(role: WorkerRole) -> WorkerIdentity {
        WorkerIdentity {
            boot_id: 0x0011_2233_4455_6677_8899_aabb_ccdd_eeff,
            worker_id: u16::MAX,
            role,
            generation: u64::MAX,
        }
    }

    fn worker_ready() -> ControlMessage {
        ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::WorkerReady,
            request_id: u64::MAX,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::WorkerReady {
                worker: worker(WorkerRole::Media),
                evidence: ReadinessEvidence::FreshMediaSessions,
            },
        }
    }

    fn worker_heartbeat() -> ControlMessage {
        ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::WorkerHeartbeat,
            request_id: 43,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::WorkerHeartbeat {
                worker: worker(WorkerRole::Media),
                sequence: u64::MAX,
            },
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
    fn golden_worker_ready_matches_both_encodings() {
        let comparison = compare_codecs(&worker_ready(), 1024).unwrap();
        assert_eq!(
            comparison.canonical_json,
            br#"{"authority_epoch":null,"body":{"boot_id":"00112233445566778899aabbccddeeff","evidence":{"kind":"fresh_media_sessions"},"generation":"18446744073709551615","worker_id":65535,"worker_role":"media"},"capture_epoch":null,"message_kind":"worker_ready","protocol_version":2,"request_id":"18446744073709551615"}"#
        );
        assert_eq!(
            comparison.protobuf,
            [
                0x08, 0x02, 0x10, 0x02, 0x18, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                0x01, 0x5a, 0x27, 0x1a, 0x10, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
                0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x20, 0xff, 0xff, 0x03, 0x28, 0x03, 0x30,
                0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x3a, 0x02, 0x22, 0x00,
            ]
        );
    }

    #[test]
    fn golden_worker_heartbeat_matches_both_encodings() {
        let comparison = compare_codecs(&worker_heartbeat(), 1024).unwrap();
        assert_eq!(
            comparison.canonical_json,
            br#"{"authority_epoch":null,"body":{"boot_id":"00112233445566778899aabbccddeeff","generation":"18446744073709551615","sequence":"18446744073709551615","worker_id":65535,"worker_role":"media"},"capture_epoch":null,"message_kind":"worker_heartbeat","protocol_version":2,"request_id":"43"}"#
        );
        assert_eq!(
            comparison.protobuf,
            [
                0x08, 0x02, 0x10, 0x03, 0x18, 0x2b, 0x62, 0x2e, 0x0a, 0x10, 0x00, 0x11, 0x22, 0x33,
                0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x10, 0xff,
                0xff, 0x03, 0x18, 0x03, 0x20, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                0x01, 0x28, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
            ]
        );
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
    fn health_vector_preserves_v1_and_rejects_unknown_versions() {
        let json_codec = CanonicalJsonCodec::new(1024).unwrap();
        let json_payload = br#"{"authority_epoch":"7","body":{"deadline_ms":250},"capture_epoch":null,"message_kind":"health_probe","protocol_version":3,"request_id":"42"}"#;
        assert_eq!(
            json_codec.decode(json_payload),
            Err(CodecError::InvalidSemantic("unsupported protocol version"))
        );

        let protobuf_codec = ProtobufCodec::new(1024).unwrap();
        let mut protobuf_payload = protobuf_codec.encode(&health_probe()).unwrap();
        assert_eq!(&protobuf_payload[..2], &[0x08, 0x01]);
        protobuf_payload[1] = 0x03;
        assert_eq!(
            protobuf_codec.decode(&protobuf_payload),
            Err(CodecError::InvalidSemantic("unsupported protocol version"))
        );
    }

    #[test]
    fn worker_messages_fail_closed_on_v1() {
        for message in [worker_ready(), worker_heartbeat()] {
            let mut legacy = message.clone();
            legacy.protocol_version = 1;
            assert_eq!(
                CanonicalJsonCodec::new(1024).unwrap().encode(&legacy),
                Err(CodecError::InvalidSemantic(
                    "worker control requires protocol version 2"
                ))
            );

            let codec = ProtobufCodec::new(1024).unwrap();
            let mut bytes = codec.encode(&message).unwrap();
            assert_eq!(&bytes[..2], &[0x08, 0x02]);
            bytes[1] = 0x01;
            assert_eq!(
                codec.decode(&bytes),
                Err(CodecError::InvalidSemantic(
                    "worker control requires protocol version 2"
                ))
            );
        }

        let legacy = WireMessage {
            protocol_version: 1,
            message_kind: WireMessageKind::WorkerReady as i32,
            request_id: 1,
            authority_epoch: None,
            capture_epoch: None,
            body: Some(wire_message::Body::WorkerReady(WireWorkerReady {
                legacy_boot_id: 82,
                legacy_worker_kind: Some("media-worker".to_owned()),
                boot_id: Vec::new(),
                worker_id: 0,
                worker_role: WireWorkerRole::Unspecified as i32,
                generation: 0,
                evidence: None,
            })),
        };
        assert_eq!(
            ProtobufCodec::new(1024)
                .unwrap()
                .decode(&legacy.encode_to_vec()),
            Err(CodecError::InvalidSemantic(
                "legacy untyped worker-ready body is unsupported"
            ))
        );
    }

    #[test]
    fn rejects_invalid_worker_identity_and_evidence() {
        let codec = CanonicalJsonCodec::new(1024).unwrap();
        let mut message = worker_ready();
        if let ControlBody::WorkerReady { worker, .. } = &mut message.body {
            worker.boot_id = 0;
        }
        assert_eq!(
            codec.encode(&message),
            Err(CodecError::InvalidSemantic(
                "worker boot ID must be nonzero"
            ))
        );

        let mut message = worker_ready();
        if let ControlBody::WorkerReady { worker, evidence } = &mut message.body {
            worker.generation = 0;
            *evidence = ReadinessEvidence::Basic;
        }
        assert_eq!(
            codec.encode(&message),
            Err(CodecError::InvalidSemantic(
                "worker generation must be nonzero"
            ))
        );

        let mut message = worker_ready();
        if let ControlBody::WorkerReady { evidence, .. } = &mut message.body {
            *evidence = ReadinessEvidence::Basic;
        }
        assert_eq!(
            codec.encode(&message),
            Err(CodecError::InvalidSemantic(
                "readiness evidence does not match worker role"
            ))
        );

        let mut message = worker_heartbeat();
        if let ControlBody::WorkerHeartbeat { sequence, .. } = &mut message.body {
            *sequence = 0;
        }
        assert_eq!(
            codec.encode(&message),
            Err(CodecError::InvalidSemantic(
                "heartbeat sequence must be nonzero"
            ))
        );

        let mut message = worker_ready();
        if let ControlBody::WorkerReady { worker, evidence } = &mut message.body {
            worker.role = WorkerRole::AudioEngine;
            *evidence = ReadinessEvidence::DeviceVerified { capture_epoch: 0 };
        }
        assert_eq!(
            codec.encode(&message),
            Err(CodecError::InvalidSemantic(
                "device-verified capture epoch must be nonzero"
            ))
        );
    }

    #[test]
    fn worker_control_rejects_legacy_envelope_epochs_on_encode_and_decode() {
        for message in [worker_ready(), worker_heartbeat()] {
            for field in ["authority_epoch", "capture_epoch"] {
                let mut invalid = message.clone();
                if field == "authority_epoch" {
                    invalid.authority_epoch = Some(9);
                } else {
                    invalid.capture_epoch = Some(9);
                }
                let expected =
                    CodecError::InvalidSemantic("worker control envelope epochs must be absent");
                assert_eq!(
                    CanonicalJsonCodec::new(1024).unwrap().encode(&invalid),
                    Err(expected.clone())
                );
                assert_eq!(
                    ProtobufCodec::new(1024).unwrap().encode(&invalid),
                    Err(expected.clone())
                );

                let json_codec = CanonicalJsonCodec::new(1024).unwrap();
                let valid_json = String::from_utf8(json_codec.encode(&message).unwrap()).unwrap();
                let forged_json =
                    valid_json.replace(&format!("\"{field}\":null"), &format!("\"{field}\":\"9\""));
                assert_eq!(
                    json_codec.decode(forged_json.as_bytes()),
                    Err(expected.clone())
                );

                let protobuf_codec = ProtobufCodec::new(1024).unwrap();
                let mut wire = WireMessage::from(&message);
                if field == "authority_epoch" {
                    wire.authority_epoch = Some(9);
                } else {
                    wire.capture_epoch = Some(9);
                }
                assert_eq!(
                    protobuf_codec.decode(&wire.encode_to_vec()),
                    Err(expected.clone())
                );
            }
        }
    }

    #[test]
    fn rejects_noncanonical_json_boot_ids() {
        let codec = CanonicalJsonCodec::new(1024).unwrap();
        let canonical = codec.encode(&worker_heartbeat()).unwrap();
        for invalid in [
            "0112233445566778899aabbccddeeff",
            "00112233445566778899AABBCCDDEEFF",
        ] {
            let payload = String::from_utf8(canonical.clone())
                .unwrap()
                .replace("00112233445566778899aabbccddeeff", invalid);
            assert_eq!(
                codec.decode(payload.as_bytes()),
                Err(CodecError::InvalidSemantic(
                    "boot ID must be 32 lowercase hexadecimal characters"
                ))
            );
        }
    }

    #[test]
    fn protobuf_rejects_lossy_worker_fields() {
        let codec = ProtobufCodec::new(1024).unwrap();
        let mut wire = WireMessage::from(&worker_heartbeat());
        let Some(wire_message::Body::WorkerHeartbeat(body)) = &mut wire.body else {
            panic!("heartbeat body")
        };
        body.boot_id.pop();
        let bytes = wire.encode_to_vec();
        assert_eq!(
            codec.decode(&bytes),
            Err(CodecError::InvalidSemantic(
                "worker boot ID must contain 16 bytes"
            ))
        );

        let mut wire = WireMessage::from(&worker_heartbeat());
        let Some(wire_message::Body::WorkerHeartbeat(body)) = &mut wire.body else {
            panic!("heartbeat body")
        };
        body.worker_id = u32::from(u16::MAX) + 1;
        let bytes = wire.encode_to_vec();
        assert_eq!(
            codec.decode(&bytes),
            Err(CodecError::InvalidSemantic(
                "worker ID exceeds unsigned 16-bit range"
            ))
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
