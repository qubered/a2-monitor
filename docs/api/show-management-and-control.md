# Show management and control API

**Status:** Proposed public local API contract

The Manager and Live applications use the same documented API available to
approved local integrations. UI-only hidden behavior is not permitted. OpenAPI
describes request/response resources and AsyncAPI or an equivalent schema
describes subscriptions once the implementation stack is selected.

## Surfaces

### Management API

HTTPS under `/api/v1` owns draft and administrative resources:

- productions, immutable show revisions and performances;
- people, roles, cast alternatives and assignments;
- microphone elements, transmitters, kits, spares and inventory state;
- receiver/audio inputs and binding plans;
- cue lists, scenes, rules, groups and layouts;
- images and generated variants;
- users, service accounts, roles and API credentials; and
- validation, activation, import/export and audit queries.

Draft resource updates use optimistic concurrency through an ETag/revision.
Activated revisions are immutable. Pagination, filtering, sorting, field
selection and hard response limits are consistent across collections.

Initial route families are:

| Purpose | Representative routes |
| --- | --- |
| People and assets | `GET/POST /api/v1/people`, `GET/PATCH /api/v1/people/{id}`, `POST /api/v1/attachment-uploads`, `POST /api/v1/attachment-uploads/{id}/finalize` |
| Roles and cast | `GET/POST /api/v1/productions/{id}/roles`, `GET/POST /api/v1/performances/{id}/cast-assignments` |
| Microphone inventory | `GET/POST /api/v1/microphone-assets`, `GET /api/v1/microphone-assets/{id}/history` |
| Cues | `GET/POST /api/v1/productions/{id}/cue-lists`, `GET/PATCH /api/v1/cue-lists/{id}/cues/{cueId}` |
| Performance state | `GET /api/v1/performances/{id}`, `GET /api/v1/performances/{id}/identity-manifest` |
| Tasks and incidents | `GET/POST /api/v1/performances/{id}/tasks`, `GET/POST /api/v1/performances/{id}/incidents` |
| Conversations | `GET/POST /api/v1/performances/{id}/conversations`, `GET/POST /api/v1/conversations/{id}/messages` |
| Message state | `POST /api/v1/messages/{id}/reactions`, `PUT /api/v1/conversations/{id}/read-cursor`, `POST /api/v1/conversations/{id}/pages` |
| Workspaces | `GET/PUT /api/v1/users/me/workspaces/{templateId}` |
| Offline show pack | `POST /api/v1/performances/{id}/show-pack-exports` |
| Show-time commands | `POST /api/v1/performances/{id}/commands/{command}` |
| Subscriptions | `GET /api/v1/subscriptions` upgraded to the selected WebSocket protocol |
| Audit/history | `GET /api/v1/performances/{id}/events`, `GET /api/v1/audit-events` |

Exact pluralization is frozen with the first OpenAPI contract; the resource and
transaction boundaries are the durable decision.

The public HTTP API uses lower-camel JSON fields and kebab-case action routes;
all IDs are UUID strings. Boundary adapters map them explicitly to canonical
protocol snake_case fields and PascalCase commands. No API body is signed or
stored as a canonical command until that mapping validates against the shared
schema; generated mapping tests cover every command and reject unmapped fields.
`production`, `show revision` and `performance` are the only lifecycle terms;
there is no separate mutable `show` aggregate.

### Show-control command API

Show-time changes are commands, not generic PATCH requests:

- `preview-performer-swap` / `commit-performer-swap`;
- `preview-microphone-swap` / `commit-microphone-swap`;
- `preview-path-repatch` / `commit-path-repatch`;
- `cue-go`, `cue-select-resync`, `cue-back`, `cue-skip`, `cue-hold` and
  `cue-resume` in manual-authority mode;
- `begin-cue-rebase`, `commit-cue-rebase` and `transfer-cue-authority` for
  explicit external recovery/manual handover;
- `record-check`, `record-battery-change` and `record-placement`;
- the complete task/incident commands defined in the
  [collaboration contract](../architecture/collaboration-contract.md); and
- personal listen/replay commands covered by a node lease.

Healthy runtime commands enter through these backend routes, but the backend
authorizes and forwards cue/assignment-overlay commands to the one active-node
sequencer; it does not commit a competing runtime copy. The direct leased route
during backend loss terminates at the same node authority and result ledger.
See [ADR 0004](../decisions/0004-active-performance-command-authority.md).

Every command includes command ID/idempotency key, actor/service identity,
client correlation ID and the aggregate-specific precondition: show revision,
authority epoch, performance-overlay revision, cue-runtime sequence, task
revision or incident revision as appropriate. Effective boundaries use now,
capture epoch/frame, or a cue occurrence condition rather than a cue label.
Preview returns a short-lived prepared transaction with node, authority epoch,
aggregate revision, payload/hardware-manifest hash and complete diff. Commit
references that exact preparation at that node. Stale, expired or changed
preparations fail safely.

Swap commands update the product's identity/assignment model and verify
observed hardware. They do not implicitly retune, pair, sync, or otherwise
control a receiver/transmitter in version one; future device-control actions
need separate capabilities, permissions, confirmation and audit.

Representative resource shape:

```json
{
  "commandId": "9f5e6682-1452-4f5b-82ba-fec50af5f968",
  "authorityEpoch": "00000000000000000000000000000007",
  "expectedOverlayRevision": "42",
  "effective": { "kind": "now" },
  "roleId": "74025a2f-acac-46da-ac05-23c40d78b454",
  "replacementPersonId": "ed2987c4-cb03-467b-968e-86a3370b9fb3",
  "microphoneDisposition": "keep-with-role",
  "reason": "mid-show understudy takeover"
}
```

IDs are opaque stable identifiers; human labels and cue numbers are never used
as foreign keys.

## Collaboration API

Tasks, incidents and chat are distinct resources. A message may link to a task
or incident but reactions and read receipts never mutate operational state.
Claim, handoff, completion and resolution use idempotent commands with expected
resource revisions so two operators cannot silently take the same work.

The backend assigns the durable order within each conversation. A send includes
a client message/idempotency ID and effective identity/overlay reference. The
server stores contextual IDs and the resolved display snapshot at send time so
later cast or microphone swaps do not relabel historical communication.
Corrections create a visible new version; privileged removal creates an audited
tombstone rather than silently rewriting the thread.

Text and bounded structured quick messages are inline. Images and short voice
notes use the safe upload-intent/finalize pipeline, with configured byte,
duration and media limits. They are decoded or transcoded outside privileged
services, stripped of unnecessary metadata, access controlled and retained by
production policy. Speech-to-text, if enabled, must work within the local
deployment profile and cannot create a public-cloud dependency for show use.

Priority pages require a separate scope, named recipient or operational role,
reason, rate limit and explicit acknowledgement. Presence and typing indicators
are expiring advisory state and must never imply that a person saw, heard,
claimed or resolved anything.

Allowed lifecycles, durable acceptance, sequence domains, object-level policy,
page recipient states, retention, browser caching and initial hard limits are
normative in the
[collaboration contract](../architecture/collaboration-contract.md). Broad
scopes never grant access to an arbitrary object ID or linked attachment.

## Cue API

Cue definitions with absolute expected-state snapshots belong to an immutable
activated revision. Runtime cue occurrences belong to a performance and carry
a unique occurrence ID, monotonic sequence, authority quality, activation time,
origin and skipped/backtracked/resync action.

API clients can:

- read ordered cue definitions and absolute expected-state snapshots;
- subscribe to current cue and derived On Stage/Up Next/expected-silent state;
- select one authority mode: mapped external observer, named manual coarse-scene
  tracker, or no cue authority;
- advance/select in manual mode, explicitly rebase a stale external cursor, or
  transfer authority to/from a named manual tracker with scoped permission,
  expected revision and idempotency key; and
- map stable external workspace/cue IDs without using labels as keys.

Concurrent cue commands use the current runtime sequence and authority epoch as
preconditions. The node returns the authoritative occurrence after every
command. QLab 5 read-only OSC show-control broadcast is the first reference
external observer. GO, start, audition, playhead and reset remain distinct. A
stale/unknown observer unarms cue-derived automation until an explicit resync.
Late events from the fenced adapter generation cannot advance state. See
[ADR 0005](../decisions/0005-cue-authority-and-occurrences.md) and the
[cue authority automaton](../architecture/cue-and-operator-state-machines.md).

## Attachment API

Image and voice-note ingestion is a three-step workflow:

1. create an upload intent declaring purpose, owner, bytes, media type, pixel
   dimensions if known, content hash and retention class;
2. upload to a bounded temporary endpoint using a one-time token; and
3. finalize after a quarantined worker performs decode, validation, metadata
   stripping, re-encoding/transcoding and safe rendition generation.

Finalization returns a ready attachment/image-asset version and rendition URLs
requiring object-level authorization. A message can reference only ready
versions. URLs are short-lived or authenticated, never public guessable paths.
Pending/rejected/orphan cleanup, quotas, retention inheritance, transcript
versions and deletion follow the collaboration contract. Deleting a person's
primary image removes the relationship immediately; blob deletion follows
retention/evidence rules and is audited.

## Subscription API

A versioned WebSocket subscription supplies initial snapshots then sequenced
deltas for:

- active performance, cast and microphone assignments;
- current cue and derived role/source expectations;
- normalized audio/RF/battery/receiver state;
- checks, incidents, notes and swap transaction results;
- tasks, conversations, messages, reactions, pages and advisory presence;
- compatibility, freshness and component health; and
- image relationship changes, but not image binary data.

Clients declare topics and optional performance/source filters. Durable
performance events, per-conversation messages and node-runtime events have
separate cursors/sequences. High-rate meters, typing and presence are ephemeral,
lossy/coalescible and use separate backpressure rules. Every durable snapshot
contains its exact resume cursor; expired/gapped cursors require a resnapshot.

Initial durable event names include:

- `performance.cast-assignment.changed`;
- `performance.microphone-assignment.changed`;
- `performance.audio-path.changed`;
- `performance.cue.changed`;
- `performance.check.recorded`;
- `incident.lifecycle.changed`;
- `task.lifecycle.changed`;
- `chat.message.created` and `chat.message.corrected`;
- `chat.reaction.changed` and `chat.page-recipient.changed`; and
- `image.asset.ready` or `image.asset.deleted`.

Ephemeral event names include `operator.presence.changed`, typing and meter
updates; they are not part of a durable resume stream.

Every durable envelope carries its own stream/sequence, event ID, actor,
causation and schema version. Assignment changes additionally carry effective
interval, prior/current assignment IDs, transaction ID, overlay revision and
replay mapping. Consumers resolve historical identity from event time rather
than today's assignment snapshot.

## Authentication and authorization

- Human clients use local authenticated sessions.
- Integrations use named service accounts, not shared user passwords.
- API credentials are displayed once, stored hashed where possible, scoped,
  expiring/rotatable and revocable.
- Scopes distinguish read inventory, edit drafts, manage images, activate show,
  control cues, perform emergency swaps, operate listen/replay, manage personal
  workspaces, read/send/direct/page chat, manage tasks/incidents and export data.
- Every show-time mutation and sensitive image access is audited.
- Cross-origin access is denied by default and explicitly allowlisted for a
  local integration profile.
- Every object ID is authorized against performance/conversation membership,
  owning relationship and action; a scope or context link alone is insufficient.
- Revocation closes affected subscriptions and invalidates attachment URLs.

Rate and concurrency limits apply per identity, route and node. A service
account cannot reach vendor receiver APIs or raw device credentials.

## Errors and compatibility

Errors have stable machine codes, human-safe explanation, correlation ID,
retryability and current revision where relevant. Expected conflicts return a
diff rather than a generic server error. Batch commands are atomic within one
performance transaction or explicitly report that they are preview-only.

The API follows the shared protocol's major/minor compatibility, bounds,
idempotency and schema rules. Deprecations publish replacement, telemetry of
remaining use and removal version; theatre show control cannot change semantics
inside a supported release line.

## Offline node API boundary

The browser never receives a general node management API. During a backend
outage, the activated Live session can send only commands encoded in its signed
lease and activated emergency pool. The node commits canonical runtime mutations
to its durable control/result ledger and rejects arbitrary IDs, image operations,
draft edits, policy changes, or inventory creation.

Chat, presence, read cursors and ordinary task coordination are backend-owned
and unavailable during a backend outage. The UI keeps drafts locally only as
clearly unsent drafts and never presents them as delivered. The node may record
lease-authorized evidence markers, verification and emergency-assignment events
needed for safe reconciliation; it cannot mutate task/incident lifecycle and is
not a second chat server.

## Export and portability

An authorized show export may include selected image variants and their
consent/retention metadata, but never receiver credentials, private originals
excluded by policy, or cached browser blobs. The manifest declares every file,
size, media type and checksum and warns that cast/headshot data is sensitive.

## Test requirements

- generated schema/implementation conformance and negative authorization tests;
- idempotent retry after timeout and duplicated delivery;
- stale revisions, simultaneous swaps, cue races and expired preparations;
- backend failure between preview and commit;
- offline permitted/forbidden command matrix and reconciliation conflicts;
- event resume, sequence gap and meter backpressure;
- conversation ordering, idempotent send, reconnect/duplicate delivery, read
  cursors, corrections, page rate limits and advisory presence expiry;
- simultaneous task/incident claims and proof that reactions cannot change
  operational lifecycle;
- image byte/pixel bombs, malformed formats, EXIF/GPS stripping, access and
  deletion, plus equivalent voice-note validation and duration bounds; and
- performance at full cast, cue, image and channel reference sizes.
