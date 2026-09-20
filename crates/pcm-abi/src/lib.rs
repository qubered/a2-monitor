//! Dependency-free descriptor/region layout and state-machine model for the shared PCM ABI.
//!
//! The serialized ABI state-machine model is intentionally single-threaded. A separate in-process
//! SPSC model uses atomic storage to exercise concurrent overwrite/read behavior without changing
//! the serialized model's `Send`/`Sync` boundary. Neither model creates OS mappings, handles, ACLs,
//! or processes, or proves cross-process atomic compatibility. Producer-state, diagnostic and
//! slot-header bytes are not frozen; an OS implementation must supply and verify those mechanisms.

mod layout;
mod ring;
mod spsc;

pub use layout::{
    ABI_MAJOR, ABI_MINOR, AbiError, PcmAbiConfig, PcmDescriptor, PcmLayout, SampleFormat,
    decode_descriptor, initialize_descriptor,
};
pub use ring::{
    AttachError, Consumer, ConsumerAttach, PcmBlockMetadata, PeerFault, Producer, ProducerAttach,
    PublishError, PublishOutcome, ReadError, ReadOutcome, SequenceRange, SharedPcmRing,
};
pub use spsc::{
    ConcurrentAttachError, ConcurrentBlockRange, ConcurrentConsumer, ConcurrentOverwrittenBlock,
    ConcurrentPcmRing, ConcurrentProducer, ConcurrentPublishError, ConcurrentPublishOutcome,
    ConcurrentPublishedBlock, ConcurrentReadOutcome, FrameRange,
};
