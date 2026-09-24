# ADR 0029: Shared host monitor output for the local MVP

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-24
- **Owners:** Project team
- **Supersedes:** None. Amends DESIGN.md §2.7 and
  [listening safety](../quality/listening-safety.md) (listening no longer
  starts muted).

## Context

Live plays the selected input on the device holding it (ADR 0026). A2s
already wear comms. On a Dante system the host running Pulse usually has Dante
Virtual Soundcard (DVS), whose outputs can be routed in Dante Controller into
the comms system. An A2 then wants to pick a channel on an iPad and hear it in
their comms headset, not in a second pair of headphones.

Several A2s may do this at once. They share one comms feed, so they must share
one selection: if one picks channel 1, everyone hears channel 1 and every iPad
shows it.

Separately, operators found "listening starts muted" an extra step on every
open with no benefit on a rig where output level is set elsewhere.

## Decision

For the local MVP only:

1. **Destination is chosen on open.** When the node has a host output, Live
   asks "Where should audio play?" each time it opens: **This device** (the
   ADR 0026 WebRTC path) or **Host output**. Nothing plays on the device until
   the choice is made. The last choice is offered first. It can be changed
   from a header chip. A1 mode, which has no listening, is not asked. Without
   a host output, Live plays on the device as before and asks nothing.
2. **One shared mix.** The listen gateway holds one monitor state
   (`channelId`, `input`, `muted`, `dimmed`, `gainDb`, who changed it and
   when) in memory. `GET /audio/v0/output` returns the `host-output` contract,
   `GET /audio/v0/output/events` streams it as Server-Sent Events, and
   `PATCH /audio/v0/output` changes any subset for every client. A selection
   carries both the show channel id and its input. Every host-output client
   renders its selection, mute, dim and level from that state. A gateway
   restart starts with nothing selected.
3. **The node renders it.** `pulse-media-worker` renders the mix from the
   captured blocks it already holds: a 10 ms crossfade on input change and a
   10 ms gain ramp on level, mute and dim changes. It writes mono Float32LE
   through a bounded queue and a writer thread to a new `pulse-device-output`
   child, dropping and counting blocks rather than blocking. The child opens
   exactly one explicitly named output device at 48 kHz. It copies the feed to
   the configured 1-based output channels (at most 8) and silences the rest.
4. **Real-time rules hold.** The output callback only pulls from a
   preallocated single-producer, single-consumer ring. It primes 15 ms before
   playing, plays silence and counts an underrun when empty, and skips back to
   15 ms when more than 60 ms is queued. That bounds latency when the capture
   and output clocks differ. Underruns and dropped frames are reported in the
   contract. A failed output child is restarted with 1–30 s backoff without
   touching capture or WebRTC listeners, and the worker re-sends the shared mix
   after its own restart.
5. **Configuration.** The gateway enables it only when `A2_OUTPUT_DEVICE`
   names an exact device, which stays a per-host choice. The channels are saved
   per production: the showfile gains an optional `hostOutput.outputChannels`,
   edited in Manager's Show tab. The gateway reads it with the receiver
   inventory (every 2 s) and the worker reopens only the output child on the new
   channels; capture and listeners carry on. At start, capture waits up to 2 s
   for the showfile so the output opens on the saved channels. Without a saved
   value, `A2_OUTPUT_CHANNELS` (default `1`) applies. A channel the device does
   not have is an error with the device's reason, shown in Manager and Live.
   The macOS app window gains an output device list (default **None**) and a
   default channels field. The reserved name
   `Pulse simulated output` discards the feed on a wall-clock pace and is
   labelled simulated. `npm run dev:simulate` uses it.
6. **Unmuted by default.** Device listening now starts unmuted at the stored
   level (default −18 dB). The host output starts unmuted at 0 dB with nothing
   selected, so it is silent until someone picks a channel. Mute and dim stay
   visible and one touch away (`M`, `D`). When a browser holds audio until a
   touch, Live says so and the next touch starts it.

The backend stays out of the sample path. Live sends host-output changes to
the node gateway, the same trust boundary as ADR 0026's listen signaling.

## Consequences

### Positive

- An A2 can put any input into comms from an iPad with no second headset.
- Several A2s see and control one feed and cannot disagree about what is on it.
- Capture, WebRTC listening and the output device fail independently.

### Negative

- Anyone on host output can change what everyone hears. The last change is
  attributed on screen, but there is no lock, lease or authorization. The
  endpoints are unauthenticated like ADR 0026.
- Host output adds a second device clock. With DVS for both input and output
  the clocks match. With different devices the ring skips (audible) to bound
  latency. This is a target, not a measurement.
- Latency is capture buffer + one 10 ms block + at least 15 ms ring + output
  buffer + Dante and comms latency. None of it has been measured.
- Starting unmuted removes a guard against a loud first sound. Level is set by
  the stored gain (device) or unity (host).
- The shared state is in memory and not durable.

## Alternatives considered

- **Per-client host outputs.** One output channel per iPad. Rejected: the
  request is one shared comms feed, and channel counts and routing would grow
  with the number of clients.
- **Play on the host from the gateway (Node).** Rejected: audio must not
  cross Node.js (ADR 0026), and a device callback belongs in its own process.
- **Open the output inside `pulse-device-capture`.** Rejected: keeping it
  separate lets output failure restart without interrupting capture.
- **Keep listening muted on open.** Rejected by operators.

## Validation

- Unit tests: the saved channels round-trip through the backend and switch
  the worker's output without a restart, and startup opens on them; output
  channel parsing, routing, the ring's prime, underrun,
  skip and overflow handling, sample reassembly, the monitor mix's ramps and
  crossfade, worker argument and control parsing, output event parsing,
  restart backoff, gateway change validation, the shared state, the SSE
  stream and worker re-sync, and Live's destination prompt, shared selection
  and device path.
- Simulated end to end (Linux container, headless Chromium 141,
  `npm run dev:simulate`): two iPad-sized clients chose host output; a
  selection and a dim by one appeared on the other within one second; the
  simulated output reported 0 underruns and 0 dropped frames.
- Not yet validated: the CoreAudio and WASAPI output path on hardware (the
  Windows path type-checks; the macOS app window was not compiled in this
  change), latency, drift between different devices, DVS-to-comms routing,
  and A2 use.

## Replacement gate

Move the shared monitor state behind backend authorization and the control
lease (ADR 0009) when those exist, and replace the pipe with the shared-memory
PCM ABI (ADR 0016) when the engine owns output.
