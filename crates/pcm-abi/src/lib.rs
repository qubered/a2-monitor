//! Dependency-free descriptor/region layout and state-machine model for the shared PCM ABI.
//!
//! The model is intentionally single-threaded and does not claim that ordinary Rust memory is a
//! safe concurrent cross-process slot handoff. It does not create OS mappings, handles, ACLs, or
//! processes. Producer-state, diagnostic and slot-header bytes are not frozen; an OS
//! implementation must supply and verify those mechanisms separately.

mod layout;
mod ring;

pub use layout::{
    ABI_MAJOR, ABI_MINOR, AbiError, PcmAbiConfig, PcmDescriptor, PcmLayout, SampleFormat,
    decode_descriptor, initialize_descriptor,
};
pub use ring::{
    AttachError, Consumer, ConsumerAttach, PcmBlockMetadata, PeerFault, Producer, ProducerAttach,
    PublishError, PublishOutcome, ReadError, ReadOutcome, SequenceRange, SharedPcmRing,
};
