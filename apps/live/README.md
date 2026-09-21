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

The first runnable slice is the A2 channel grid. It currently provides:

- a responsive Paper/dark/system-themed channel grid using shared design
  tokens and locally bundled project fonts;
- fabricated wireless and wired sources with separate RF, audio, battery and
  check verdicts, including unknown and not-applicable states;
- the required two-step alert/selection behavior: the first press acknowledges an
  active alert and the next press selects the channel;
- local filters, a capability-honest detail surface and persistent theme choice;
- a resumable eight-dimension guided mic check with named A2/A1 verdicts and
  per-channel device-local progress;
- device-local persistence for selected source and alert acknowledgements;
- automatic five-second snapshot refresh while the backend remains available;
- a fixed monitor-output bar that starts muted and keeps mute and dim visible;
- neutral local source selection labelled `Selected`, without claiming that
  fabricated state is confirmed listening; and
- unit-level interaction coverage plus verified desktop and iPad portrait
  rendering against the canonical design reference;
- a typed HTTP snapshot adapter which rejects unknown or malformed state; and
- explicit waiting, backend-unavailable, invalid-response and reconnect states
  which never replace unknown data with zero or healthy values.

The Live grid reads the Phase 0T snapshot route through Vite's local backend
proxy. That backend response remains fabricated and has no audio-node or receiver
connection. Independently, when the temporary local listen gateway is configured,
Live shows the physical device's observed input count, keeps identity unknown,
and receives selected-channel audio directly from the node gateway. Fabricated
data is labelled in the header, missing headshots render as missing, and no
support or performance claim follows from this build.

## Run locally

Use Node.js 24 from the repository's `.node-version` file.

```sh
npm ci
npm run devices
A2_AUDIO_DEVICE="Exact device name" npm run dev
```

Vite serves the app at `http://127.0.0.1:4173`. Component checks are:

```sh
npm run check --workspace @a2-monitor/live
```

## Build progress

- [x] npm workspace and independent React/Vite production build
- [x] shared Paper/dark design tokens and offline font assets
- [x] A2 channel grid, filters, alert acknowledgement and detail surface
- [x] muted-by-default source selection with visible mute and dim controls
- [x] interaction tests and desktop/iPad visual checks
- [x] backend health and fabricated snapshot endpoint
- [x] Live snapshot loading, explicit waiting/offline/error states and reconnect
- [x] resumable guided mic-check prototype with explicit per-dimension verdicts
- [x] local physical-device input selection and muted direct PCM listening MVP
- [ ] external meter store and bounded rendering path
- [ ] audio-node media/control integration and real listening
- [ ] A1 mix-confidence, server-synchronized mic check and replay surfaces

The next application slice should add the independent Manager shell. The next
Live data slice should add bounded subscription/delta handling only after its
public contract is claimed separately; this snapshot remains fabricated until
node/backend state exists.
