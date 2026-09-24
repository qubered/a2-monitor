# ADR 0031: Shared host monitor output for the local MVP

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

1. **Destination is chosen once per device.** When the node has a host output
   and this device has no remembered choice, Live asks "Where should audio
   play?": **This device** (the ADR 0026 WebRTC path) or one of the host output
   **feeds** by name (for example Comms A on output 1, Comms B on output 2),
   with what each is playing now. Nothing plays on the device until the choice
   is made. The choice is remembered in that browser and used on later opens
   without asking. It can be changed from a header chip. If the remembered feed
   is removed, Live asks again. A1 mode, which has no listening, is not asked.
   Without a host output, Live plays on the device as before and asks nothing.
2. **One shared mix per feed.** The listen gateway holds one monitor state
   per feed (`channelId`, `input`, `muted`, `dimmed`, `gainDb`, who changed
   it and when) in memory. `GET /audio/v0/output` returns the `host-output`
   contract with every feed, `GET /audio/v0/output/events` streams it as
   Server-Sent Events, and `PATCH /audio/v0/output/feeds/{id}` changes any
   subset for everyone in that feed. A selection carries both the show
   channel id and its input. Feeds are independent. Reconfiguring keeps each
   surviving feed's state by id. A gateway restart starts with nothing
   selected.
3. **The node renders them.** `pulse-media-worker` renders one mix per feed
   from the captured blocks it already holds: a 10 ms crossfade on input change
   and a 10 ms gain ramp on level, mute and dim changes. It writes the mixes as
   interleaved Float32LE frames (one sample per feed) through a bounded queue
   and a writer thread to a new `pulse-device-output` child, dropping and
   counting blocks rather than blocking. The child opens exactly one explicitly
   named output device at 48 kHz, once for every feed. It copies each mix to
   that feed's 1-based output channels and silences the rest. A device
   channel carries at most one feed. There are at most 8 feeds and 8
   channels per feed.
4. **Real-time rules hold.** The output callback only pulls from a
   preallocated single-producer, single-consumer ring of whole frames. It primes
   15 ms before playing, plays silence and counts an underrun when empty, and
   skips back to 15 ms when more than 60 ms is queued. That bounds latency when
   the capture and output clocks differ. Underruns and dropped frames are
   reported in the contract. A failed output child is restarted with 1–30 s
   backoff without touching capture or WebRTC listeners. After its own restart,
   the worker gets the routes and every feed's mix again.
5. **Configuration.** The gateway enables host output only when
   `A2_OUTPUT_DEVICE` names an exact device, which stays a per-host choice.
   Feeds are saved per production: the showfile gains an optional
   `hostOutput.feeds` (id, name, output channels), edited in Manager's
   **Host output** tab. Outputs are picked from a list of the device's free
   channels once it reports its channel count. The backend rejects empty,
   duplicate or overlapping feeds. The gateway reads them with the receiver
   inventory (every 2 s), and the worker reopens only the output child on the
   new routes; capture and listeners carry on. At start, capture waits up to
   2 s for the showfile so the output opens on the saved routes. Without saved
   feeds there is one default feed, **Host output**, on
   `A2_OUTPUT_CHANNELS` (default `1`). A channel the device does not have is an
   error with the device's reason, shown in Manager and Live. The macOS app
   window gains an output device list (default **None**) and a default channels
   field. The reserved name `Pulse simulated output` (8 outputs) discards the
   feed on a wall-clock pace and is labelled simulated. `npm run dev:simulate`
   uses it with a demo show that has two feeds.
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

- Anyone in a feed can change what everyone in it hears. The last change is
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

- Unit tests: feeds round-trip through the backend (incoherent ones are
  refused) and switch the worker's routes without a restart, startup opens on
  them, feeds keep independent state, and Live joins one by name and
  follows only it; route parsing and interleaved rendering; output
  channel parsing, routing, the ring's prime, underrun,
  skip and overflow handling, sample reassembly, the monitor mix's ramps and
  crossfade, worker argument and control parsing, output event parsing,
  restart backoff, gateway change validation, the shared state, the SSE
  stream and worker re-sync, and Live's destination prompt, shared selection
  and device path.
- Simulated end to end (Linux container, headless Chromium 141,
  `npm run dev:simulate`): two iPad-sized clients joined Comms A and one
  joined Comms B; a selection and a mute in Comms A appeared on the other
  Comms A client within one second and did not change Comms B; adding output 5
  to Comms B in Manager reopened the output with both selections kept; the
  simulated output reported 0 underruns and 0 dropped frames.
- Not yet validated: the CoreAudio and WASAPI output path on hardware (the
  Windows path type-checks; the macOS app window was not compiled in this
  change), latency, drift between different devices, DVS-to-comms routing,
  and A2 use.

## Replacement gate

Move the shared monitor state behind backend authorization and the control
lease (ADR 0009) when those exist, and replace the pipe with the shared-memory
PCM ABI (ADR 0016) when the engine owns output.
