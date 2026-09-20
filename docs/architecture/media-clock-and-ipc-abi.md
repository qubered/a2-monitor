# Media clock, discontinuity, and native IPC ABI

**Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).

## Authoritative time

Within a capture epoch, the selected device's sample clock and monotonically
increasing frame index are authoritative. Wall time is metadata; it never drives
sample production or correction in the callback.

Every PCM slot crossing from the audio engine contains:

- node boot ID and capture epoch ID;
- first absolute frame index;
- frame count, channel count and sample format;
- monotonic callback/capture timestamp where the host exposes it;
- discontinuity flags and cumulative source-xrun count; and
- a sequence number independent of the sample-frame index.

The host adapter records the meaning and uncertainty of its timestamp. Phase 0A
calibrates it against physical loopback rather than assuming ASIO, WASAPI and
Core Audio report an equivalent instant.

## RTP time mapping

For a 48 kHz live capture epoch:

```text
rtp_timestamp = rtp_epoch_base + (first_frame_index - capture_epoch_frame_base)
                modulo 2^32
```

`rtp_epoch_base` and SSRC are cryptographically random for each media-session
epoch. The mapping is never based on ring arrival time or async scheduler wakeup.
Opus packet duration must equal the represented source-frame count.

The worker maintains a monotonic-to-wall anchor only for RTCP sender reports and
the negotiated absolute-capture-time extension. Clock adjustment updates that
anchor without changing the frame-index-to-RTP slope. Physical measurement is
the release result; WebRTC statistics are attribution evidence.

`crates/media` implements the dependency-free arithmetic contract for the fixed
48 kHz profile. It maps source-frame spans to RTP start/end values modulo
`2^32`, validates adjacent gaps against a caller-supplied bound, rejects
adjacent packet-start distances at or above the RTP serial half-range, and
rejects frame-index overflow rather than wrapping the source timeline. RTCP
projections bind the wall anchor to the same source frame,
node boot, source epoch, media-session epoch and worker generation as the RTP
point. NTP era is retained out of band, and projected uncertainty combines
anchor measurement uncertainty with a declared rate-error bound. Source/worker
transitions must rotate both media-session epoch and SSRC. The caller supplies
cryptographically random bases/SSRCs and measured anchors; this crate performs
no clock, random, network, WebRTC or codec work.

## Gaps and epochs

- A missing source block advances RTP media time by the missing frame count. The
  worker does not relabel later audio to hide the gap.
- A bounded small gap within the same capture epoch preserves SSRC and emits the
  discontinuity/late-loss telemetry required to explain browser concealment.
- Device close/reopen, rate change, clock reset or audio-engine restart creates a
  new capture epoch. The current reference creates a new media-session epoch and
  SSRC on the existing negotiated audio m-line if browser evidence accepts it;
  otherwise it performs a fresh offer/answer. It never pretends sample-clock
  continuity across capture epochs.
- Replay uses its recorded sample timeline and a distinct SSRC/media-session
  epoch. Live/replay switching cannot reuse arrival time as media time.
- Media-worker restart does not restore serialized DTLS/ICE/RTP state. It creates
  fresh peer sessions and the client enters the interruption/safe-reconnect path.

Phase 0B covers 32-bit RTP wrap, frame-index exhaustion in test models, scheduler
stalls, ring gaps, epoch change, media-worker restart, replay/live transition,
RTCP mapping, browser inserted/removed samples and latency slope over the full
soak.

## Shared-memory ABI

The PCM ABI is a byte-level protocol, not a Rust memory layout. Version zero is:

- little-endian, matching supported x86-64 and Apple-silicon targets;
- fixed-width integer and IEEE-754 `f32` sample fields;
- explicit offsets, alignment and total lengths checked by compile-time and
  runtime assertions;
- 64-bit monotonic counters aligned to their required atomic boundary;
- no enums with compiler-defined representation, pointers, references, strings,
  booleans, variable records or process-local handles in the mapping; and
- incompatible major versions rejected before any PCM view is exposed.

The logical regions are page-separated:

1. immutable descriptor: written before publication, then read-only in every
   participant;
2. producer state/index: writable only by the producer, read-only by consumer;
3. consumer state/index: writable only by the consumer, read-only by producer;
4. PCM slots: writable by producer, read-only by consumer;
5. producer-owned overwrite and dropped-input loss journals, read-only by consumer; and
6. diagnostic counters split by their sole writer.

ABI minor 2 defines the candidate ordinary-PCM ownership bytes. All multi-byte
fields are little-endian, and atomic `u64` fields are eight-byte aligned:

| Region | Fixed fields |
| --- | --- |
| Producer state | magic/version, generation, epoch, `published_next` at byte 32, overwrite claim at byte 40, overwrite/dropped journal published cursors at bytes 48/56 |
| Consumer state | magic/version, generation, epoch, `consumed_next` at byte 32, read claim at byte 40, overwrite/dropped journal consumed cursors at bytes 48/56 |
| 64-byte slot header | committed publication, source sequence, epoch, first frame, optional monotonic time, cumulative xruns, frame/channel counts, presence flags, uncertainty and discontinuity flags |
| 64-byte loss entry | committed ledger sequence at byte 0; kind at byte 8 (`1` overwritten, `2` dropped incoming); ordering publication at byte 16; epoch, source sequence and frame range at bytes 24–55 |

`u64::MAX` is the unclaimed/uncommitted sentinel and is never a valid
publication identity. The descriptor stores the loss-region offset at byte 120;
the region contains `capacity` overwrite entries followed by `capacity`
dropped-input entries and has page-rounded length `capacity * 2 * 64`. Minor 1
remains decodable for the legacy serialized model, but the ordinary constructor
rejects it. Non-ledger
producer/consumer diagnostic-page bytes remain unfrozen.

Windows uses duplicated file-mapping handles with the minimum view access.
macOS uses App Group-scoped POSIX shared memory/mappings with the corresponding
protections when sandboxed helpers are selected. The supervisor creates and
sizes every region before passing a capability.

## Ring rules

- One producer and one consumer own each ring.
- Producer publishes a completely written slot with release ordering; consumer
  observes it with acquire ordering.
- Before any ordinary slot read or overwrite, consumer and producer publish the
  full target/victim publication sequence through sequentially consistent claim
  fields, then inspect the opposing claim. Slot indices are never claims. If the
  consumer claims the exact victim, the producer completes one bounded call by
  dropping the incoming source block without advancing publication sequence.
- Before destructive overwrite, the producer reserves a bounded exact-loss
  record. Separate overwrite and dropped-input journals avoid head-of-line
  blocking; the consumer merges their eligible heads by publication order. An
  overwrite record is eligible at its missing publication; a dropped-incoming
  record becomes eligible only after all older retained publications. The
  consumer drains eligible committed loss before returning later audio. If the
  applicable journal is full, the producer fences the mapping and
  rejects the incoming block; it never overwrites without attribution.
- Consumer-writable shared state is limited to its consumed sequence, read
  claim and the two journal-consumed cursors. The producer treats every value
  as untrusted, bounds-checks it before subtraction/indexing and never waits on
  it.
- Overflow policy is fixed per ring: capture remains live, the lagging consumer
  normally loses old data, and exact publication/source/frame loss is reported
  before surviving audio. An actively claimed victim causes a terminal
  drop-newest result; journal saturation instead fences the mapping and rejects
  the incoming source block.
- Impossible indices, epoch mismatch or ABI damage require a remap or fence;
  they do not panic or block the callback.
- Teardown uses supervisor-owned process handles/connection state, not a shared
  flag that a compromised peer can forge.

The model/concurrency suite exercises the no-wrap exhaustion boundary,
deterministic paused-reader conflict, patterned concurrent overwrite,
torn/corrupt ordinary bytes, loss-ledger saturation and current/previous
version gates. These are in-process model tests, not process-death, OS-mapping,
hostile-peer confinement or callback-deadline evidence.

## Control framing

The local control transport remains:

```text
u32 big-endian payload length | bounded payload
```

The frame and semantic command interfaces do not expose Protobuf-generated
types. Phase 0T implements the same golden messages with bounded canonical JSON
and Protobuf and compares:

- unknown-field/version behavior;
- allocation and maximum-frame enforcement;
- Rust plus potential C++ host-shim generation;
- diagnostic readability;
- package/code-generation burden; and
- current/previous worker compatibility.

Protobuf is promoted only if that comparison passes. PCM never enters either
codec. Signed public commands remain RFC 8785 canonical JSON regardless of the
internal codec.

The Phase 0T scaffold implements this outer frame and an initial comparison in
`crates/ipc`. The comparison covers the unchanged version 1 health-probe vector
and version 2 worker-ready and worker-heartbeat vectors. Version 2 makes the
supervision fence lossless: a 128-bit boot ID, worker ID, typed role and
generation accompany typed readiness evidence or a heartbeat sequence. JSON
uses a canonical 32-character lowercase-hex boot ID and Protobuf uses 16
big-endian bytes. Version 1 worker messages fail closed; their old Protobuf
nested fields remain occupied and rejected rather than being reinterpreted.
Tests cover exact golden bytes, fragmented input, malformed and oversized input,
invalid identities/evidence,
and each candidate's unknown-field behavior. This is implementation evidence
for the codec-neutral comparison boundary only: no codec has been selected, no
local transport has been integrated, and no runtime-supervision claim follows.

`services/audio-node` composes that framing and semantic adapter in a bounded
worker-control session model. One codec and the full trusted connection-bound
worker identity are immutable constructor inputs; neither is negotiated or
derived from the untrusted stream. The frame and codec layers share a fixed
512-byte worker-message ceiling, and each receive call completes at most one
frame so the caller can apply event-loop backpressure before reading the next.
Every framing, codec, protocol, identity or routing error is terminal. A
supervisor result other than `Accepted` is also terminal while preserving any
deadline action the supervisor already performed. Buffered suffixes are
discarded rather than scanned for a new frame. Clean EOF is valid only at a
frame boundary and never counts as confirmed worker-process death.

This session remains a synchronous in-process composition boundary. It owns no
socket, pipe, XPC connection, peer credential, PID check, read timer or process
handle. The external loop must enforce idle/partial-frame deadlines and continue
supervisor ticks. Worker ready and heartbeat are one-way lifecycle events here;
their `request_id` is unvalidated opaque correlation metadata surfaced with the
in-process dispatch outcome only. Zero, repeated and maximum values are
preserved; they do not control acceptance. There is no acknowledgement,
response delivery, deduplication or replay-cache claim, and no production codec
selection follows from exercising both candidates.

`crates/pcm-abi` implements the dependency-free descriptor/region layout, the
legacy serialized model, an all-atomic concurrent reference and the separate
minor-2 ordinary-payload ownership candidate. The candidate fences attach by
mapping generation/epoch, uses nonwrapping publication identities, validates
before mutation, arbitrates full-sequence claims before ordinary access, clears
short-block tails, preserves distinct source/publication sequences, and commits
exact bounded loss records before replacement audio becomes visible. Its
producer/read/drop/retry paths are preallocated and covered by allocation and
patterned concurrency tests.

This remains owned in-process model evidence. It does not create an OS mapping,
construct atomic objects in mapped bytes, authenticate handles, enforce least-
write views/ACLs, recover claims after process death, or prove cross-process
atomic layout, target lock-freedom, callback deadlines, cache behavior or
hardware performance. A crashed peer's mapping is retired only after separately
confirmed process death; no timer or connection close may clear its claim.
