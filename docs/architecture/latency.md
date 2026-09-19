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

The offer/answer must request Opus at 48 kHz and record the actual payload type,
channel count, `ptime`/`maxptime`, `stereo`/`sprop-stereo`, in-band FEC, DTX and
bitrate-related FMTP values. The test harness parses the negotiated SDP and RTP
packet cadence; a UI configuration value is not proof that the packet profile
was used. `jitterBufferTarget` is an optimization only where the named browser
actually implements it, never a support prerequisite.

## Test method

Use a physical impulse or timecoded click:

1. feed the signal into the Dante source;
2. record the source signal and client headphone output on the same reference
   recorder/interface;
3. calculate sample offset over at least 100 events;
4. report p50, p95, p99, maximum, and audible discontinuities; and
5. report a robust latency-versus-time slope across the full run; and
6. repeat after a one-hour warm-up and during representative CPU/network load.

Test at least:

- wired client on the control LAN;
- dedicated Wi-Fi 6/6E client;
- controlled packet loss, jitter, reordering, and roaming;
- every supported browser/OS combination; and
- default output, USB interface, and Bluetooth output where supported.

Bluetooth measurements must be reported separately because device codec and
buffer latency are outside the application's control.

The executable Phase 0B gates are wired p50/p95/p99/max <= 50/75/100/150 ms
and Wi-Fi <= 80/120/180/250 ms. Maximum single audible interruptions are
<= 100 ms wired and <= 250 ms on the declared venue-Wi-Fi profile. Capture-to-
ear latency drift must remain within an absolute 1 ms/hour slope. The frozen
impairment manifest records direction, delay distribution, burst model, loss,
jitter, reorder, duplication, corruption, bandwidth and outage schedule so the
same profile can be reproduced.

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

Capture frame number and epoch are the media time authority. RTP/RTCP mapping,
gap handling and worker-restart generation rules are specified in the
[media clock and IPC ABI](media-clock-and-ipc-abi.md); wall clock is never used
to advance RTP timestamps.

## Product boundary

Browser monitoring is for auditioning and diagnosis. It is not an IEM,
performer foldback, or phase-coherent monitoring system. Marketing and UI copy
must preserve this distinction.
