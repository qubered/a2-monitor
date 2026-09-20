# Time, clock, and replay architecture

**Status:** Proposed; Phase 0B must validate the format and resource budget

## Capture timeline

Only one audio device is active, so one device clock is authoritative during a
capture epoch. Every audio block is identified by:

- node ID;
- capture-session ID;
- epoch ID;
- first frame index within the epoch;
- frame count and sample rate;
- monotonic receive time; and
- an epoch anchor to UTC for human correlation.

Frame index is the exact ordering source inside an epoch. UTC is never used to
infer sample continuity. A new epoch begins after node restart, driver restart,
device switch, sample-rate or channel-layout change, clock unlock/relock, an
unrecoverable overrun, or any discontinuity whose exact sample count is
unknown. Epochs cannot be joined invisibly.

## Telemetry correlation

Receiver telemetry frequently has arrival time but no trustworthy device
sample timestamp. Each observation therefore retains:

- vendor timestamp, if present;
- node monotonic receive time;
- mapped capture epoch/frame interval;
- estimated timing uncertainty; and
- whether the mapping is measured, inferred, or unavailable.

Correlation may say that RF and audio evidence occurred within an uncertainty
window. It must not claim sample accuracy for receiver data that does not
provide it. Wall-clock changes create an audit event but do not move media.

## Replay ownership

The audio node owns the rolling audio ring, its media index, and a bounded local
journal of normalized observations required for synchronized replay. The
backend owns durable operator events, notes, acknowledgements, and the global
event view. Separately, the active node owns a non-evicting runtime control
ledger for cue occurrences, assignment overlays, checks and evidence markers
accepted during backend loss. Control events use stable IDs and are uploaded
idempotently after a disconnect; they cannot be dropped with replay telemetry.
The backend never becomes the source of media timing.

## Initial ring design

The safe baseline is a preallocated, segmented, uncompressed ring because it
has predictable CPU cost. At 128 channels, 48 kHz, and 30 minutes, 32-bit PCM
requires approximately 44.2 GB before indexes and safety margin. The reference
appliance must reserve at least 64 GB solely for this ring unless a validated
alternative changes the calculation.

Phase 0B compares 32-bit PCM, packed 24-bit PCM, and lossless compression. A
compressed format is accepted only if worst-case encode/decode work, seek time,
crash recovery, and callback isolation beat the uncompressed baseline.

The ring uses short independently recoverable segments, an append-only index,
checksummed headers, and generation numbers. Exact segment duration and file
layout require a storage ADR after benchmarking. The writer runs outside the
audio callback and receives frames through a bounded queue.

If storage cannot keep up:

1. emit a replay-gap event;
2. discard the oldest unwritten replay work rather than block capture;
3. preserve live listening and metering;
4. stop accepting new replay sessions if necessary; and
5. surface the reduced retained window immediately.

An abrupt power loss may lose the open segment but must not corrupt completed
segments or the active show. Recovery scans only bounded metadata, not the
entire media capacity.

`crates/replay` now implements a deliberately smaller, preallocated in-memory
state-machine model for the timeline boundary. It binds node boot, capture
session, ring generation and stream shape; preserves half-open frame intervals;
reports source gaps separately from retention eviction; prevents capture epochs
from regressing; and gives bounded independent readers explicit epoch, gap and
slow-reader cancellation outcomes. Append and read allocate no memory after
construction, and retained-window reports use the actual stored endpoints.
The model has an explicit 256 MiB ceiling and smaller dimensional limits; these
are safety bounds for executable state-transition tests, not the appliance
capacity profile.

The same crate models the bounded capture-to-replay ingress policy under
serialized calls. Input is validated before queue mutation; full queues discard
the oldest unwritten replay block; exact non-contiguous loss ranges remain
pending until peek/commit acknowledgement; and source gaps remain separately
attached to surviving work. Exact-loss-ledger exhaustion fences replay and
retains the rejected interval rather than stalling capture or inventing a broad
continuous gap. An epoch change requires a fresh ingress instance.

This model performs no filesystem I/O and does not freeze the segment layout.
It does not establish append-only-index durability, checksums, recovery, disk
pressure behavior, encryption, concurrent process safety, callback queue
isolation, storage bandwidth/endurance or the 30-minute capacity target. Those
remain Phase 0B-A implementation and measurement work.

The in-process atomic SPSC model in `crates/pcm-abi` is composition-tested with
replay ingress and the replay ring: transport overwrite is reported before
later patterned audio, and surviving samples are read back unchanged through an
isolated replay reader. That test does not create a replay worker or establish
cross-process mappings, ordinary-PCM ownership safety, persistence, process
failure isolation or callback timing.

## Replay session semantics

- Each operator can be live or replaying independently.
- Entering replay never pauses capture or live alert evaluation.
- The UI shows an unmistakable replay state, offset from live, epoch, and any
  discontinuity crossed.
- Return to live is one action and does not change source binding.
- Changing source while replaying seeks that source to the same timeline when
  media exists; otherwise it shows an explicit gap.
- Replay and live output gains are separate to prevent a recalled historical
  level from surprising the operator.
- Current critical alerts remain visible while historical audio is playing.
- Replay file read, prefetch and historical mixing run in the replay worker;
  bounded PCM reaches the media worker, which switches the existing WebRTC
  track. The audio engine never opens/seeks replay storage or waits for a reader.

## Privacy and endurance

Replay is sensitive production audio. It is local-only by default, continuously
overwritten, excluded from ordinary diagnostics and backups, and exportable
only by an authorized role with an audit event. Full-disk encryption is required
on supported appliances. Storage qualification records sustained bandwidth,
write amplification, drive endurance, temperature, power-loss behavior, and
replacement guidance.

## Validation gates

- full-load simultaneous capture, ring write, eight monitor encoders, receiver
  telemetry, analysis, and concurrent replay seeks;
- disk-full, slow-disk, corruption, cable/device loss, and abrupt-power tests;
- seek-to-audible and source-switch latency on every reference client;
- epoch/discontinuity and telemetry-uncertainty tests; and
- repeatable recovery without blocking or allocating in the audio callback.
