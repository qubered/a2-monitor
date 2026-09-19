# A1/A2 views and collaboration

**Status:** Proposed for the theatre/musical reference product

## Product decision

A1 and A2 are role-oriented Live workspaces over one shared performance state,
not separate applications and not security roles. A user receives permissions
independently and may switch workspace when authorized. Custom layouts inherit
from a role default without creating a separate source, cue, incident, task, or
chat truth.

The A1 workspace minimizes interruption while mixing. The A2 workspace
maximizes physical and diagnostic context while managing performers and
wireless systems backstage.

## A1 workspace: mix confidence and escalation

### Persistent header

- performance/rehearsal identity, current cue/scene and next cue;
- active node/audio-device/clock/media health;
- Live connection and foreground-listening state;
- count of critical incidents, unclaimed requests and unread priority messages;
  and
- one-action personal output mute/dim and return to live.

### Main view

The default list is On Stage and Up Next, ordered by cue/mix relevance rather
than receiver number. Each compact source tile shows:

- character and performer, approved headshot, console/audio-input label;
- captured AF/peak and mute/silence state;
- summarized RF/link state and battery risk rather than every antenna value;
- stale/unverified/changed identity indicators;
- active incident owner and progress; and
- tap-to-listen, hold-to-listen, mark and replay shortcuts.

A side panel shows critical exceptions across the entire show, even for an
offstage source, plus system/audio-path faults that affect more than one input.
The A1 can temporarily expand detailed RF and assignment data without turning
the default workspace into an A2 rack view.

### A1 actions

- create “FOH heard” evidence at the current source/cue/time;
- use **Request check** for an A2 listen, placement, battery or physical task;
- use **Report fault** to open an incident and page/assign a coordinator;
- attach a replay marker and concise note, or a profile-gated voice note in
  Phase 1C;
- follow investigation status without joining every backstage message;
- acknowledge the operational impact or confirm the symptom is no longer heard;
  and
- perform personal listen/replay controls.

The A1 workspace does not default to mic-kit inventory, placement galleries,
battery cycle counts, antenna detail, swap preparation or receiver configuration.

## A2 workspace: performers, microphones and intervention

### Persistent header

- performance, cue/scene, current stage/quick-change context and next
  intervention window;
- assigned zone/track and operator identity;
- incomplete mic checks, battery actions, unclaimed incidents and urgent pages;
- receiver/audio/node freshness; and
- personal listen state and output safety.

### Main view

The default is a task-aware performer grid. It can group/filter by On Stage, Up
Next, quick change, dressing track, stage/RF zone, assigned operator, rack,
warning, unchecked state or spare status. Each compact card shows character,
performer/headshot, next action/intervention window and route, strongest RF/
audio/battery/identity exception, task/incident owner, and listen/claim actions.
It also shows a badge/count for every other show-critical category (audio loss,
RF, battery, identity, cue, client and system), so selecting one primary exception
cannot hide a second independent critical fault.

An inspector provides element/pack/receiver/input identity, detailed RF/link/
diversity/interference data, captured versus receiver audio meters, battery,
check badges, telemetry history, placement images, asset/assignment history,
cue expectations, incident evidence and deliberate replay/message/check/swap
actions.

The **My Track** queue sorts intervention plans by hard deadline, route and
travel/quick-change context. It shows prepared assets, ordered steps, blockers
and fallback rather than treating “quick change” as only a filter.

### A2 actions

- claim and update physical/diagnostic tasks;
- run mic check and record independent check results;
- compare live/replay audio with RF and assignment changes;
- send placement/stage-condition images and dictated text;
- prepare/promote a spare, swap an element/pack/kit or execute an understudy
  change from the activated pool;
- quarantine failed assets and record the disposition;
- tell A1 that an issue is confirmed, mitigated, deferred or not reproduced;
  and
- hand an incident/task to another backstage operator or shift.

### Guided mic check

A track/zone check mode uses large one-handed pass/fail/recheck controls and a
fixed call/response order. It assigns physical fit/identity to A2 and captured-
audio heard to A1 unless production policy says otherwise. Pack/asset identity
may be confirmed by scan or manual selection. Absent, already-costumed and
blocked performers remain explicit exceptions. A swap invalidates only affected
fit, RF, audio, mute, battery or spare checks; it does not erase valid work.

## Tasks versus incidents versus chat

These are distinct:

- **task:** requested work such as check placement, listen, change battery,
  prepare spare, verify audio or inspect hardware;
- **incident:** an observed or suspected fault requiring evidence, ownership,
  operational impact and resolution; and
- **chat message:** communication that may link to either but does not change
  their lifecycle by itself.

Tasks have type, source/person/role, due cue/time, priority, requester, assignee,
state (`open`, `claimed`, `blocked`, `done`, `cancelled`), completion evidence
and optional incident. A failed check can promote a task into an incident
without losing the request history.

Incident lifecycle is `open`, `investigating`, optional `mitigated`, `resolved`,
`deferred` or `false-positive`. Seen receipts and coordinator claim are separate
from lifecycle. Exact transitions are defined in the
[collaboration contract](../architecture/collaboration-contract.md).

## Chat model

Phase 1B supports the text/page subset; Phase 1C may add rich media and direct
messages after validation. The complete target model contains:

- one performance operations conversation;
- one thread per incident;
- contextual source/cue/replay-marker references in either;
- optional direct operator conversation only if field research establishes a
  need and policy permits it;
- text and predefined quick messages/reactions in Phase 1B; safe image
  attachments and short voice notes with optional local speech-to-text in 1C;
- mentions, priority page, read cursor and advisory presence; and
- message reply/correction history without silent evidence deletion.

Suggested configurable quick messages include `Check {source}`, `Listening`,
`Issue confirmed`, `Swapping pack`, `Mic repositioned`, `Battery changed`,
`Ready for A1 check` and `Hold until interval`. Lifecycle buttons, not chat
phrases, resolve or complete work and may append a system message atomically.

A reaction means only a reaction. It never claims a task, acknowledges an
incident or proves completion. A priority page requires explicit recipient
acknowledgment, is rate-limited and is recorded separately from message read
state.

### Context capture

From any tile/timeline, “message” pre-populates the source, current person/role,
cue and live/replay time. Attachments use the safe image/audio asset pipeline.
When assignment later changes, the message continues to render the identity
snapshot that was true when sent while linking to the stable source.

### Attention policy

- Critical system/source incidents can display a persistent banner.
- Assigned tasks and priority pages display targeted badges/panels.
- Ordinary chat never steals focus or opens a modal over meters.
- Notification sound is per-user and off by default. The application routes it
  only through the verified personal-client audio graph and never into the node
  programme path; deployment rules prohibit physically patching that client
  output into programme audio.
- Foreground-only browser policy applies; background push delivery is not a
  version-one promise.
- Intercom/radio is always the authoritative urgent path. Product pages are
  advisory even when the backend is healthy.

### Retention and privacy

- Conversation and attachment retention is a production policy, not an
  unbounded permanent archive.
- Messages deliberately selected as incident evidence may move to the
  incident's longer retention class; unrelated chat does not move with them.
- Corrections remain visible as versions. Privileged removal leaves an audited
  tombstone, and chat export is separately permissioned.
- Placement images and voice notes are treated as sensitive performer data.
- Presence is minimized, expires quickly and is advisory rather than a record
  of a person's physical location or response.
- Optional transcription stays on the approved local deployment and cannot be
  required for core show operation.

## Incident collaboration

An incident timeline merges system observations, operator reports, cue changes,
assignment/swap events, replay markers, ownership, tasks and selected messages.
It does not copy an entire chat indiscriminately.

Typical A1-to-A2 flow:

1. A1 hears a problem, taps the source and creates evidence at the current cue.
2. **Report fault** opens an incident; **Request check** opens a task. The
   system pages the appropriate A2 according to production policy.
3. A2 claims it; A1 sees owner and state without leaving the mix view.
4. A2 listens live/replay, inspects RF and placement, and records findings.
5. A2 mitigates/swaps/repositions, records checks and requests A1 confirmation.
6. A1 confirms impact is gone or reports it persists.
7. Owner resolves, defers or marks false-positive with evidence and confidence.

The reverse flow is supported: A2 may identify a problem before it reaches FOH,
mitigate it, and notify A1 only when mix awareness or confirmation is needed.

## Handoff

The handoff view is anchored to the last mutually accepted shift checkpoint,
or performance start for a new operator. It summarizes:

- open/mitigated incidents and next action;
- open/blocked tasks and owner;
- cast, mic, path and cue changes since that performance-event watermark;
- quarantined assets and consumed/unverified spares;
- unread priority pages and linked evidence; and
- current node/audio/receiver/replay health.

Handoff records outgoing and incoming acceptance, calls out late-arriving
offline events, and requires a verbal-brief reminder. Viewing it does not move
the checkpoint, change ownership or mark unresolved work complete.
The normative draft/attest/accept/dispute/forced transitions, item disposition,
composite watermark and late-arrival re-acknowledgement rules are in
[cue and operator state machines](../architecture/cue-and-operator-state-machines.md).

## Degraded behavior

Chat, presence, read cursors and ordinary task assignment require the backend.
During a backend outage, the existing Live client clearly marks collaboration
offline and may keep an unsent memory-only draft, but must not display it as
sent. Operators use intercom and the printable emergency change log.

Leased node operations still allow listening, replay, cue movement, approved
emergency swaps, check results and local evidence markers needed for immediate
show safety. Incident/task lifecycle and ownership wait for the backend. The
node does not become a general chat or collaboration server.

## Permissions and customization

Workspace defaults and permissions are independent. Example scopes include:

- `layout.use`, `layout.customize` (A1/A2 template access conveys no operational
  authority);
- `task.create`, `task.assign`, `task.complete`;
- `incident.create`, `incident.claim`, `incident.resolve`, `incident.escalate`;
- `chat.read`, `chat.send`, `chat.page`, `chat.direct`;
- `cue.control`, `swap.performer`, `swap.microphone`; and
- existing listen, replay, image, export and administration scopes.

A production can rename A1/A2 workspaces for local terminology and save role-
specific layouts. Permission denial remains server-side regardless of what a
workspace hides.

## Acceptance scenarios

- A1 reports a noise, attaches the exact live marker and returns to mixing in
  two interactions; A2 claims it without a verbal identity translation.
- A2 diagnoses hair/placement noise using image plus replay, repositions the
  mic and asks A1 to confirm.
- A2 detects RF trouble first, swaps to an approved spare and sends A1 only the
  relevant mitigation summary.
- Two A2s cannot silently claim the same exclusive task; reassignment is visible.
- A message sent before an understudy swap retains the historically correct
  person/role/headshot context.
- A reaction does not resolve an incident or complete a task.
- A priority page cannot be spammed and shows delivery versus acknowledgment.
- Backend outage disables chat honestly while leased safety events continue and
  later reconcile.
- Handoff shows everything changed during the outgoing operator's shift without
  requiring a scan of all chat.
