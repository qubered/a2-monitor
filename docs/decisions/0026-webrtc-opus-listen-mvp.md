# ADR 0026: WebRTC/Opus listen transport for the local MVP

- **Status:** Accepted for the local MVP; production support remains Phase 0B
  evidence-gated
- **Date:** 2026-09-23
- **Owners:** Project team
- **Supersedes:** [ADR 0021](0021-temporary-pcm-listen-mvp.md)

## Context

ADR 0021 shipped a raw Float32 PCM WebSocket so the select-and-listen workflow
could run before ADR 0002's WebRTC/Opus path existed. That path has known
latency and robustness limits:

- TCP head-of-line blocking turns one lost Wi-Fi frame into a stall for every
  later sample;
- the browser played through a main-thread `ScriptProcessorNode` with a queue of
  up to 250 ms and no loss concealment or clock recovery;
- every sample crossed the Node.js event loop, so HTTP and telemetry work could
  delay audio;
- 1.5 Mbit/s of unencrypted PCM per listener; and
- `pulse-device-capture` wrote binary PCM through Rust's line-buffered stdout, so
  quiet audio without an `0x0A` byte could wait in the buffer.

## Decision

Replace the PCM WebSocket with the ADR 0002 transport, sized for the local MVP.

1. **Process boundary.** A new `pulse-media-worker` starts
   `pulse-device-capture` as its child and reads its PCM pipe. The capture
   callback stays alone in the capture process; the worker owns the network-facing
   media work. The listen gateway only supervises the worker and relays
   signaling. No audio passes through Node.js.
2. **WebRTC engine.** `str0m` 0.23 (ADR 0017), sans-I/O, one ICE-lite `Rtc` per
   listener. All sessions on an address share one UDP socket and are
   demultiplexed by ICE credentials. The node advertises exactly one host
   candidate. It uses no STUN or TURN.
3. **Crypto provider.** `aws-lc-rs`, str0m's default and ADR 0017's named
   fallback. The Apple provider would need a Swift toolchain at build time and a
   macOS 15 deployment target. The pure-Rust provider still pulls in AWS-LC to
   generate DTLS certificates, so it is not lighter.
4. **Codec.** Upstream libopus (built from source by `opusic-sys`), 48 kHz mono,
   restricted-low-delay (CELT-only, 2.5 ms look-ahead), 10 ms packets, 128 kbit/s
   constrained VBR, complexity 10, `Signal::Music`, no DTX and no in-band FEC.
   CELT has no LBRR FEC. The browser's packet-loss concealment covers losses.
   128 kbit/s is above latency.md's 64–96 kbit/s mono range. The extra bandwidth
   buys transparency and is negligible on any LAN.
5. **Timing.** Capture is regrouped into 480-frame blocks. The RTP media time is
   the capture frame index, so dropped blocks remain timestamp gaps.
6. **Source switching.** Each session has its own encoder. A switch crossfades
   linearly over one 10 ms block in the PCM domain before encoding. The browser
   sends `PUT …/channel` and never renegotiates.
7. **Signaling.** WHEP-style HTTP on the gateway origin:
   `POST /audio/v0/listen/sessions` `{channel, offer}` → `201 {sessionId, answer}`;
   `PUT /audio/v0/listen/sessions/{id}/channel` `{channel}` → `204`;
   `DELETE /audio/v0/listen/sessions/{id}` → `204`. There is no trickle ICE.
   Requests must be `application/json`, so a cross-origin page cannot skip a
   CORS preflight that the gateway never approves. The worker control protocol
   is line-delimited JSON on the worker's stdin and stdout. Both ends validate
   exact fields.
8. **Candidate address.** The node advertises the address the browser used to
   reach the gateway. For a loopback page load it advertises the first
   non-internal IPv4 address instead, because Firefox ignores loopback candidates
   and browsers pair from their LAN interfaces. It falls back to loopback only
   when the host has no LAN address.
9. **Wi-Fi behaviour.**
   - Media packets carry DSCP EF (46). Wi-Fi access points map it to the WMM
     voice access category.
   - Live leaves the browser's adaptive jitter buffer at its default minimum and
     does not request a fixed `jitterBufferTarget`.
   - ICE `disconnected` gets a 2 s grace period. `failed` rebuilds the peer
     connection with 250 ms–4 s backoff.
   - A browser `online` event retries at once.
   - The node closes an abandoned session when ICE consent stops. A browser that
     never connects is closed after 15 s.
10. **Capture latency.** `pulse-device-capture` flushes after every write. It
    asks for a 128-frame device buffer where the device advertises a range, and
    falls back to the host default when the host refuses it.

The backend still does not enter the sample path. In the production design
(ADR 0002) signaling moves to the backend with authorization. This MVP keeps
signaling on the node gateway, as ADR 0021 did, and has no listener
authorization.

## Consequences

### Positive

- UDP with concealment: a lost packet costs about 10 ms of concealed audio
  instead of a TCP stall.
- DTLS-SRTP encrypts media, including on the LAN option.
- About 128 kbit/s per listener instead of 1.5 Mbit/s. Media leaves Node.js
  entirely.
- Switching inputs is a server-side crossfade, not a new connection.
- This is the ADR 0002 transport shape, so the production work is authorization,
  backend signaling, and evidence rather than a new transport.

### Negative

- Adds `str0m`, AWS-LC, and libopus (C, built with `cmake`) to the native build.
  The macOS MVP builder now requires `cmake`.
- The browser owns the jitter buffer. Under bursty Wi-Fi it grows. It reached
  62–118 ms in the synthetic impairment below, and the node cannot cap it.
- The UDP media socket is bound to the host's LAN address even in "This Mac
  only" mode. Only a peer holding the ICE credentials and DTLS fingerprint from
  the loopback HTTP answer can use it.
- The macOS application firewall may ask whether `pulse-media-worker` can accept
  incoming connections.
- There are no negotiated `jitterBufferTarget`, RED, or 20 ms resilient Wi-Fi
  profile yet.
- The signaling HTTP endpoints are unauthenticated, like ADR 0021.

## Alternatives considered

- **Keep and tune the PCM WebSocket:** an AudioWorklet ring and Int16 framing
  would cut the client queue. TCP head-of-line blocking on Wi-Fi and the lack of
  concealment would remain. ADR 0002 already rejected this path.
- **WebTransport datagrams with WebCodecs:** more control over the jitter buffer.
  It needs a custom jitter buffer, concealment, and clock recovery, and Safari
  support is incomplete. It stays the later experiment ADR 0002 describes.
- **Shared encoder per input:** lighter with many listeners on one input. A
  switch would splice two unrelated Opus streams without a crossfade. Each
  encoder costs about 0.6 % of one core, so per-session encoders were kept.
- **`rust-crypto` or Apple CryptoKit provider:** see Decision item 3.

## Validation

Measured in this change on a Linux container, 4 vCPU, headless Chromium 141,
using a synthetic 2-channel capture process in place of Core Audio or WASAPI.
These are not capture-to-ear measurements. They make no browser, hardware, or
Phase 0B support claim.

| Check | Result |
| --- | --- |
| Offer to `connected` (ICE-lite + DTLS) | 93–182 ms |
| Selected input decoded | 440 Hz at the expected RMS; switch to 1 kHz input confirmed |
| Loopback: loss / concealment / mean jitter buffer | 0 / ≤ 0.05 % / 10–12 ms |
| Synthetic Wi-Fi (1 % loss, 2–8 ms jitter, 1 % 0–60 ms stalls), two runs | 0.89–1.98 % concealed, mean jitter buffer 62–118 ms, no second with lost level |
| Synthetic poor Wi-Fi (5 % loss, 4–19 ms jitter, 2 % 0–120 ms stalls), two runs | 4.42–4.88 % concealed, mean jitter buffer 118 ms, stream stayed up |
| Worker with 8 listeners | 7.2 % of one core, 10.6–10.7 MB RSS, 0 loss |
| Browser vanishes | session closed about 15 s later (`disconnected`) |

The impairment came from a userspace UDP relay with first-in, first-out order
preserved. It is not a model of any named access point.

Before Phase 0B promotion:

- Chromium, Safari/WebKit (including iOS), and Firefox interoperability with
  this answer.
- Physical capture-to-ear percentiles on the named wired and Wi-Fi kits from
  [performance baselines](../quality/performance-baselines.md).
- Loss, jitter, and roaming behaviour on real access points, with and without
  WMM.
- Whether RED or a 20 ms resilient profile beats plain concealment on venue
  Wi-Fi.
- Backend-owned signaling with authorization, replacing the unauthenticated
  gateway endpoints.
