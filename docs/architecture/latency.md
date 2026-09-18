# Latency architecture

**Status:** Proposed targets; not yet validated

## Decision

Use WebRTC with Opus for the first production browser transport. Maintain one
continuous mono or stereo monitor stream per client and perform source routing
on the server.

WebTransport plus a custom decoder/jitter buffer remains an experiment after
the WebRTC baseline is proven. WebSocket PCM and segmented streaming are not
approved for live listening.

See [ADR 0002](../decisions/0002-webrtc-opus.md).

## Latency components

Capture-to-ear latency includes:

1. Dante/DVS receive buffer;
2. host audio-driver buffer;
3. internal block and routing delay;
4. Opus frame and encoder delay;
5. packet transit;
6. receiver jitter buffer;
7. decoder and browser audio graph; and
8. operating-system/device output buffering.

The project must measure the total physical path. Adding API-reported values is
useful for attribution but is not an acceptable end-to-end result by itself.

## Initial media profiles

### Low-latency profile

- 48 kHz Opus;
- request 10 ms packetization;
- continuous transmission with DTX disabled;
- speech processing disabled;
- mono 64–96 kbit/s or stereo 128–160 kbit/s;
- requested jitter target of 10–20 ms; and
- in-band FEC evaluated rather than assumed.

### Resilient Wi-Fi profile

- 48 kHz Opus;
- 20 ms packetization if it materially improves stability;
- larger adaptive jitter target;
- in-band FEC when loss testing justifies it; and
- visible latency-quality mode in diagnostics.

The browser may clamp or ignore requested behavior. Negotiated SDP and measured
WebRTC statistics must be captured with every benchmark.

## Test method

Use a physical impulse or timecoded click:

1. feed the signal into the Dante source;
2. record the source signal and client headphone output on the same reference
   recorder/interface;
3. calculate sample offset over at least 100 events;
4. report p50, p95, p99, maximum, and audible discontinuities; and
5. repeat after a one-hour warm-up and during representative CPU/network load.

Test at least:

- wired client on the control LAN;
- dedicated Wi-Fi 6/6E client;
- controlled packet loss, jitter, reordering, and roaming;
- every supported browser/OS combination; and
- default output, USB interface, and Bluetooth output where supported.

Bluetooth measurements must be reported separately because device codec and
buffer latency are outside the application's control.

## Switching latency

Tap-to-switch has two measurements:

- operator gesture to the first audible sample from the new source; and
- node command receipt to the first changed sample in the monitor bus.

The first is the product result; the second attributes control and render
delay. Keep the WebRTC encoder and track alive, change the server mix matrix,
and apply a short de-click crossfade. Do not use track replacement or session
renegotiation for ordinary solo changes.

## Diagnostics

Expose, with sampling that does not burden the real-time path:

- audio callback duration and deadline misses;
- driver/DVS buffer configuration;
- encoder queue depth and duration;
- RTP packet loss, jitter, round-trip time, and concealed samples;
- actual and requested jitter-buffer delay;
- client audio context latency where available; and
- client device, browser, output sink, and network type.

Browser lifecycle validation also includes reload/crash, screen lock/wake, app
switching, audio-context suspension, permission reset, output unplug/replug,
Wi-Fi roaming, ICE restart, and backend restart. Background listening is not a
supported promise unless the exact client profile proves it.

Version one is explicitly foreground-only. On visibility loss, screen lock, or
audio-context suspension, Live must mark monitoring interrupted rather than
showing a misleading healthy listen state. Foreground recovery is measured;
continuous background audio is deferred.

## Product boundary

Browser monitoring is for auditioning and diagnosis. It is not an IEM,
performer foldback, or phase-coherent monitoring system. Marketing and UI copy
must preserve this distinction.
