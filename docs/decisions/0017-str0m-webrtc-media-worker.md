# ADR 0017: Use str0m as the Phase 0B native WebRTC engine

- **Status:** Accepted as the Phase 0B reference; production promotion is evidence-gated
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** None

## Context

ADR 0002 selects a continuous WebRTC/Opus stream per client but does not choose
the native implementation. The node already owns capture, mixing, Opus,
sockets, admission and explicit scheduling. The WebRTC layer should not hide
threads, clocks or unbounded queues inside the capture process.

## Decision

Implement the Phase 0B media worker in Rust using `str0m`. It is a separate,
unprivileged process and receives preallocated stereo mix blocks over ADR
0016's PCM ring. It owns UDP sockets, ICE/DTLS/SRTP/SCTP state, RTP packetization,
RTCP/statistics, client admission and the bounded ADR 0009 data channel.

Use upstream `libopus` in the media worker. Target 48 kHz stereo, 10 ms packets,
audio application mode, no DTX and measured bitrate/FEC settings. Encoder state
is created outside the hot loop.

The first standard LAN profile uses explicitly allowed host candidates on the
client interface and no public STUN/TURN service. The backend owns signaling
and short-lived authorization but does not proxy media.

Maintain a minimal `libdatachannel` fallback spike recipe. Promote `str0m` only
if every named Phase 0B browser/network tuple passes. A failure is compared on
the same frozen evidence manifest before the engine is replaced.

## Consequences

### Positive

- `str0m` has no internal threads, I/O or clock calls, allowing deterministic
  scheduling, replayed tests and resource accounting.
- Rust types and build tooling match the rest of the node.
- Missing capture/codec features are already owned by purpose-built workers.
- A crash cannot take the audio callback with it.

### Negative

- The project owns socket polling, timers, interface enumeration and TURN if a
  future profile requires it.
- `str0m` is smaller and less universally deployed than Google libwebrtc.
- Browser interop, congestion behavior and data-channel edge cases require
  substantial evidence.
- One encoder and peer state per admitted client still need explicit capacity
  limits.

## Alternatives considered

- **libdatachannel:** primary fallback; compact browser-compatible C++/C stack,
  but adds FFI and callback-lifetime complexity.
- **GStreamer `webrtcbin`:** strong full media pipeline, but a much larger
  runtime/package surface than this send-only worker needs.
- **Google libwebrtc:** broadest feature surface, but very large and upstream
  positions the native package primarily for browser implementers.
- **webrtc-rs:** conventional async PeerConnection design, but more internal
  task behavior than the selected sans-I/O model.
- **custom RTP/WebTransport/WebSocket:** would recreate security, negotiation,
  browser codec, jitter and loss behavior already provided by WebRTC.

## Validation

- Pass Chromium, Safari/WebKit and Firefox offer/answer, trickle ICE, DTLS/SRTP,
  Opus and reliable ordered data-channel tests.
- Measure wired/Wi-Fi capture-to-ear and gesture-to-ear percentiles on the named
  field kit under loss, jitter, reorder and roaming.
- Verify only allowed interface candidates are advertised and multi-NIC/
  firewall behavior cannot leak production networks.
- Bound memory, CPU, sockets, encoder queues and reconnect rate for every client
  and reject admission before capture/media reservations are threatened.
- Compare `libdatachannel` on the exact failed manifest before superseding this
  ADR.
