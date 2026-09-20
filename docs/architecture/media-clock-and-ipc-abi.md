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
4. PCM slots: writable by producer, read-only by consumer; and
5. diagnostic counters split by their sole writer.

Windows uses duplicated file-mapping handles with the minimum view access.
macOS uses App Group-scoped POSIX shared memory/mappings with the corresponding
protections when sandboxed helpers are selected. The supervisor creates and
sizes every region before passing a capability.

## Ring rules

- One producer and one consumer own each ring.
- Producer publishes a completely written slot with release ordering; consumer
  observes it with acquire ordering.
- Consumer publishes only its consumed sequence. Producer treats that value as
  untrusted, bounds-checks it before subtraction/indexing and never waits on it.
- Overflow policy is fixed per ring: capture remains live, the lagging consumer
  loses old data, and a discontinuity counter/event records the exact range.
- Impossible indices, epoch mismatch or ABI damage quarantine the consumer and
  create a new mapping; they do not panic or block the callback.
- Teardown uses supervisor-owned process handles/connection state, not a shared
  flag that a compromised peer can forge.

The model/concurrency suite exercises counter wrap, reordered observations,
torn/corrupt non-atomic bytes, process death and current/previous compatible
versions. The adversarial suite mutates every consumer-writable byte and proves
capture continuity.

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

`crates/pcm-abi` now implements the first dependency-free version-zero
descriptor/region layout, consumer-control-page bytes and deterministic
state-machine model. It checks little-endian descriptor fields and page-separated
offsets, fences attach by mapping generation and capture epoch, models
overwrite-oldest loss ranges and sequence wrap, and treats every
consumer-control-page byte as hostile. Its producer hot path is covered by an
allocation counter. A separate preallocated in-process SPSC model uses atomic
metadata and sample words, distinct source/publication sequences and a
single-call drop-newest outcome when the exact overwrite victim is claimed.
Unit tests cover safe concurrent snapshots and exact overwrite/drop attribution;
replay composition covers overwrite-gap observation before surviving patterned
audio. This does not freeze producer-state, diagnostic or slot-header bytes and
does not prove the ordinary-PCM ownership protocol required by the byte ABI. OS
mappings, cross-process atomics, least-write views, ACLs, process-death cleanup
and callback deadlines remain required before this ABI can be promoted as an
implemented transport.
