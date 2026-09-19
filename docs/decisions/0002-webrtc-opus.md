# ADR 0002: Use WebRTC and Opus for browser monitoring

- **Status:** Accepted as the transport profile; production support remains
  Phase 0B evidence-gated
- **Date:** 2026-09-18
- **Owners:** Project team
- **Supersedes:** None

## Context

Browser clients need full-band, low-latency audio over wired and wireless local
networks. The transport needs encryption, packet-loss behavior, clock recovery,
and broad browser support. The client normally listens to one source or a small
group while viewing telemetry for every channel.

## Decision

Use one continuous WebRTC/Opus monitor stream per client. Mix and route sources
on the audio node. Use 48 kHz audio, request 10 ms packetization for the
low-latency profile, disable speech enhancement and DTX, and measure actual
browser buffering.

ADR 0017 selects `str0m` plus upstream `libopus` as the Phase 0B native
reference implementation. That implementation may be replaced without
reopening this transport/profile decision if it fails the frozen evidence
manifest and a fallback passes it.

WebRTC signaling and authorization belong to the management backend. Media
flows directly between the selected audio node and the browser when network
topology permits.

## Consequences

### Positive

- Mature encrypted real-time media path with browser decoders.
- Built-in jitter management, packet-loss concealment, and diagnostics.
- One encoder/decoder path per user rather than per monitored input.
- Source switching does not require renegotiation.

### Negative

- Browsers retain final control of parts of the jitter and output pipeline.
- SDP/codec behavior varies and requires a compatibility matrix.
- It is not suitable for phase-critical foldback or IEM use.

## Alternatives considered

- **WebTransport plus WebCodecs/AudioWorklet:** greater control but requires a
  custom clock, jitter buffer, loss concealment, resampling, and compatibility
  layer. Retain as a later experiment.
- **WebSocket PCM:** TCP head-of-line blocking and application scheduling are
  poor fits for live audio.
- **One WebRTC track per input:** unnecessary decoder, battery, and bandwidth
  cost for the listening workflow.
- **Segmented streaming:** buffering is incompatible with the latency goal.

## Validation

Meet the targets and method in `docs/quality/performance-baselines.md` across
the supported compatibility matrix before changing this ADR to Accepted.
