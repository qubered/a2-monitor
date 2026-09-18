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
