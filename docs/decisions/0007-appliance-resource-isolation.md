# ADR 0007: Appliance resource isolation and overload shedding

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
- **Date:** 2026-09-18
- **Owners:** Project team
- **Supersedes:** None

## Context

The standard deployment may co-locate capture, media, replay, backend and web
services. Collaboration adds database writes, fan-out and hostile media decode.
Process separation alone does not reserve CPU, memory, handles, sockets or disk
bandwidth for audio.

## Decision

The appliance enforces this overload priority:

1. audio capture and device-clock continuity;
2. canonical control-ledger persistence and existing bounded node control;
3. existing live media;
4. replay writing;
5. essential state import and reconciliation;
6. admitted replay readers;
7. text collaboration and paging;
8. images, voice processing, transcription, export and indexing.

The audio engine uses the validated OS real-time facility where appropriate
(MMCSS/Pro Audio on Windows; Core Audio workgroup mechanisms on macOS) and still
performs only bounded, preallocated callback work. Each process has explicit
memory, thread, handle/socket, queue and client limits. Replay, database, asset,
temporary-upload, log and audit storage have reservations and low-space
thresholds.

The canonical ledger reservation includes bytes, write IOPS and p99 fsync
latency; it is not shared with replay. Each supported OS profile also declares
CPU scheduling, resident/commit memory, page-cache assumption, handles, sockets,
network queues and platform-specific DPC/ISR or memory-pressure evidence. See
[client and appliance profiles](../quality/client-and-appliance-profiles.md).

Attachment decode/transcode runs in a no-network, low-priority sandbox with
byte/pixel/duration, memory, CPU-time, temporary-file and concurrency limits.
Transcription is off during active performances by default until its isolated
budget is validated. Admission fails before exhaustion; lower priorities shed
first and expose degradation.

Replay disk read, prefetch and historical mixing belong to the replay worker.
The media worker selects a bounded prebuffered replay stream or live mix for the
existing WebRTC track. The audio engine never seeks, opens replay files,
decompresses historical media or waits for replay readers.

Writer and reader queues/budgets are independent. Phase 1A admits at most two
readers, one outstanding seek per client, and uses newest-seek-wins cancellation;
admission closes before writer/ledger latency loses its measured margin.

Co-location is a supported profile only if the combined adversarial load passes.
If OS controls cannot preserve the envelope, the backend/asset workers move to
a separate host or rich collaboration is disabled during an active performance.

## Consequences

### Positive

- Collaboration features cannot consume an undefined share of audio resources.
- Replay read isolation is explicit.
- Overload has deterministic, operator-visible shedding.

### Negative

- Packaging and tests differ between Windows and macOS.
- Some features can reject work while audio remains healthy.
- Split-host deployment may be required for the largest validated profile.

## Alternatives considered

- **Rely on process priority alone:** rejected because disk, memory and kernel
  resource exhaustion still cross process boundaries.
- **Always require two hosts:** rejected until measurement proves co-location
  insufficient for the reference profile.

## Validation

- simultaneous full capture/media/replay plus message fan-out, page storms,
  uploads, hostile decode, asset-store pressure, export and reconciliation;
- callback deadline and WebRTC continuity during every lower-priority failure;
- per-process quota exhaustion and admission behavior;
- slow/full disk in every reservation; and
- comparison of co-located and split-host reference profiles.
