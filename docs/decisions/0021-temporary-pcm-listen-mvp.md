# ADR 0021: Temporary PCM listen path for the local MVP

- **Status:** Accepted for local development only
- **Date:** 2026-09-21
- **Owners:** Project team
- **Supersedes:** None

## Context

The application needs one working vertical slice before the WebRTC/Opus path is
complete: open an explicitly selected audio device, expose its real input
channels, select one in Live and hear it. The existing synthetic host, media
arithmetic and UI do not yet form that user-visible path.

## Decision

Add a temporary local-development path with three boundaries:

1. `pulse-device-capture` opens one exact, named 48 kHz Core Audio or WASAPI input.
   Its real-time callback writes only to a preallocated bounded lock-free queue.
2. A separate listen gateway reads capture bytes outside the callback, selects
   one mono input per client and sends bounded Float32 PCM frames over a direct
   WebSocket from the node to Live.
3. Live starts muted, lists the device's actual inputs, and makes output state
   and transport failures explicit.

The gateway is not the management backend and the backend never enters the
sample path. Missing configuration fails closed; no default device is opened.
The raw PCM WebSocket has no production authorization, encryption, jitter,
clock-recovery or loss-concealment claim. It is a local MVP transport and must
not be exposed on an untrusted network.

ADR 0002 remains the production decision. WebRTC/Opus replaces this transport;
the capture boundary and user workflow may remain.

## Consequences

- A developer can prove the complete select-and-listen workflow with a physical
  input before signaling, Opus and authorization are finished.
- TCP head-of-line blocking and browser scheduling make latency non-promotional.
- The gateway must bound client buffering and drop rather than grow memory.
- No Phase 0B media, security, performance or browser-support gate can close
  from this path.
- The ad-hoc-signed macOS MVP app may bundle this path for trusted-LAN trials.
  Packaging changes neither its authority nor its security status: selecting a
  LAN bind exposes an unauthenticated raw PCM endpoint and is never a production
  or internet-facing configuration.

## Removal gate

Remove the PCM WebSocket and its client adapter after the WebRTC/Opus path can
open the same explicit device, enumerate the same channels and complete the
muted select-and-listen workflow in supported clients.
