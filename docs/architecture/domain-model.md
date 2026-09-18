# Domain model

**Status:** Proposed

The model deliberately separates the human/source, audio input, radio link,
and transmitter. Productions repatch audio and swap transmitters; identity must
survive those changes without attaching history to the wrong person.

## Core entities

### Production / show template

- stable ID, name, timezone, revision;
- roles, planned cast alternatives, sources, inventory plans, bindings, cue
  lists, groups, scenes, rules, layouts, and image relationships;
- supported import/export schema version.

The backend owns editable production drafts and activation history. An audio node
receives an immutable activated revision and caches it for disconnected use.

### Performance

A rehearsal, matinee, evening show, or other dated run of a production.

- stable ID, production/show revision, timezone and lifecycle state;
- performance-specific cast, microphone and cue runtime overlays;
- current cue, runtime revision and activated emergency asset pool; and
- start/end, interval, operator and reconciliation history.

### Operator workspace and layout

- stable workspace-template ID/kind such as A1, A2 or a production-defined
  derivative, separate from its mutable local display label;
- user-owned filters, density, ordering, pinned groups and notification choices;
- optional production defaults and large-display layouts; and
- no authority of its own: permissions come from roles/scopes, not the selected
  workspace.

Changing workspace changes presentation, never performance truth, identity,
incident ownership or command authorization.

### Person and role

- person: human identity, display metadata, consent/privacy and headshot
  relationships;
- role: character/operational identity, short label, display order, cue/scene
  expectations and microphone requirements; and
- neither stores a mutable transmitter, receiver or audio-input field.

### Cast assignment

- performance, role, person and assignment type such as principal, understudy,
  swing, cover or emergency;
- half-open valid interval, recorded-at transaction time, cue occurrence/time
  boundary, verification and approving operator; and
- replacement/supersession link so a swap never rewrites earlier history.

Cast and equipment relationships are bitemporal: valid time describes when the
relationship was true in the show; recorded time describes when the system
learned or corrected it. Late/post-hoc entries preserve both. Within a capture
epoch, frame position outranks mapped monotonic time, which outranks UTC. Ties
use the authoritative origin sequence. Cross-epoch order requires an explicit
mapping with uncertainty and never assumes frame indices are comparable.

### Audio node

- stable node ID, name, software/protocol versions, and capabilities;
- approved network endpoints and current connection state;
- audio devices, channel capacity, resource envelope, and clock health;
- active and cached show revision;
- health, underrun, storage, and media-session state.

### Audio device profile

- operating system, host API, stable device identity, driver and firmware;
- sample format/rate, buffer size, input count, and channel layout;
- compatibility state and linked validation evidence; and
- exactly one active profile per node.

### Source

The thing an operator recognizes: performer, instrument, playback stem,
intercom feed, or wired microphone.

- name, short label, image reference, colour, notes;
- tags and operational role;
- descriptive presentation metadata and tags; and
- revision-stamped current audio/radio, performer/role, asset, cue/scene, zone,
  spare, operator and verification **projections** derived from authoritative
  assignments, bindings and runtime state.

Current projections are read-only through Source APIs. They cannot be patched
to bypass interval history or the authoritative runtime command path.

### Audio input

- ingress node and stable port identity;
- Dante/DVS label and numeric index;
- sample rate, clock state, mute, peak, RMS, and analysis state;
- observed rather than configured routing where available;
- upstream device/channel identity used in the activation manifest.

### Receiver device

- adapter type, vendor, model, serial/stable device ID, firmware;
- compatibility state, matched profile, transport, and operating mode;
- current addresses and discovery state;
- capabilities, logical channel count, and connection health;
- credential reference, never credential material in the domain event stream.

### Radio link

- receiver device and receiver channel ID;
- frequency, RSSI, quality, diversity, mute, RF mode, and warnings;
- current transmitter associations and primary/spare/redundant purpose.

Every telemetry field carries availability and source metadata. Receiver meters
and audio-node PCM meters are separate observations even when they describe the
same source. Unsupported metrics are absent/unavailable rather than synthesized
as zero.

### Transmitter

- vendor identity and model;
- battery type, state, estimated remaining time, mute, and warnings;
- association history.

### Microphone asset and assignment

- independently tracked element, transmitter, accessory and optional kit
  records with asset/serial identity, status and condition;
- time-bounded assignment to a person/cast assignment, placement/costume,
  radio path and captured audio input;
- primary, spare, temporary or deliberate redundant-path purpose; and
- fit, RF, audio, mute, battery and spare verification results.

Asset exclusivity is enforced unless a relationship explicitly models a
redundant/frequency-diversity path.

### Binding

A time-bounded association among a source, audio input, and optional radio
link/transmitter. Every binding change creates an event so historical replay
uses the identity that was true at that time.

### Group and scene

A group is an operator-facing collection with optional listen mix properties.
A scene is a named set of group membership and presentation changes. Changing a
scene must not rewrite historical membership.

### Cue and cue runtime

- immutable cue definition with stable ID, display number, sortable rank,
  scene/type/description and absolute expected-state snapshot;
- On Stage, Up Next, expected-silent, zone, monitoring-priority and alert-arming
  context; and
- performance runtime with current/prior cue, sequence, trigger identity,
  activation time and skipped/backtracked markers.

### Cue occurrence and authority

- an occurrence ID and monotonic cue-runtime sequence for every accepted go,
  select, resync, back or skip, even when a definition repeats;
- cue-definition ID, prior occurrence, origin/adapter, external stable ID,
  effective/receive time, action and authority epoch; and
- authority quality: healthy, stale, unknown, held or resync-required.

Expected state is an absolute snapshot for each definition, not an arbitrary
delta chain. Scheduled operations target an occurrence condition/runtime
sequence and revalidate reservations immediately before execution.

### Intervention plan

An intervention plan represents a quick change or other time-bounded physical
workflow:

- performer/role, route/location/zone, opening and hard-deadline occurrences;
- responsible A2/dresser, ordered actions, prepared assets and dependencies;
- per-action state, checks, blocked reason and fallback; and
- completion evidence and actual physical timestamps.

It is the source for “what must happen next on my track,” not merely a filter.

### Image asset

- purpose, owning record, content hash, safe media metadata, focal point/crop,
  alt text, sensitivity, consent/source and retention;
- generated bounded variants referenced by ID; and
- no public filesystem path or binary data in ordinary domain messages.

### Attachment asset

A generic chat/incident image or voice attachment has:

- upload intent, owning performance/uploader, declared type/size/hash and
  authorization policy;
- quarantine, processing, ready, rejected, expired or deleted state;
- immutable safe renditions/transcript versions with content hashes;
- byte/pixel/duration, quota, retention and deletion policy; and
- an orphan expiry when no message/evidence relationship is finalized.

Only ready renditions may be referenced by a message. Deduplication cannot leak
whether another user/performance already possesses the same content.

### Event

- event ID and type;
- source time, receive time, and monotonic media position when applicable;
- originating component/device and normalized payload;
- severity, confidence, lifecycle, acknowledgements, and operator notes;
- links to related events and replay interval.

Cast, microphone, path and cue changes are durable events. Undo creates an
inverse transaction and never deletes the original event.

### Incident

- observed facts, derived warnings, and suspected causes kept separately;
- lifecycle: open, investigating, mitigated, resolved, deferred, or
  false-positive;
- per-user seen receipts and a separately claimed coordinator; and
- handoff history, child tasks/workers, action, evidence, confidence, and replay
  markers.

### Task

A task is explicit requested work, not an incident state or chat message.

- type, title, priority, requester, assignee, and `open`, `claimed`, `blocked`,
  `done`, or `cancelled` state;
- optional due cue/time and links to person, role, source, microphone asset,
  cue, incident, replay interval and image; and
- claim/reassignment history, completion evidence and completing operator.

Exclusive claims use optimistic concurrency. A quick message can propose a task
but does not create or complete one without an explicit command.

### Conversation and message

- conversation kind: performance operations, incident thread or permitted
  direct conversation, with performance and participant/scope relationships;
- message kind: text, structured quick message, image, short voice note, system
  event or correction/tombstone;
- author, server order, client/idempotency ID, creation/edit state, mentions,
  reactions and optional priority-page relationship; and
- contextual links plus an immutable display snapshot of the effective
  source/person/role/cue identity at send time.

Messages are durable backend records with configured retention. Corrections
are explicit versions and privileged removal leaves an audited tombstone.
Reactions and read cursors are communication state, not acknowledgement,
incident ownership, task completion or show control.

### Operator presence, read cursor and priority page

- presence is advisory, expiring session state such as active workspace and
  last activity; it is never evidence that an operator heard or acted;
- a read cursor records the latest server-ordered message observed per
  conversation and user; and
- a priority page snapshots concrete recipients and records per-recipient
  accepted, dispatched, received/displayed where provable, acknowledged,
  expired, cancelled or failed state with rate limits and audit.

A page can point to a task or incident but cannot change its lifecycle.

### Shift and handoff checkpoint

- shift ID, performance, incoming/outgoing operators and accepted-at times;
- durable performance-event watermark, not a conversation read cursor;
- outstanding incidents/tasks, on-body assets, missing performers, changes,
  next actions and due cue occurrences; and
- explicit outgoing/incoming acceptance plus a verbal-brief reminder.

Late offline events earlier than the watermark reopen the handoff delta and are
shown as late arrivals; merely viewing the summary does not advance it.

### Capture epoch

- node, capture session, epoch ID, sample rate, and channel-layout identity;
- frame index range, monotonic/UTC anchor, start/end reason, and gaps;
- telemetry time mapping and uncertainty.

## Units and time

- Store frequency in hertz, duration in nanoseconds or explicit integer units,
  audio level in dBFS, and RF level in dBm.
- Use explicit unknown/unavailable state rather than magic numeric values.
- Preserve vendor raw values only inside adapter diagnostics.
- Machine timestamps use UTC plus a monotonic media/sample position.
- Never use wall-clock time alone to align replay.
- Never compare frame indices across epochs without an explicit mapping.

## Compatibility

- Persisted and wire schemas are versioned.
- Readers must reject incompatible major versions with a useful error.
- Additive fields are preferred; removal or semantic change requires migration.
- Show exports contain a manifest, schema version, checksums, and no credentials.
