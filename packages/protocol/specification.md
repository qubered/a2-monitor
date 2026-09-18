# Protocol v0 specification

**Status:** Proposed; must be frozen before production component work

## Scope

These rules apply to node/backend control, normalized telemetry, Live node
control, show activation, and import/export envelopes. Transport encoding can
be selected later, but it may not weaken these semantics.

## Version negotiation

Every connection starts with component identity, build, supported protocol
major/minor range, feature flags, hard message limits, and active schema IDs.
Peers reject incompatible major versions with a useful error. A release must
support its documented current and previous deployment pair so node/backend
rollback is possible. Additive unknown fields are retained or ignored safely;
unknown required features fail closed.

Unknown enum values are preserved as opaque values by storage/forwarding layers
and surfaced as unsupported by semantic consumers; they never fall through to a
default command/state. Immutable raw durable events retain original bytes plus
schema identity. Projection upcasters and snapshot migrations are versioned and
covered by current/previous-pair fixtures; down-conversion is allowed only when
the sender can prove no required meaning is lost.

## Envelope and bounds

Every message includes:

- protocol version and message type;
- sender/node/session ID;
- correlation and causation IDs;
- monotonically increasing connection sequence;
- UTC and monotonic/source-time metadata where applicable;
- payload schema version; and
- payload length and integrity protection from the transport.

Implementations set explicit limits for message bytes, nesting, strings,
collections, snapshots, outstanding requests, queues, and processing time.
Control messages default to 256 KiB maximum and state snapshots to 8 MiB until
benchmarks justify smaller bounds. Oversized or invalid input is rejected
before allocation proportional to the claimed size.

## State synchronization

A node connection publishes one coherent snapshot with a snapshot ID and final
sequence, followed by ordered deltas referencing that snapshot. Meter updates
may be coalesced or dropped; identity, warnings, control acknowledgements, and
durable events may not. A detected gap causes bounded resynchronization rather
than speculative application of later deltas.

Snapshots expose intended and observed state separately. Stale state carries
the last observation time and reason; it cannot become healthy merely because
a connection reopened.

## Commands and idempotency

Every mutating request includes a namespaced idempotency key, actor/lease
identity, aggregate type/ID, aggregate-specific expected revision/sequence,
deadline, payload hash and required permission. Repeating the same key and hash
returns the recorded result; another payload is an error. Conflicting revisions
fail without partial application. Timeouts report unknown outcome until queried
from the authoritative result ledger.

## Show activation

Activation is prepare/commit:

1. backend sends immutable revision, checksums, required capabilities, expected
   hardware identity, and previous revision;
2. node validates resources and observed hardware, then returns a signed
   prepared result and complete diff;
3. authorized operator commits that exact prepared result;
4. node atomically swaps bounded runtime configuration at a safe block boundary
   and records the result; and
5. backend reconciles the resulting active revision.

Preparation expiry, node restart, identity change, or capability loss cancels
the prepared result. Version one does not promise atomic multi-node activation.

## Live node lease

The backend issues a signed lease containing node, user, show revision, session,
allowed commands, authority epoch, expiry, nonce, and proof-of-possession
client/media binding. The node validates it locally and enforces per-command
bounds and rate limits. Expiry/anti-replay behavior survives node restart and
rejects clock rollback. Leases cannot edit
the immutable show revision, credentials, users, policy, cue definitions or
receiver configuration. A separately scoped emergency capability may apply a
runtime cast/microphone assignment overlay, advance/select a cue and record
verification/evidence-marker events, but only using people, alternatives, assets,
spares, cues and rules already approved in the activated performance pool.

Runtime assignment commands use preview/commit, matching authority epoch,
expected overlay revision, idempotency key and a complete identity/physical-
verification diff. The active node is the sole runtime sequencer in healthy and
partitioned operation. Its non-evicting control/result ledger is separate from
bounded telemetry/replay journals and survives until verified reconciliation.
When remaining durable capacity reaches the reserve threshold, further offline
mutations fail closed while monitoring continues. Arbitrary IDs, inventory
creation and task/incident lifecycle mutation fail.

## Event delivery

Durable events have globally unique IDs, stream identity/sequence, capture
epoch/time mapping where relevant, severity, and schema version. Delivery is at
least once; consumers are idempotent. A snapshot carries the exact resume cursor
at which it was taken. An expired cursor or detected gap requires a typed full
resnapshot rather than speculative continuation.

Node telemetry/replay observations use a bounded journal and may report a gap.
Canonical cast, microphone, path and cue events use the non-evicting active-
performance control ledger and additionally carry authority epoch, aggregate
revision/runtime sequence, bitemporal effective/recorded time, prior/current
state, command/transaction ID and actor. Historical consumers resolve identity
at event/media time rather than joining against the current assignment.

Conversation messages are durable backend events ordered by a per-conversation
server sequence and deduplicated by client message ID. They carry contextual
IDs plus the effective identity display snapshot. Reactions, read cursors,
presence and typing state never stand in for task or incident lifecycle events.
Presence may be lossy and expiring; messages, corrections, tombstones and
priority-page recipient changes are resumable on their own backend streams.

The audio node journal is not a chat replica. During backend loss it retains
only lease-authorized evidence markers, verification, cue and activated-pool
assignment changes. Chat clients must label drafts as unsent until the backend
durably accepts them.

## Import and export

Show packages contain a manifest, schema version, declared sizes, checksums,
and no credentials. Import occurs in an isolated temporary area with byte,
entry, path, image, and decompression limits. Validation and migration complete
before any current show state changes. Failed imports leave no partial state.

## Security

Node/backend transport uses mutual authentication. Browser/backend and
browser/node paths use secure contexts and scoped authorization. Raw vendor
messages, receiver secrets, private keys, and privileged diagnostics are never
part of the shared domain protocol.
