# ADR 0007: Appliance resource isolation and overload shedding

- **Status:** Accepted
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
2. existing live media and bounded node control;
3. replay writing, then admitted replay readers;
4. essential state/event persistence and reconciliation;
5. text collaboration and paging;
6. images, voice processing, transcription, export and indexing.

The audio engine uses the validated OS real-time facility where appropriate
(MMCSS/Pro Audio on Windows; Core Audio workgroup mechanisms on macOS) and still
performs only bounded, preallocated callback work. Each process has explicit
memory, thread, handle/socket, queue and client limits. Replay, database, asset,
temporary-upload, log and audit storage have reservations and low-space
thresholds.

Attachment decode/transcode runs in a no-network, low-priority sandbox with
byte/pixel/duration, memory, CPU-time, temporary-file and concurrency limits.
Transcription is off during active performances by default until its isolated
budget is validated. Admission fails before exhaustion; lower priorities shed
first and expose degradation.

Replay disk read, prefetch and historical mixing belong to the replay worker.
The media worker selects a bounded prebuffered replay stream or live mix for the
existing WebRTC track. The audio engine never seeks, opens replay files,
decompresses historical media or waits for replay readers.

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
