# Live web application

Live is the focused operator surface used during rehearsals and performances.
It should open quickly, stay legible under pressure, and expose only the tools
needed to monitor and diagnose the active show.

## Owns

- A1 mix-confidence and escalation workspace plus A2 performer/microphone
  intervention workspace over one shared performance state;
- dense channel and group monitoring;
- personal listen, gain, pan, dim, and output selection;
- mic check and scene/On Stage/Up Next workflows;
- live and historical audio/RF/battery state;
- synchronized replay, markers, notes, incidents, and acknowledgements;
- node, media, network, latency, and stale-state health;
- touch, keyboard, and large-display interaction;
- replay/live safety, safe output level, and one-action return to live;
- incident claim, ownership, resolution, and handoff;
- explicit tasks, contextual performance/incident chat, reactions, safe image
  and short voice-note attachments, priority pages and handoff summaries;
- a narrow, audited emergency remap workflow while the show is locked;
- role/performer identity, approved headshots, cues, primary/spare state, and
  atomic understudy/microphone swap previews.

Live receives management/state and a signed show-time lease through the
backend. While healthy it sends commands through the backend to the active-node
sequencer; during a backend interruption an established session may send only
lease-approved personal listen/replay, cue, verification/evidence-marker and
activated-pool emergency-swap commands to the node gateway. It receives WebRTC
media directly from the selected audio node. It does not hold receiver
credentials or connect to hardware management networks.

Version one supports foreground browser operation. When the page is hidden,
the device locks, or the browser suspends audio, Live must declare monitoring
interrupted and guide the operator through foreground recovery. It must not
claim reliable background listening merely because one client happens to allow
it.

The supported mobile posture is a dedicated, screen-awake foreground device
with validated power, output and mounting/carry arrangement. Intercom/radio is
the authoritative urgent path; product priority pages are advisory. Wake lock,
Guided Access or MDM can reduce accidental interruption but do not create a
background guarantee.

Workspace selection is a presentation preference, not a permission role.
Ordinary chat cannot cover meters, steal focus or imply that a task/incident was
acknowledged. Notification audio is a personal opt-in, off by default and
enabled only on profiles where the verified app audio graph and sink cannot
interrupt monitoring. Voice recording is likewise profile-gated.

Manager-only screens, dependencies, and mutation paths must not be bundled into
Live. Emergency operational changes must be explicitly designed rather than
silently exposing the entire Manager inside the show UI.

## Implementation baseline

Live is a strict TypeScript React application built with Vite as an independent
npm workspace and static bundle. REST supplies snapshots/commands, WebSocket
supplies bounded state deltas and signaling, and direct WebRTC supplies the
continuous monitor track plus its leased control channel.

High-rate audio/RF meters and timelines use bounded external stores plus a
Canvas/WebGL render scheduler rather than a React render per sample. A service
worker may cache only the app shell; it cannot cache credentials, API state,
mutations or media, and it does not change the foreground-only contract.

## Current implementation

Live renders one shared monitoring state from the backend (ADR 0027):

- channel cards from the active showfile with the real headshot when Manager
  has one, a 10-second meter trace drawn from the node's 20 Hz meter stream
  (present, silent, gap and stale drawn differently), and the three-cell
  RF · Audio · Battery status strip computed by the backend;
- the alert ring and band from backend alerts: pressing the card acknowledges
  that alert as the operator named on this device, for every Live client;
  caution overlays show an expiry countdown and expire while still counting as
  outstanding; critical overlays hold until acknowledged, and a cleared fault
  takes its alert with it;
- channels always in showfile order; a channel with an active critical alert
  is shown whatever the filter, in its own place, and no card ever moves;
- a run-of-show bar when the showfile has sessions (ADR 0029): now and next,
  and a turnover sheet listing each channel the next session uses with its
  presenter change and what it waits on (transmitter off, a battery to change,
  including one that will not last the scheduled session, or a battery nobody
  can measure) before one action starts the session for every client;
  channels the running session does not use read "Not in this session" and do
  not alert for silence, mute or transmitter loss, and a "This session" filter
  shows only the channels in use;
- rooms and categories when the showfile has them (ADR 0030): a per-device
  room bar, a grid grouped under category headings, and one run of show per
  room; the header's alert count stays show-wide;
- a header counter of outstanding and critical alerts that opens a show-wide
  exceptions sheet with recently cleared history, and an assertive live-region
  announcement for each newly raised critical alert;
- a capability-driven detail surface: captured peak/RMS and silence duration,
  RF level and link quality kept separate, antenna, interference, transmitter,
  battery, receiver, frequency and telemetry age, with stale and unknown values
  labelled as such;
- a player with the selected input's live peak and an honest history cursor
  over the backend's per-second level history (the cursor never implies audio
  replay, which does not exist yet);
- explicit waiting, reconnecting, backend-offline, node-unreachable,
  capture-failed, receiver-stale and meter-reconnecting states; with the
  backend offline, cards keep last-known identity, every verdict becomes
  unknown and listening continues through the node;
- the resumable eight-dimension guided mic check, shared through the backend
  so every device sees the same attributed verdicts in the channel detail
  (a changed patch or performer makes an old check stale);
- an A1 role (set per device on the name chip) that turns the grid into the
  mix-confidence surface: no listen control; pressing a channel opens the
  report sheet (nine faults in the A1's words, multi-select, two presses, a
  ten-second undo and "Mark urgent — it is on air now"); the bottom bar lists
  open reports and who has them, plus captured-audio check requests;
- on the A2 side, a persistent, silent, dismissible banner for every unclaimed
  report, a pulsing outline and Reported badge on the card until claimed, and
  claim and mark-fixed actions in the banner, detail and exceptions sheet;
  incidents wait for the A1 to confirm the fix;
- listening over WebRTC/Opus directly from the node (ADR 0026), unmuted on
  start (ADR 0031). Changing input switches the node's selection inside the
  same session, so mute, dim and gain carry over; gain runs from `-60 dB` to
  `+24 dB` and dim adds `-12 dB`; and
- shared host output feeds (ADR 0031). When the node has an output device,
  Live asks on open whether audio plays on this device or in one of the
  production's feeds (for example Comms A on DVS output 1). Everyone in a
  feed shares its selection, mute, dim and level, and the player names who
  changed it last.

A simulated test signal is labelled `Simulated test signal` in the header at
every width. No support, performance or operator claim follows from this build.

## Run locally

Use Node.js 24 from the repository's `.node-version` file.

```sh
npm ci
npm run devices
A2_AUDIO_DEVICE="Exact device name" npm run dev
```

Without hardware, `npm run dev:simulate` runs the same stack against the
built-in test signal, a simulated host output and a simulated Shure AD4Q, with a seeded demo show in
`data/simulated`. Vite serves Live at `http://127.0.0.1:4173` and Manager at
`http://127.0.0.1:4174/manager/`. Component checks are:

```sh
npm run check --workspace @rvlt/pulse-live
```

## Build progress

- [x] npm workspace and independent React/Vite production build
- [x] shared Paper/dark design tokens and offline font assets
- [x] A2 channel grid, filters, alert acknowledgement and detail surface
- [x] source selection with visible mute and dim controls (unmuted on start)
- [x] shared host output feeds chosen on open (ADR 0031)
- [x] interaction tests and desktop/iPad visual checks
- [x] backend health and fabricated snapshot endpoint
- [x] Live snapshot loading, explicit waiting/offline/error states and reconnect
- [x] resumable guided mic-check prototype with explicit per-dimension verdicts
- [x] local physical-device input selection and muted direct PCM listening MVP
- [x] external meter store and bounded canvas rendering path
- [x] shared backend state over server-sent events, backend-owned alerts and
      acknowledgements, exceptions sheet
- [ ] audio-node WebRTC media/control integration
- [x] server-synchronized mic check with the A1 captured-audio verdict
- [x] A1 mix-confidence surface and fault report → A2 task/incident loop
- [ ] audio replay
