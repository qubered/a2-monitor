//! Bounded native control framing and codec comparison primitives.
//!
//! The semantic types in this crate are project-owned. Generated/wire codec
//! details remain private and cannot leak into workers.

mod codec;
mod framing;

pub use codec::{
    CONTROL_PROTOCOL_VERSION, CanonicalJsonCodec, CodecComparison, CodecError, ControlBody,
    ControlCodec, ControlMessage, MessageKind, ProtobufCodec, ReadinessEvidence, WorkerIdentity,
    WorkerRole, compare_codecs,
};
pub use framing::{FrameDecoder, FrameEncoder, FrameError, PushResult};
