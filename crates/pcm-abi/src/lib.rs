//! Dependency-free descriptor/region layout and state-machine model for the shared PCM ABI.
//!
//! The serialized ABI state-machine model is intentionally single-threaded. Separate in-process
//! models cover an all-atomic reference and the minor-2 ordinary-payload ownership candidate.
//! None creates OS mappings, handles, ACLs or processes, or proves cross-process atomic
//! compatibility. Non-ledger diagnostic bytes remain unfrozen; a platform implementation must supply and
//! verify mapped atomic lifetime, least-write views, peer identity, cleanup and confinement.

mod layout;
mod ordinary;
mod ring;
mod spsc;

pub use layout::{
    ABI_MAJOR, ABI_MINOR, AbiError, CONSUMER_CONSUMED_NEXT_OFFSET,
    CONSUMER_DROPPED_LOSS_CONSUMED_NEXT_OFFSET, CONSUMER_OVERWRITE_LOSS_CONSUMED_NEXT_OFFSET,
    CONSUMER_READ_CLAIM_OFFSET, LOSS_CAPTURE_EPOCH_OFFSET, LOSS_COMMITTED_SEQUENCE_OFFSET,
    LOSS_END_FRAME_INDEX_OFFSET, LOSS_ENTRY_BYTES, LOSS_FIRST_FRAME_INDEX_OFFSET,
    LOSS_KIND_DROPPED_INCOMING, LOSS_KIND_OFFSET, LOSS_KIND_OVERWRITTEN,
    LOSS_ORDERING_PUBLICATION_OFFSET, LOSS_SOURCE_SEQUENCE_OFFSET, NO_CLAIM_SEQUENCE,
    ORDINARY_OWNERSHIP_MINOR, OrdinaryLossEntry, OrdinarySlotHeader,
    PRODUCER_DROPPED_LOSS_PUBLISHED_NEXT_OFFSET, PRODUCER_OVERWRITE_CLAIM_OFFSET,
    PRODUCER_OVERWRITE_LOSS_PUBLISHED_NEXT_OFFSET, PRODUCER_PUBLISHED_NEXT_OFFSET, PcmAbiConfig,
    PcmDescriptor, PcmLayout, SLOT_CAPTURE_EPOCH_OFFSET, SLOT_CHANNEL_COUNT_OFFSET,
    SLOT_COMMITTED_SEQUENCE_OFFSET, SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET,
    SLOT_DISCONTINUITY_FLAGS_OFFSET, SLOT_FIRST_FRAME_INDEX_OFFSET, SLOT_FRAME_COUNT_OFFSET,
    SLOT_HEADER_BYTES, SLOT_MONOTONIC_CAPTURE_NS_OFFSET, SLOT_PRESENCE_FLAGS_OFFSET,
    SLOT_RESERVED_OFFSET, SLOT_SOURCE_SEQUENCE_OFFSET, SLOT_TIMING_UNCERTAINTY_NS_OFFSET,
    SampleFormat, decode_descriptor, encode_ordinary_loss_entry, encode_ordinary_slot_header,
    initialize_descriptor, initialize_ordinary_loss_slots, initialize_ordinary_state_pages,
};
pub use ordinary::{
    OrdinaryAttachError, OrdinaryConsumer, OrdinaryFenceReason, OrdinaryLoss, OrdinaryLossKind,
    OrdinaryPcmRing, OrdinaryPeerFault, OrdinaryProducer, OrdinaryPublishError,
    OrdinaryPublishOutcome, OrdinaryPublishedBlock, OrdinaryReadOutcome, STATE_CLAIM_OFFSET,
    STATE_CURSOR_OFFSET, STATE_EPOCH_OFFSET, STATE_GENERATION_OFFSET, STATE_MAGIC_OFFSET,
    STATE_MAJOR_OFFSET, STATE_MINOR_OFFSET, STATE_RESERVED_OFFSET,
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
