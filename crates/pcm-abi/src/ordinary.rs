//! In-process candidate for publishing ordinary PCM bytes between one producer and consumer.
//!
//! Metadata and samples are ordinary storage protected by an explicit two-party claim
//! handshake. Only publication, cursor, claim, and commit cells are atomic. This model does not
//! create an OS mapping, authenticate a peer, enforce page permissions, or establish that Rust
//! atomics are a stable cross-process or cross-language ABI.

use std::cell::UnsafeCell;
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};

use crate::{
    AbiError, ConcurrentBlockRange, ConcurrentOverwrittenBlock, FrameRange, NO_CLAIM_SEQUENCE,
    ORDINARY_OWNERSHIP_MINOR, PcmAbiConfig, PcmBlockMetadata, PcmDescriptor, PcmLayout, ReadError,
    SequenceRange,
};

#[cfg(test)]
use crate::{
    SLOT_CAPTURE_EPOCH_OFFSET, SLOT_CHANNEL_COUNT_OFFSET, SLOT_COMMITTED_SEQUENCE_OFFSET,
    SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET, SLOT_DISCONTINUITY_FLAGS_OFFSET,
    SLOT_FIRST_FRAME_INDEX_OFFSET, SLOT_FRAME_COUNT_OFFSET, SLOT_HEADER_BYTES,
    SLOT_MONOTONIC_CAPTURE_NS_OFFSET, SLOT_PRESENCE_FLAGS_OFFSET, SLOT_RESERVED_OFFSET,
    SLOT_SOURCE_SEQUENCE_OFFSET, SLOT_TIMING_UNCERTAINTY_NS_OFFSET,
};

pub const STATE_MAGIC_OFFSET: usize = 0;
pub const STATE_MAJOR_OFFSET: usize = 8;
pub const STATE_MINOR_OFFSET: usize = 10;
pub const STATE_RESERVED_OFFSET: usize = 12;
pub const STATE_GENERATION_OFFSET: usize = 16;
pub const STATE_EPOCH_OFFSET: usize = 24;
pub const STATE_CURSOR_OFFSET: usize = 32;
pub const STATE_CLAIM_OFFSET: usize = 40;

const PRODUCER_MAGIC: [u8; 8] = *b"A2PPROD\0";
const CONSUMER_MAGIC: [u8; 8] = *b"A2PCON\0\0";
const STATE_IDENTITY_BYTES: usize = STATE_CURSOR_OFFSET;
const MONOTONIC_PRESENT: u16 = 1 << 0;
const UNCERTAINTY_PRESENT: u16 = 1 << 1;
const KNOWN_PRESENCE_FLAGS: u16 = MONOTONIC_PRESENT | UNCERTAINTY_PRESENT;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryAttachError {
    GenerationMismatch,
    EpochMismatch,
}

impl Display for OrdinaryAttachError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot attach ordinary PCM endpoints: {self:?}")
    }
}

impl Error for OrdinaryAttachError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryPublishError {
    EpochMismatch,
    ChannelMismatch,
    InvalidFrameCount,
    SampleCountMismatch,
    FrameIndexOverflow,
    SourceSequenceNotIncreasing,
    SequenceExhausted,
    Fenced,
}

impl Display for OrdinaryPublishError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot publish ordinary PCM block: {self:?}")
    }
}

impl Error for OrdinaryPublishError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryPeerFault {
    InvalidConsumerIdentity,
    InvalidConsumedSequence,
    InvalidConsumerClaim,
    InvalidPublishedSequence,
    CorruptSlot,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryPublishOutcome {
    Published {
        publication_sequence: u64,
        overwritten: Option<ConcurrentOverwrittenBlock>,
        peer_fault: Option<OrdinaryPeerFault>,
    },
    DroppedIncoming {
        source: ConcurrentBlockRange,
        dropped_newest_blocks: u64,
        peer_fault: Option<OrdinaryPeerFault>,
    },
    Fenced {
        rejected: ConcurrentBlockRange,
        reason: OrdinaryFenceReason,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryFenceReason {
    LossLedgerExhausted,
    CorruptProducerState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryLossKind {
    Overwritten { publication_sequence: u64 },
    DroppedIncoming { after_publication_sequence: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OrdinaryLoss {
    pub kind: OrdinaryLossKind,
    pub source: ConcurrentBlockRange,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OrdinaryPublishedBlock {
    pub publication_sequence: u64,
    pub source: PcmBlockMetadata,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrdinaryReadOutcome {
    Empty,
    Block(OrdinaryPublishedBlock),
    Gap(SequenceRange),
    Loss(OrdinaryLoss),
    Retry,
    RemapRequired(OrdinaryPeerFault),
}

pub struct OrdinaryPcmRing {
    inner: Arc<Inner>,
}

pub struct OrdinaryProducer {
    inner: Arc<Inner>,
    next_sequence: u64,
    loss_floor: u64,
    last_source_sequence: Option<u64>,
    dropped_newest_blocks: u64,
}

pub struct OrdinaryConsumer {
    inner: Arc<Inner>,
    next_sequence: u64,
}

struct Inner {
    config: PcmAbiConfig,
    layout: PcmLayout,
    producer_identity: [u8; STATE_IDENTITY_BYTES],
    consumer_identity: [AtomicU8; STATE_IDENTITY_BYTES],
    published_next: AtomicU64,
    overwrite_claim: AtomicU64,
    consumed_next: AtomicU64,
    read_claim: AtomicU64,
    slots: Box<[OrdinarySlot]>,
    overwrite_losses: LossJournal,
    dropped_losses: LossJournal,
    fenced: AtomicBool,
}

struct OrdinarySlot {
    committed_sequence: AtomicU64,
    payload: UnsafeCell<OrdinarySlotPayload>,
}

struct OrdinarySlotPayload {
    source_sequence: u64,
    capture_epoch: u64,
    first_frame_index: u64,
    monotonic_capture_ns: u64,
    cumulative_source_xruns: u64,
    frame_count: u16,
    channel_count: u16,
    presence_flags: u16,
    reserved: u16,
    timing_uncertainty_ns: u32,
    discontinuity_flags: u32,
    samples: Box<[f32]>,
}

struct LossSlot {
    committed_sequence: AtomicU64,
    loss: UnsafeCell<OrdinaryLoss>,
}

struct LossJournal {
    published_next: AtomicU64,
    consumed_next: AtomicU64,
    slots: Box<[LossSlot]>,
}

// Safety: cooperative access to the UnsafeCell is serialized by the SeqCst claim handshake.
// The producer is the sole writer. The consumer reads only while holding its claim and after it
// has proved that the producer does not own the same publication sequence.
unsafe impl Sync for OrdinarySlot {}
// Safety: loss entries are never overwritten until the sole consumer publishes progress. The
// producer commits an entry with Release only after writing it, and the consumer acquires the
// matching commit before reading it.
unsafe impl Sync for LossSlot {}

impl OrdinaryPcmRing {
    pub fn from_descriptor(descriptor: PcmDescriptor) -> Result<Self, AbiError> {
        if descriptor.abi_minor != ORDINARY_OWNERSHIP_MINOR {
            return Err(AbiError::IncompatibleVersion);
        }
        let config = descriptor.config;
        let layout = PcmLayout::checked(config)?;
        if descriptor.layout != layout {
            return Err(AbiError::InvalidLayout);
        }
        debug_assert_eq!(layout.slot_stride % align_of::<AtomicU64>(), 0);

        let sample_capacity = usize::from(config.channels)
            .checked_mul(usize::from(config.frames_per_slot))
            .ok_or(AbiError::SizeOverflow)?;
        let mut slots = Vec::new();
        slots
            .try_reserve_exact(config.capacity as usize)
            .map_err(|_| AbiError::AllocationFailed)?;
        for _ in 0..config.capacity {
            let mut samples = Vec::new();
            samples
                .try_reserve_exact(sample_capacity)
                .map_err(|_| AbiError::AllocationFailed)?;
            samples.resize(sample_capacity, 0.0);
            slots.push(OrdinarySlot {
                committed_sequence: AtomicU64::new(NO_CLAIM_SEQUENCE),
                payload: UnsafeCell::new(OrdinarySlotPayload {
                    source_sequence: 0,
                    capture_epoch: config.capture_epoch,
                    first_frame_index: 0,
                    monotonic_capture_ns: 0,
                    cumulative_source_xruns: 0,
                    frame_count: 0,
                    channel_count: config.channels,
                    presence_flags: 0,
                    reserved: 0,
                    timing_uncertainty_ns: 0,
                    discontinuity_flags: 0,
                    samples: samples.into_boxed_slice(),
                }),
            });
        }

        let overwrite_losses = loss_journal(
            config,
            OrdinaryLossKind::Overwritten {
                publication_sequence: 0,
            },
        )?;
        let dropped_losses = loss_journal(
            config,
            OrdinaryLossKind::DroppedIncoming {
                after_publication_sequence: 0,
            },
        )?;

        let producer_identity = state_identity(PRODUCER_MAGIC, config);
        let consumer_bytes = state_identity(CONSUMER_MAGIC, config);
        let consumer_identity = std::array::from_fn(|index| AtomicU8::new(consumer_bytes[index]));
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                layout,
                producer_identity,
                consumer_identity,
                published_next: AtomicU64::new(0),
                overwrite_claim: AtomicU64::new(NO_CLAIM_SEQUENCE),
                consumed_next: AtomicU64::new(0),
                read_claim: AtomicU64::new(NO_CLAIM_SEQUENCE),
                slots: slots.into_boxed_slice(),
                overwrite_losses,
                dropped_losses,
                fenced: AtomicBool::new(false),
            }),
        })
    }

    #[must_use]
    pub fn layout(&self) -> PcmLayout {
        self.inner.layout
    }

    /// Returns the immutable logical producer-state identity bytes used by this model.
    #[must_use]
    pub fn producer_state_identity(&self) -> &[u8] {
        &self.inner.producer_identity
    }

    pub fn split(
        self,
        mapping_generation: u64,
        capture_epoch: u64,
    ) -> Result<(OrdinaryProducer, OrdinaryConsumer), OrdinaryAttachError> {
        if mapping_generation != self.inner.config.mapping_generation {
            return Err(OrdinaryAttachError::GenerationMismatch);
        }
        if capture_epoch != self.inner.config.capture_epoch {
            return Err(OrdinaryAttachError::EpochMismatch);
        }
        Ok((
            OrdinaryProducer {
                inner: Arc::clone(&self.inner),
                next_sequence: 0,
                loss_floor: 0,
                last_source_sequence: None,
                dropped_newest_blocks: 0,
            },
            OrdinaryConsumer {
                inner: self.inner,
                next_sequence: 0,
            },
        ))
    }
}

impl OrdinaryProducer {
    #[must_use]
    pub fn dropped_newest_blocks(&self) -> u64 {
        self.dropped_newest_blocks
    }

    pub fn publish(
        &mut self,
        metadata: PcmBlockMetadata,
        samples: &[f32],
    ) -> Result<OrdinaryPublishOutcome, OrdinaryPublishError> {
        validate_block(self.inner.config, metadata, samples)?;
        if self.inner.fenced.load(Ordering::Acquire) {
            return Err(OrdinaryPublishError::Fenced);
        }
        if self
            .last_source_sequence
            .is_some_and(|previous| metadata.sequence <= previous)
        {
            return Err(OrdinaryPublishError::SourceSequenceNotIncreasing);
        }
        if self.next_sequence == NO_CLAIM_SEQUENCE {
            return Err(OrdinaryPublishError::SequenceExhausted);
        }

        let sequence = self.next_sequence;
        let capacity = u64::from(self.inner.config.capacity);
        let slot = &self.inner.slots[(sequence % capacity) as usize];
        let victim = slot.committed_sequence.load(Ordering::Acquire);
        let expected_victim = sequence.checked_sub(capacity).unwrap_or(NO_CLAIM_SEQUENCE);
        if victim != expected_victim {
            self.inner.fenced.store(true, Ordering::Release);
            return Ok(OrdinaryPublishOutcome::Fenced {
                rejected: block_range(metadata),
                reason: OrdinaryFenceReason::CorruptProducerState,
            });
        }
        let mut claim = None;
        if victim != NO_CLAIM_SEQUENCE {
            self.inner.overwrite_claim.store(victim, Ordering::SeqCst);
            claim = Some(OverwriteClaim(&self.inner.overwrite_claim));
        }

        let mut peer_fault = validate_consumer_identity(&self.inner).err();
        let consumed = self.inner.consumed_next.load(Ordering::Acquire);
        let cursor_valid = consumed >= self.loss_floor && consumed <= sequence;
        if !cursor_valid && peer_fault.is_none() {
            peer_fault = Some(OrdinaryPeerFault::InvalidConsumedSequence);
        }
        let claim_value = self.inner.read_claim.load(Ordering::SeqCst);
        if claim_value != NO_CLAIM_SEQUENCE && claim_value != victim && peer_fault.is_none() {
            peer_fault = Some(OrdinaryPeerFault::InvalidConsumerClaim);
        }

        if victim != NO_CLAIM_SEQUENCE && claim_value == victim {
            let Some(next_dropped_count) = self.dropped_newest_blocks.checked_add(1) else {
                drop(claim);
                return Err(OrdinaryPublishError::SequenceExhausted);
            };
            let loss = OrdinaryLoss {
                kind: OrdinaryLossKind::DroppedIncoming {
                    after_publication_sequence: sequence,
                },
                source: block_range(metadata),
            };
            let Some(loss) = reserve_loss(&self.inner.dropped_losses, loss) else {
                drop(claim);
                self.inner.fenced.store(true, Ordering::Release);
                return Ok(OrdinaryPublishOutcome::Fenced {
                    rejected: block_range(metadata),
                    reason: OrdinaryFenceReason::LossLedgerExhausted,
                });
            };
            loss.commit();
            drop(claim);
            self.dropped_newest_blocks = next_dropped_count;
            self.last_source_sequence = Some(metadata.sequence);
            return Ok(OrdinaryPublishOutcome::DroppedIncoming {
                source: block_range(metadata),
                dropped_newest_blocks: self.dropped_newest_blocks,
                peer_fault,
            });
        }

        let effective_consumed = if cursor_valid {
            consumed
        } else {
            self.loss_floor
        };
        if effective_consumed > self.loss_floor {
            self.loss_floor = effective_consumed;
        }
        let overwritten = if victim != NO_CLAIM_SEQUENCE && victim >= self.loss_floor {
            // Safety: the producer claim is visible before inspecting the consumer claim. If the
            // consumer owned this victim, the branch above returned without touching the slot.
            let old = unsafe { &*slot.payload.get() };
            Some(ConcurrentOverwrittenBlock {
                publication_sequence: victim,
                source: payload_range(old),
            })
        } else {
            None
        };

        let reserved_loss = if let Some(overwritten) = overwritten {
            let loss = OrdinaryLoss {
                kind: OrdinaryLossKind::Overwritten {
                    publication_sequence: overwritten.publication_sequence,
                },
                source: overwritten.source,
            };
            let Some(loss) = reserve_loss(&self.inner.overwrite_losses, loss) else {
                drop(claim);
                self.inner.fenced.store(true, Ordering::Release);
                return Ok(OrdinaryPublishOutcome::Fenced {
                    rejected: block_range(metadata),
                    reason: OrdinaryFenceReason::LossLedgerExhausted,
                });
            };
            Some(loss)
        } else {
            None
        };

        slot.committed_sequence
            .store(NO_CLAIM_SEQUENCE, Ordering::Release);
        // Safety: the claim handshake above gives the producer exclusive access to this slot.
        let destination = unsafe { &mut *slot.payload.get() };
        write_payload(destination, metadata, samples);
        slot.committed_sequence.store(sequence, Ordering::Release);
        if let Some(loss) = reserved_loss {
            loss.commit();
        }
        drop(claim);

        self.next_sequence = sequence + 1;
        self.last_source_sequence = Some(metadata.sequence);
        self.loss_floor = self
            .loss_floor
            .max(self.next_sequence.saturating_sub(capacity));
        self.inner
            .published_next
            .store(self.next_sequence, Ordering::Release);
        Ok(OrdinaryPublishOutcome::Published {
            publication_sequence: sequence,
            overwritten,
            peer_fault,
        })
    }
}

impl OrdinaryConsumer {
    pub fn read_into(&mut self, output: &mut [f32]) -> Result<OrdinaryReadOutcome, ReadError> {
        if let Some(loss) = pop_loss(&self.inner, self.next_sequence) {
            if let OrdinaryLossKind::Overwritten {
                publication_sequence,
            } = loss.kind
            {
                let after = publication_sequence + 1;
                if after > self.next_sequence {
                    self.next_sequence = after;
                    self.inner.consumed_next.store(after, Ordering::Release);
                }
            }
            return Ok(OrdinaryReadOutcome::Loss(loss));
        }
        let published = self.inner.published_next.load(Ordering::Acquire);
        if published < self.next_sequence {
            return Ok(OrdinaryReadOutcome::RemapRequired(
                OrdinaryPeerFault::InvalidPublishedSequence,
            ));
        }
        // The producer commits exact loss before its later main publication release. The first
        // journal read may have preceded that release, so acquire and merge the journals again
        // before deriving an unattributed gap from the new publication frontier.
        if let Some(loss) = pop_loss(&self.inner, self.next_sequence) {
            if let OrdinaryLossKind::Overwritten {
                publication_sequence,
            } = loss.kind
            {
                let after = publication_sequence + 1;
                if after > self.next_sequence {
                    self.next_sequence = after;
                    self.inner.consumed_next.store(after, Ordering::Release);
                }
            }
            return Ok(OrdinaryReadOutcome::Loss(loss));
        }
        if published == self.next_sequence {
            return Ok(OrdinaryReadOutcome::Empty);
        }
        let capacity = u64::from(self.inner.config.capacity);
        if published - self.next_sequence > capacity {
            let earliest = published - capacity;
            let gap = SequenceRange {
                start: self.next_sequence,
                end_exclusive: earliest,
            };
            self.next_sequence = earliest;
            self.inner.consumed_next.store(earliest, Ordering::Release);
            return Ok(OrdinaryReadOutcome::Gap(gap));
        }

        let target = self.next_sequence;
        let slot = &self.inner.slots[(target % capacity) as usize];
        self.inner.read_claim.store(target, Ordering::SeqCst);
        let claim = ReadClaim(&self.inner.read_claim);
        if self.inner.overwrite_claim.load(Ordering::SeqCst) == target {
            return Ok(OrdinaryReadOutcome::Retry);
        }
        if slot.committed_sequence.load(Ordering::Acquire) != target {
            return Ok(OrdinaryReadOutcome::Retry);
        }

        // A producer that published a loss concurrently must have that loss observed before this
        // surviving block. Recheck after acquiring the publication and before copying PCM.
        if let Some(loss) = pop_loss(&self.inner, self.next_sequence) {
            if let OrdinaryLossKind::Overwritten {
                publication_sequence,
            } = loss.kind
            {
                let after = publication_sequence + 1;
                if after > self.next_sequence {
                    self.next_sequence = after;
                    self.inner.consumed_next.store(after, Ordering::Release);
                }
            }
            return Ok(OrdinaryReadOutcome::Loss(loss));
        }

        // Safety: the read claim is visible and no producer claim owns this target, so the
        // producer cannot start an ordinary write until this claim is cleared.
        let source = unsafe { &*slot.payload.get() };
        let metadata = match validate_payload(self.inner.config, source) {
            Ok(metadata) => metadata,
            Err(fault) => return Ok(OrdinaryReadOutcome::RemapRequired(fault)),
        };
        let sample_count = usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
        if output.len() < sample_count {
            return Err(ReadError::OutputTooSmall);
        }
        output[..sample_count].copy_from_slice(&source.samples[..sample_count]);
        if slot.committed_sequence.load(Ordering::Acquire) != target {
            return Ok(OrdinaryReadOutcome::Retry);
        }

        self.next_sequence = target + 1;
        self.inner
            .consumed_next
            .store(self.next_sequence, Ordering::Release);
        drop(claim);
        Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
            publication_sequence: target,
            source: metadata,
        }))
    }
}

struct OverwriteClaim<'a>(&'a AtomicU64);

impl Drop for OverwriteClaim<'_> {
    fn drop(&mut self) {
        self.0.store(NO_CLAIM_SEQUENCE, Ordering::SeqCst);
    }
}

struct ReadClaim<'a>(&'a AtomicU64);

impl Drop for ReadClaim<'_> {
    fn drop(&mut self) {
        self.0.store(NO_CLAIM_SEQUENCE, Ordering::SeqCst);
    }
}

fn state_identity(magic: [u8; 8], config: PcmAbiConfig) -> [u8; STATE_IDENTITY_BYTES] {
    let mut bytes = [0; STATE_IDENTITY_BYTES];
    bytes[STATE_MAGIC_OFFSET..STATE_MAGIC_OFFSET + 8].copy_from_slice(&magic);
    bytes[STATE_MAJOR_OFFSET..STATE_MAJOR_OFFSET + 2]
        .copy_from_slice(&crate::ABI_MAJOR.to_le_bytes());
    bytes[STATE_MINOR_OFFSET..STATE_MINOR_OFFSET + 2]
        .copy_from_slice(&ORDINARY_OWNERSHIP_MINOR.to_le_bytes());
    bytes[STATE_GENERATION_OFFSET..STATE_GENERATION_OFFSET + 8]
        .copy_from_slice(&config.mapping_generation.to_le_bytes());
    bytes[STATE_EPOCH_OFFSET..STATE_EPOCH_OFFSET + 8]
        .copy_from_slice(&config.capture_epoch.to_le_bytes());
    bytes
}

fn validate_consumer_identity(inner: &Inner) -> Result<(), OrdinaryPeerFault> {
    let expected = state_identity(CONSUMER_MAGIC, inner.config);
    if inner
        .consumer_identity
        .iter()
        .zip(expected)
        .all(|(actual, expected)| actual.load(Ordering::Acquire) == expected)
    {
        Ok(())
    } else {
        Err(OrdinaryPeerFault::InvalidConsumerIdentity)
    }
}

fn validate_block(
    config: PcmAbiConfig,
    metadata: PcmBlockMetadata,
    samples: &[f32],
) -> Result<(), OrdinaryPublishError> {
    if metadata.capture_epoch != config.capture_epoch {
        return Err(OrdinaryPublishError::EpochMismatch);
    }
    if metadata.channel_count != config.channels {
        return Err(OrdinaryPublishError::ChannelMismatch);
    }
    if metadata.frame_count == 0 || metadata.frame_count > config.frames_per_slot {
        return Err(OrdinaryPublishError::InvalidFrameCount);
    }
    let expected = usize::from(metadata.frame_count) * usize::from(metadata.channel_count);
    if samples.len() != expected {
        return Err(OrdinaryPublishError::SampleCountMismatch);
    }
    if metadata
        .first_frame_index
        .checked_add(u64::from(metadata.frame_count))
        .is_none()
    {
        return Err(OrdinaryPublishError::FrameIndexOverflow);
    }
    Ok(())
}

fn write_payload(
    destination: &mut OrdinarySlotPayload,
    metadata: PcmBlockMetadata,
    samples: &[f32],
) {
    destination.source_sequence = metadata.sequence;
    destination.capture_epoch = metadata.capture_epoch;
    destination.first_frame_index = metadata.first_frame_index;
    destination.monotonic_capture_ns = metadata.monotonic_capture_ns.unwrap_or(0);
    destination.cumulative_source_xruns = metadata.cumulative_source_xruns;
    destination.frame_count = metadata.frame_count;
    destination.channel_count = metadata.channel_count;
    destination.presence_flags = (u16::from(metadata.monotonic_capture_ns.is_some())
        * MONOTONIC_PRESENT)
        | (u16::from(metadata.timing_uncertainty_ns.is_some()) * UNCERTAINTY_PRESENT);
    destination.reserved = 0;
    destination.timing_uncertainty_ns = metadata.timing_uncertainty_ns.unwrap_or(0);
    destination.discontinuity_flags = metadata.discontinuity_flags;
    destination.samples[..samples.len()].copy_from_slice(samples);
    destination.samples[samples.len()..].fill(0.0);
}

fn validate_payload(
    config: PcmAbiConfig,
    payload: &OrdinarySlotPayload,
) -> Result<PcmBlockMetadata, OrdinaryPeerFault> {
    if payload.capture_epoch != config.capture_epoch
        || payload.channel_count != config.channels
        || payload.frame_count == 0
        || payload.frame_count > config.frames_per_slot
        || payload.presence_flags & !KNOWN_PRESENCE_FLAGS != 0
        || payload.reserved != 0
        || payload
            .first_frame_index
            .checked_add(u64::from(payload.frame_count))
            .is_none()
    {
        return Err(OrdinaryPeerFault::CorruptSlot);
    }
    let monotonic_present = payload.presence_flags & MONOTONIC_PRESENT != 0;
    let uncertainty_present = payload.presence_flags & UNCERTAINTY_PRESENT != 0;
    if (!monotonic_present && payload.monotonic_capture_ns != 0)
        || (!uncertainty_present && payload.timing_uncertainty_ns != 0)
    {
        return Err(OrdinaryPeerFault::CorruptSlot);
    }
    Ok(PcmBlockMetadata {
        sequence: payload.source_sequence,
        capture_epoch: payload.capture_epoch,
        first_frame_index: payload.first_frame_index,
        frame_count: payload.frame_count,
        channel_count: payload.channel_count,
        monotonic_capture_ns: monotonic_present.then_some(payload.monotonic_capture_ns),
        timing_uncertainty_ns: uncertainty_present.then_some(payload.timing_uncertainty_ns),
        discontinuity_flags: payload.discontinuity_flags,
        cumulative_source_xruns: payload.cumulative_source_xruns,
    })
}

fn block_range(metadata: PcmBlockMetadata) -> ConcurrentBlockRange {
    ConcurrentBlockRange {
        capture_epoch: metadata.capture_epoch,
        source_sequence: metadata.sequence,
        frames: FrameRange {
            start: metadata.first_frame_index,
            end_exclusive: metadata.first_frame_index + u64::from(metadata.frame_count),
        },
    }
}

fn payload_range(payload: &OrdinarySlotPayload) -> ConcurrentBlockRange {
    ConcurrentBlockRange {
        capture_epoch: payload.capture_epoch,
        source_sequence: payload.source_sequence,
        frames: FrameRange {
            start: payload.first_frame_index,
            end_exclusive: payload.first_frame_index + u64::from(payload.frame_count),
        },
    }
}

struct LossReservation<'a> {
    journal: &'a LossJournal,
    sequence: u64,
}

impl LossReservation<'_> {
    fn commit(self) {
        let capacity = u64::try_from(self.journal.slots.len()).expect("capacity fits u64");
        let slot = &self.journal.slots[(self.sequence % capacity) as usize];
        slot.committed_sequence
            .store(self.sequence, Ordering::Release);
        self.journal
            .published_next
            .store(self.sequence + 1, Ordering::Release);
    }
}

fn reserve_loss(journal: &LossJournal, loss: OrdinaryLoss) -> Option<LossReservation<'_>> {
    let published = journal.published_next.load(Ordering::Relaxed);
    if published == NO_CLAIM_SEQUENCE {
        return None;
    }
    let consumed = journal.consumed_next.load(Ordering::Acquire);
    let capacity = u64::try_from(journal.slots.len()).expect("capacity fits u64");
    if published < consumed || published - consumed >= capacity {
        return None;
    }
    let slot = &journal.slots[(published % capacity) as usize];
    // Safety: bounded progress proves the sole consumer released this entry before reuse.
    unsafe { *slot.loss.get() = loss };
    Some(LossReservation {
        journal,
        sequence: published,
    })
}

fn pop_loss(inner: &Inner, next_publication: u64) -> Option<OrdinaryLoss> {
    let overwritten = peek_loss(&inner.overwrite_losses);
    let dropped = peek_loss(&inner.dropped_losses);
    let selected = match (overwritten, dropped) {
        (Some(overwritten), Some(dropped)) => {
            if loss_ordering_publication(overwritten.1) < loss_ordering_publication(dropped.1) {
                Some((&inner.overwrite_losses, overwritten))
            } else {
                Some((&inner.dropped_losses, dropped))
            }
        }
        (Some(overwritten), None) => Some((&inner.overwrite_losses, overwritten)),
        (None, Some(dropped)) => Some((&inner.dropped_losses, dropped)),
        (None, None) => None,
    }?;
    let (journal, (consumed, loss)) = selected;
    if loss_ordering_publication(loss) > next_publication {
        return None;
    }
    journal.consumed_next.store(consumed + 1, Ordering::Release);
    Some(loss)
}

fn peek_loss(journal: &LossJournal) -> Option<(u64, OrdinaryLoss)> {
    let consumed = journal.consumed_next.load(Ordering::Relaxed);
    let published = journal.published_next.load(Ordering::Acquire);
    if consumed >= published {
        return None;
    }
    let capacity = u64::try_from(journal.slots.len()).expect("capacity fits u64");
    let slot = &journal.slots[(consumed % capacity) as usize];
    if slot.committed_sequence.load(Ordering::Acquire) != consumed {
        return None;
    }
    // Safety: the acquired commit matches this entry and the sole producer cannot reuse it until
    // the consumed cursor below is released.
    let loss = unsafe { *slot.loss.get() };
    Some((consumed, loss))
}

fn loss_ordering_publication(loss: OrdinaryLoss) -> u64 {
    match loss.kind {
        OrdinaryLossKind::Overwritten {
            publication_sequence,
        } => publication_sequence,
        OrdinaryLossKind::DroppedIncoming {
            after_publication_sequence,
        } => after_publication_sequence,
    }
}

fn loss_journal(
    config: PcmAbiConfig,
    initial_kind: OrdinaryLossKind,
) -> Result<LossJournal, AbiError> {
    let mut slots = Vec::new();
    slots
        .try_reserve_exact(config.capacity as usize)
        .map_err(|_| AbiError::AllocationFailed)?;
    for _ in 0..config.capacity {
        slots.push(LossSlot {
            committed_sequence: AtomicU64::new(NO_CLAIM_SEQUENCE),
            loss: UnsafeCell::new(OrdinaryLoss {
                kind: initial_kind,
                source: ConcurrentBlockRange {
                    capture_epoch: config.capture_epoch,
                    source_sequence: 0,
                    frames: FrameRange {
                        start: 0,
                        end_exclusive: 0,
                    },
                },
            }),
        });
    }
    Ok(LossJournal {
        published_next: AtomicU64::new(0),
        consumed_next: AtomicU64::new(0),
        slots: slots.into_boxed_slice(),
    })
}

#[cfg(test)]
fn encode_slot_header(sequence: u64, payload: &OrdinarySlotPayload) -> [u8; SLOT_HEADER_BYTES] {
    let mut bytes = [0; SLOT_HEADER_BYTES];
    bytes[SLOT_COMMITTED_SEQUENCE_OFFSET..SLOT_COMMITTED_SEQUENCE_OFFSET + 8]
        .copy_from_slice(&sequence.to_le_bytes());
    bytes[SLOT_SOURCE_SEQUENCE_OFFSET..SLOT_SOURCE_SEQUENCE_OFFSET + 8]
        .copy_from_slice(&payload.source_sequence.to_le_bytes());
    bytes[SLOT_CAPTURE_EPOCH_OFFSET..SLOT_CAPTURE_EPOCH_OFFSET + 8]
        .copy_from_slice(&payload.capture_epoch.to_le_bytes());
    bytes[SLOT_FIRST_FRAME_INDEX_OFFSET..SLOT_FIRST_FRAME_INDEX_OFFSET + 8]
        .copy_from_slice(&payload.first_frame_index.to_le_bytes());
    bytes[SLOT_MONOTONIC_CAPTURE_NS_OFFSET..SLOT_MONOTONIC_CAPTURE_NS_OFFSET + 8]
        .copy_from_slice(&payload.monotonic_capture_ns.to_le_bytes());
    bytes[SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET..SLOT_CUMULATIVE_SOURCE_XRUNS_OFFSET + 8]
        .copy_from_slice(&payload.cumulative_source_xruns.to_le_bytes());
    bytes[SLOT_FRAME_COUNT_OFFSET..SLOT_FRAME_COUNT_OFFSET + 2]
        .copy_from_slice(&payload.frame_count.to_le_bytes());
    bytes[SLOT_CHANNEL_COUNT_OFFSET..SLOT_CHANNEL_COUNT_OFFSET + 2]
        .copy_from_slice(&payload.channel_count.to_le_bytes());
    bytes[SLOT_PRESENCE_FLAGS_OFFSET..SLOT_PRESENCE_FLAGS_OFFSET + 2]
        .copy_from_slice(&payload.presence_flags.to_le_bytes());
    bytes[SLOT_RESERVED_OFFSET..SLOT_RESERVED_OFFSET + 2]
        .copy_from_slice(&payload.reserved.to_le_bytes());
    bytes[SLOT_TIMING_UNCERTAINTY_NS_OFFSET..SLOT_TIMING_UNCERTAINTY_NS_OFFSET + 4]
        .copy_from_slice(&payload.timing_uncertainty_ns.to_le_bytes());
    bytes[SLOT_DISCONTINUITY_FLAGS_OFFSET..SLOT_DISCONTINUITY_FLAGS_OFFSET + 4]
        .copy_from_slice(&payload.discontinuity_flags.to_le_bytes());
    bytes
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Barrier};

    use super::*;
    use crate::SampleFormat;
    use crate::ring::tests::{ALLOCATIONS, TRACK};

    fn config(capacity: u32) -> PcmAbiConfig {
        PcmAbiConfig {
            node_boot_id: *b"node-boot-id-001",
            mapping_generation: 0x0102_0304_0506_0708,
            capture_epoch: 0x1112_1314_1516_1718,
            sample_format: SampleFormat::F32,
            channels: 2,
            frames_per_slot: 4,
            capacity,
            page_size: 4096,
        }
    }

    fn metadata(sequence: u64, frame: u64, frames: u16) -> PcmBlockMetadata {
        PcmBlockMetadata {
            sequence,
            capture_epoch: config(1).capture_epoch,
            first_frame_index: frame,
            frame_count: frames,
            channel_count: 2,
            monotonic_capture_ns: Some(0x2122_2324_2526_2728),
            timing_uncertainty_ns: Some(0x3132_3334),
            discontinuity_flags: 0x4142_4344,
            cumulative_source_xruns: 0x5152_5354_5556_5758,
        }
    }

    fn split(capacity: u32) -> (OrdinaryProducer, OrdinaryConsumer) {
        OrdinaryPcmRing::from_descriptor(descriptor(capacity))
            .unwrap()
            .split(
                config(capacity).mapping_generation,
                config(capacity).capture_epoch,
            )
            .unwrap()
    }

    fn descriptor(capacity: u32) -> PcmDescriptor {
        let mut bytes = vec![0; config(capacity).page_size as usize];
        crate::initialize_descriptor(&mut bytes, config(capacity)).unwrap()
    }

    #[test]
    fn logical_state_and_slot_bytes_are_exact_little_endian() {
        let ring = OrdinaryPcmRing::from_descriptor(descriptor(1)).unwrap();
        assert_eq!(&ring.inner.producer_identity[..8], b"A2PPROD\0");
        assert_eq!(
            &ring.inner.producer_identity[STATE_GENERATION_OFFSET..STATE_GENERATION_OFFSET + 8],
            &config(1).mapping_generation.to_le_bytes()
        );
        assert_eq!(STATE_CURSOR_OFFSET % 8, 0);
        assert_eq!(STATE_CLAIM_OFFSET % 8, 0);
        assert_eq!(ring.layout().slot_stride % 8, 0);

        let (mut producer, _consumer) = ring
            .split(config(1).mapping_generation, config(1).capture_epoch)
            .unwrap();
        producer.publish(metadata(9, 100, 4), &[1.0; 8]).unwrap();
        let slot = &producer.inner.slots[0];
        let payload = unsafe { &*slot.payload.get() };
        let bytes = encode_slot_header(0, payload);
        assert_eq!(&bytes[0..8], &0_u64.to_le_bytes());
        assert_eq!(&bytes[8..16], &9_u64.to_le_bytes());
        assert_eq!(&bytes[16..24], &config(1).capture_epoch.to_le_bytes());
        assert_eq!(&bytes[24..32], &100_u64.to_le_bytes());
        assert_eq!(&bytes[48..50], &4_u16.to_le_bytes());
        assert_eq!(&bytes[50..52], &2_u16.to_le_bytes());
        assert_eq!(&bytes[52..54], &3_u16.to_le_bytes());
        assert_eq!(&bytes[54..56], &[0, 0]);
    }

    #[test]
    fn legacy_descriptor_cannot_construct_ordinary_endpoints() {
        let mut bytes = vec![0; config(1).page_size as usize];
        let legacy = crate::layout::initialize_legacy_descriptor(&mut bytes, config(1)).unwrap();
        assert!(matches!(
            OrdinaryPcmRing::from_descriptor(legacy),
            Err(AbiError::IncompatibleVersion)
        ));
    }

    #[test]
    fn publish_read_gap_and_short_tail_are_exact() {
        let (mut producer, mut consumer) = split(2);
        producer.publish(metadata(10, 0, 4), &[1.0; 8]).unwrap();
        producer.publish(metadata(11, 4, 4), &[2.0; 8]).unwrap();
        producer.publish(metadata(12, 8, 2), &[3.0; 4]).unwrap();
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Loss(OrdinaryLoss {
                kind: OrdinaryLossKind::Overwritten {
                    publication_sequence: 0
                },
                ..
            }))
        ));
        let mut output = [-1.0; 8];
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
                publication_sequence: 1,
                ..
            }))
        ));
        assert_eq!(output, [2.0; 8]);
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
                publication_sequence: 2,
                ..
            }))
        ));
        assert_eq!(&output[..4], &[3.0; 4]);
        let slot = &producer.inner.slots[0];
        let payload = unsafe { &*slot.payload.get() };
        assert_eq!(&payload.samples[4..], &[0.0; 4]);
    }

    #[test]
    fn exact_claim_drops_once_and_reports_after_older_retained_audio() {
        let (mut producer, mut consumer) = split(1);
        producer.publish(metadata(10, 0, 4), &[1.0; 8]).unwrap();
        producer.inner.read_claim.store(0, Ordering::SeqCst);
        assert!(matches!(
            producer.publish(metadata(11, 4, 4), &[2.0; 8]),
            Ok(OrdinaryPublishOutcome::DroppedIncoming {
                dropped_newest_blocks: 1,
                ..
            })
        ));
        assert_eq!(producer.next_sequence, 1);
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
                publication_sequence: 0,
                ..
            }))
        ));
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Loss(OrdinaryLoss {
                kind: OrdinaryLossKind::DroppedIncoming {
                    after_publication_sequence: 1
                },
                ..
            }))
        ));
        assert!(matches!(
            producer.publish(metadata(12, 8, 4), &[3.0; 8]),
            Ok(OrdinaryPublishOutcome::Published {
                publication_sequence: 1,
                overwritten: None,
                ..
            })
        ));
    }

    #[test]
    fn paused_capacity_one_reader_keeps_ordinary_pcm_immutable() {
        let (mut producer, _consumer) = split(1);
        producer.publish(metadata(10, 0, 4), &[1.0; 8]).unwrap();
        let claimed = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let inner = Arc::clone(&producer.inner);
        let reader_claimed = Arc::clone(&claimed);
        let reader_release = Arc::clone(&release);
        let reader = std::thread::spawn(move || {
            inner.read_claim.store(0, Ordering::SeqCst);
            let claim = ReadClaim(&inner.read_claim);
            reader_claimed.wait();
            reader_release.wait();
            let payload = unsafe { &*inner.slots[0].payload.get() };
            assert!(payload.samples.iter().all(|sample| *sample == 1.0));
            drop(claim);
        });

        claimed.wait();
        assert!(matches!(
            producer.publish(metadata(11, 4, 4), &[2.0; 8]),
            Ok(OrdinaryPublishOutcome::DroppedIncoming { .. })
        ));
        release.wait();
        reader.join().unwrap();
        let payload = unsafe { &*producer.inner.slots[0].payload.get() };
        assert!(payload.samples.iter().all(|sample| *sample == 1.0));
    }

    #[test]
    fn delayed_drop_never_hides_an_older_overwrite_loss() {
        let (mut producer, mut consumer) = split(4);
        for sequence in 0..4 {
            producer
                .publish(
                    metadata(10 + sequence, sequence * 4, 4),
                    &[sequence as f32; 8],
                )
                .unwrap();
        }
        producer.inner.read_claim.store(0, Ordering::SeqCst);
        assert!(matches!(
            producer.publish(metadata(14, 16, 4), &[14.0; 8]),
            Ok(OrdinaryPublishOutcome::DroppedIncoming { .. })
        ));
        producer
            .inner
            .read_claim
            .store(NO_CLAIM_SEQUENCE, Ordering::SeqCst);
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
                publication_sequence: 0,
                ..
            }))
        ));
        producer.publish(metadata(15, 20, 4), &[15.0; 8]).unwrap();
        producer.publish(metadata(16, 24, 4), &[16.0; 8]).unwrap();

        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Loss(OrdinaryLoss {
                kind: OrdinaryLossKind::Overwritten {
                    publication_sequence: 1
                },
                ..
            }))
        ));
        for expected in [2, 3] {
            assert!(matches!(
                consumer.read_into(&mut [0.0; 8]),
                Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
                    publication_sequence,
                    ..
                })) if publication_sequence == expected
            ));
        }
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Loss(OrdinaryLoss {
                kind: OrdinaryLossKind::DroppedIncoming {
                    after_publication_sequence: 4
                },
                ..
            }))
        ));
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Block(OrdinaryPublishedBlock {
                publication_sequence: 4,
                ..
            }))
        ));
    }

    #[test]
    fn equal_frontier_reports_earlier_drop_before_later_overwrite() {
        let (mut producer, mut consumer) = split(1);
        producer.publish(metadata(10, 0, 4), &[10.0; 8]).unwrap();
        producer.inner.read_claim.store(0, Ordering::SeqCst);
        producer.publish(metadata(11, 4, 4), &[11.0; 8]).unwrap();
        producer
            .inner
            .read_claim
            .store(NO_CLAIM_SEQUENCE, Ordering::SeqCst);
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Block(_))
        ));
        producer.publish(metadata(12, 8, 4), &[12.0; 8]).unwrap();
        producer.publish(metadata(13, 12, 4), &[13.0; 8]).unwrap();

        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Loss(OrdinaryLoss {
                kind: OrdinaryLossKind::DroppedIncoming {
                    after_publication_sequence: 1
                },
                source: ConcurrentBlockRange {
                    source_sequence: 11,
                    ..
                }
            }))
        ));
        assert!(matches!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Loss(OrdinaryLoss {
                kind: OrdinaryLossKind::Overwritten {
                    publication_sequence: 1
                },
                source: ConcurrentBlockRange {
                    source_sequence: 12,
                    ..
                }
            }))
        ));
    }

    #[test]
    fn loss_ledger_exhaustion_fences_without_overwriting_surviving_audio() {
        let (mut producer, _consumer) = split(1);
        producer.publish(metadata(10, 0, 4), &[1.0; 8]).unwrap();
        producer.inner.read_claim.store(0, Ordering::SeqCst);
        assert!(matches!(
            producer.publish(metadata(11, 4, 4), &[2.0; 8]),
            Ok(OrdinaryPublishOutcome::DroppedIncoming { .. })
        ));
        assert_eq!(
            producer.publish(metadata(12, 8, 4), &[3.0; 8]),
            Ok(OrdinaryPublishOutcome::Fenced {
                rejected: block_range(metadata(12, 8, 4)),
                reason: OrdinaryFenceReason::LossLedgerExhausted,
            })
        );
        assert_eq!(
            producer.publish(metadata(13, 12, 4), &[4.0; 8]),
            Err(OrdinaryPublishError::Fenced)
        );
        assert_eq!(
            producer.inner.slots[0]
                .committed_sequence
                .load(Ordering::Acquire),
            0
        );
        let payload = unsafe { &*producer.inner.slots[0].payload.get() };
        assert_eq!(&*payload.samples, &[1.0; 8]);
    }

    #[test]
    fn overwrite_journal_exhaustion_fences_before_an_unattributed_overwrite() {
        let (mut producer, _consumer) = split(2);
        for sequence in 0..4 {
            assert!(matches!(
                producer.publish(
                    metadata(10 + sequence, sequence * 4, 4),
                    &[sequence as f32; 8],
                ),
                Ok(OrdinaryPublishOutcome::Published { .. })
            ));
        }
        let committed = producer.inner.slots[0]
            .committed_sequence
            .load(Ordering::Acquire);
        assert_eq!(
            producer.publish(metadata(14, 16, 4), &[14.0; 8]),
            Ok(OrdinaryPublishOutcome::Fenced {
                rejected: block_range(metadata(14, 16, 4)),
                reason: OrdinaryFenceReason::LossLedgerExhausted,
            })
        );
        assert_eq!(
            producer.inner.slots[0]
                .committed_sequence
                .load(Ordering::Acquire),
            committed
        );
    }

    #[test]
    fn producer_claim_forces_retry_and_corrupt_slot_requires_remap() {
        let (mut producer, mut consumer) = split(1);
        producer.publish(metadata(10, 0, 4), &[1.0; 8]).unwrap();
        producer.inner.overwrite_claim.store(0, Ordering::SeqCst);
        assert_eq!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::Retry)
        );
        producer
            .inner
            .overwrite_claim
            .store(NO_CLAIM_SEQUENCE, Ordering::SeqCst);
        let slot = &producer.inner.slots[0];
        unsafe { &mut *slot.payload.get() }.presence_flags = u16::MAX;
        assert_eq!(
            consumer.read_into(&mut [0.0; 8]),
            Ok(OrdinaryReadOutcome::RemapRequired(
                OrdinaryPeerFault::CorruptSlot
            ))
        );
        assert_eq!(
            producer.inner.read_claim.load(Ordering::SeqCst),
            NO_CLAIM_SEQUENCE
        );
    }

    #[test]
    fn impossible_producer_commit_fences_before_ordinary_access() {
        let (mut producer, _consumer) = split(1);
        producer.inner.slots[0]
            .committed_sequence
            .store(7, Ordering::Release);
        assert_eq!(
            producer.publish(metadata(10, 0, 4), &[1.0; 8]),
            Ok(OrdinaryPublishOutcome::Fenced {
                rejected: block_range(metadata(10, 0, 4)),
                reason: OrdinaryFenceReason::CorruptProducerState,
            })
        );
        assert_eq!(
            producer.publish(metadata(11, 4, 4), &[2.0; 8]),
            Err(OrdinaryPublishError::Fenced)
        );
    }

    #[test]
    fn hostile_consumer_identity_is_bounded_and_does_not_stop_publication() {
        let (mut producer, _consumer) = split(1);
        producer.inner.consumer_identity[0].store(0, Ordering::Release);
        assert!(matches!(
            producer.publish(metadata(10, 0, 4), &[1.0; 8]),
            Ok(OrdinaryPublishOutcome::Published {
                peer_fault: Some(OrdinaryPeerFault::InvalidConsumerIdentity),
                ..
            })
        ));
        producer
            .inner
            .consumed_next
            .store(u64::MAX, Ordering::Release);
        assert!(matches!(
            producer.publish(metadata(11, 4, 4), &[2.0; 8]),
            Ok(OrdinaryPublishOutcome::Published {
                peer_fault: Some(_),
                ..
            })
        ));
    }

    #[test]
    fn exhaustion_and_input_errors_fail_before_slot_mutation() {
        let (mut producer, _consumer) = split(1);
        producer.next_sequence = u64::MAX - 1;
        producer.loss_floor = u64::MAX - 1;
        producer.inner.slots[0]
            .committed_sequence
            .store(u64::MAX - 2, Ordering::Release);
        assert!(matches!(
            producer.publish(metadata(10, 0, 4), &[1.0; 8]),
            Ok(OrdinaryPublishOutcome::Published {
                publication_sequence,
                ..
            }) if publication_sequence == u64::MAX - 1
        ));
        let committed = producer.inner.slots[0]
            .committed_sequence
            .load(Ordering::Acquire);
        assert_eq!(
            producer.publish(metadata(11, 4, 4), &[2.0; 8]),
            Err(OrdinaryPublishError::SequenceExhausted)
        );
        assert_eq!(
            producer.inner.slots[0]
                .committed_sequence
                .load(Ordering::Acquire),
            committed
        );
        assert_eq!(
            producer.inner.published_next.load(Ordering::Acquire),
            u64::MAX
        );
    }

    #[test]
    fn concurrent_overwrite_never_accepts_torn_ordinary_pcm() {
        const BLOCKS: u64 = 10_000;
        let (mut producer, mut consumer) = split(32);
        let finished = Arc::new(AtomicBool::new(false));
        let producer_finished = Arc::clone(&finished);
        let producer_thread = std::thread::spawn(move || {
            let mut accepted = 0_u64;
            for sequence in 0..BLOCKS {
                let samples = [sequence as f32; 8];
                match producer
                    .publish(metadata(sequence, sequence * 4, 4), &samples)
                    .unwrap()
                {
                    OrdinaryPublishOutcome::Published { .. }
                    | OrdinaryPublishOutcome::DroppedIncoming { .. } => accepted += 1,
                    OrdinaryPublishOutcome::Fenced { .. } => break,
                }
                std::thread::yield_now();
            }
            producer_finished.store(true, Ordering::Release);
            accepted
        });

        let mut accounted = 0_u64;
        let mut output = [0.0; 8];
        loop {
            let done = finished.load(Ordering::Acquire);
            match consumer.read_into(&mut output).unwrap() {
                OrdinaryReadOutcome::Block(block) => {
                    assert!(output.iter().all(|sample| {
                        sample.to_bits() == (block.source.sequence as f32).to_bits()
                    }));
                    accounted += 1;
                }
                OrdinaryReadOutcome::Loss(_) => accounted += 1,
                OrdinaryReadOutcome::Retry => std::thread::yield_now(),
                OrdinaryReadOutcome::Empty if done => break,
                OrdinaryReadOutcome::Empty => std::thread::yield_now(),
                other => panic!("unexpected concurrent outcome: {other:?}"),
            }
        }
        let accepted = producer_thread.join().unwrap();
        assert!(accepted > 0);
        assert_eq!(accounted, accepted);
    }

    #[test]
    fn steady_state_success_and_errors_allocate_nothing() {
        let (mut producer, mut consumer) = split(2);
        let samples = [1.0; 8];
        let mut output = [0.0; 8];
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));

        assert!(matches!(
            producer.publish(metadata(0, 0, 4), &samples),
            Ok(OrdinaryPublishOutcome::Published { .. })
        ));
        assert!(matches!(
            consumer.read_into(&mut output),
            Ok(OrdinaryReadOutcome::Block(_))
        ));
        assert!(matches!(
            producer.publish(metadata(1, 4, 4), &samples),
            Ok(OrdinaryPublishOutcome::Published { .. })
        ));
        assert_eq!(consumer.read_into(&mut []), Err(ReadError::OutputTooSmall));
        assert_eq!(
            producer.inner.read_claim.load(Ordering::SeqCst),
            NO_CLAIM_SEQUENCE
        );

        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }

    #[test]
    fn claim_guards_clear_during_unwind() {
        let (producer, _consumer) = split(2);
        let read_unwind = catch_unwind(AssertUnwindSafe(|| {
            producer.inner.read_claim.store(1, Ordering::SeqCst);
            let _claim = ReadClaim(&producer.inner.read_claim);
            panic!("exercise read-claim unwind");
        }));
        assert!(read_unwind.is_err());
        assert_eq!(
            producer.inner.read_claim.load(Ordering::SeqCst),
            NO_CLAIM_SEQUENCE
        );
        let overwrite_unwind = catch_unwind(AssertUnwindSafe(|| {
            producer.inner.overwrite_claim.store(1, Ordering::SeqCst);
            let _claim = OverwriteClaim(&producer.inner.overwrite_claim);
            panic!("exercise overwrite-claim unwind");
        }));
        assert!(overwrite_unwind.is_err());
        assert_eq!(
            producer.inner.overwrite_claim.load(Ordering::SeqCst),
            NO_CLAIM_SEQUENCE
        );
    }
}
