# Collaboration state, authorization, and durability contract

**Status:** Proposed release contract

This contract covers tasks, incidents, conversations, messages, pages,
attachments, presence and handoff. The management backend is their only writer
and sequencer. None of these resources is silently reconstructed from the audio
node after an outage.

## Simple operator language

Live offers two primary creation actions:

- **Request check** creates a task. Examples: listen, check placement, inspect
  pack, change battery, prepare spare.
- **Report fault** creates an incident with observed impact. Investigation may
  create one or more child tasks.

Lifecycle buttons can atomically change state and append a system message.
Predefined phrases such as “Ready for A1 check” remain communication only.
There is no chat-only “Resolved” quick phrase.

## Task state machine

| From | Command | To | Required data |
| --- | --- | --- | --- |
| — | `create-task` | `open` | type, subject, requester, priority, optional due occurrence/time |
| `open`, `blocked` | `claim-task` | `claimed` | assignee, expected task revision |
| `claimed` | `block-task` | `blocked` | reason, next action/owner |
| `blocked` | `unblock-task` | `open` or `claimed` | reason, optional assignee |
| `open`, `claimed`, `blocked` | `complete-task` | `done` | completion evidence, actor |
| any nonterminal | `cancel-task` | `cancelled` | reason, actor |
| `done`, `cancelled` | `reopen-task` | `open` | reason, permission |

Reassignment is explicit and audited. Exclusive claims use the task revision;
parallel work is represented as child tasks rather than two silent assignees.
Promoting a failed task to an incident is one transaction that retains the task
and links both records.

## Incident state and coordination

Incident lifecycle is `open`, `investigating`, `mitigated`, `resolved`,
`deferred`, or `false-positive`. “New/seen” is a separate per-user receipt and
claim is a separate coordinator relationship.

| From | Command | To | Required data |
| --- | --- | --- | --- |
| — | `report-fault` | `open` | observed fact/impact, subject, reporter |
| any nonterminal | `claim-incident` | unchanged | coordinator, expected revision |
| `open`, `deferred` | `start-investigation` | `investigating` | coordinator or reason |
| `open`, `investigating`, `deferred` | `mark-mitigated` | `mitigated` | action, evidence, residual risk/next action |
| `open`, `investigating`, `mitigated`, `deferred` | `resolve-incident` | `resolved` | action, evidence, confidence, A1 confirmation or explanation |
| `open`, `investigating`, `mitigated` | `defer-incident` | `deferred` | reason, owner, due occurrence/time |
| `open`, `investigating` | `mark-false-positive` | `false-positive` | evidence and confidence |
| any terminal state | `reopen-incident` | `open` | reason and permission |

`mitigated` is optional, not a mandatory route to resolution. One incident
coordinator owns the operational summary while several task assignees may work
in parallel. `mark-incident-seen`, `acknowledge-page`, `acknowledge-alert`,
`advance-read-cursor` and `confirm-impact` are distinct commands/receipts.

## Revisions and ordering domains

Tokens are never interchangeable:

- immutable show revision;
- active-performance authority epoch;
- performance-overlay revision;
- cue-runtime sequence/occurrence ID;
- task revision;
- incident revision;
- durable performance-event cursor;
- per-conversation message sequence; and
- message content version.

Idempotency records are namespaced by actor and command family, store the
request payload hash and durable result, reject a mismatched payload, and live
longer than the maximum retry/offline window.

Database/API invariants enforce one operations conversation per performance,
at most one incident thread per incident, one active role assignment per valid
interval, asset exclusivity, one active primary path unless explicit redundancy
exists, and at most one direct conversation for an exact participant set within
its performance/policy domain.

Subscriptions use separate streams:

1. durable performance events with a performance cursor;
2. per-conversation messages with a conversation sequence;
3. node-origin runtime control events with authority epoch/origin sequence; and
4. ephemeral/coalescible meters, presence and typing.

Every durable snapshot declares its exact resume cursor. Cursor expiry returns a
typed `resnapshot-required` response. A gap never applies later deltas
speculatively. Message/event pagination is keyset-based over immutable sequence,
not arbitrary offset sorting.

A read cursor only advances to a higher accepted conversation sequence. A
reaction is an idempotent `(message, user, reaction-kind)` set/remove operation
and converges from its sequenced server event; duplicate delivery cannot change
the set twice. Corrections receive monotonic message versions without changing
the message's original position. Replies target the logical message and retain
the version that was visible when the reply was authored.

## Durable acceptance and recovery

`accepted` means the authoritative database transaction containing content,
idempotency record and outbox/event record is durably committed. Only then may
the client display Sent. Delivery/fan-out happens afterward and may be retried.
Tasks, incidents, messages, page recipient snapshots/acknowledgements and ready
attachment metadata have RPO 0 for acknowledged commits within the validated
storage profile.

An attachment is not ready until its content and ready metadata are both
durable. Message creation can reference only ready attachment versions. Asset
loss after ready is a service fault shown explicitly; it does not silently
remove the message.

Recovery prioritizes node control-ledger reconciliation before ordinary chat
replay. Process restart, database unavailable/corrupt, metadata disk full,
asset store unavailable/full, migration failure and worker overload are
separate failure classes with separate runbooks.

## Object-level authorization

A broad scope is necessary but never sufficient. Every request and subscription
evaluates all applicable object relationships.

| Object/action | Required relationship in addition to scope |
| --- | --- |
| Performance read | active membership in production/performance or explicit support grant |
| Operations conversation | performance membership and conversation policy |
| Incident thread | performance membership plus incident visibility policy |
| Direct conversation | exact participant membership; administrators need an audited support grant |
| Message send/read/search | conversation membership and current performance access |
| Context link | independent access to both message and linked object; the link grants nothing |
| Attachment upload/read | performance/conversation membership, owning relationship and rendition policy |
| Task/incident mutation | object access, command scope and transition permission |
| Page | performance membership, page scope and recipient policy |
| Export | explicit export scope plus access to every included object |

Role pages snapshot concrete recipients at send time. Membership changes do not
rewrite that history. Revocation closes affected subscriptions, rejects further
resume, rotates/invalidates signed asset URLs and purges application-managed
cache on the client at the next contact. Deny is the default.

## Priority-page states

Each recipient has `accepted`, `dispatched`, `client-received` where provable,
`displayed` where provable, `acknowledged`, `expired`, `cancelled`, or `failed`
state. Backend acceptance is never called delivery. Acknowledgement is
idempotent. Sender sees partial acknowledgement and the reminder to use
intercom/radio for urgent contact. Pages expire; they do not auto-claim work.

Initial safety limits are six pages per minute per sender with a one-per-ten-
second burst and thirty pages per minute per deployment. Limits are tunable
downward per production and must be validated before being raised.

## Retention, evidence, and correction

Evidence selection pins an immutable message content version, identity-snapshot
version, attachment rendition hashes and selector. It does not retain unrelated
conversation content. Attachment/transcript retention follows the strongest
active relationship, subject to an authorized privacy deletion/redaction
workflow. Historical identity snapshots contain IDs and display text/hash
references, never embedded headshot binary or an indefinitely valid URL.

Correction appends a new version. Reply relationships point to the logical
message and show the selected/current version. Removal produces an audited
tombstone. Dedupe/idempotency tombstones outlive content expiry so an old client
ID cannot create a second message after retention cleanup.

## Browser storage

- Messages, voice blobs, placement/detail images and attachment originals use
  memory plus authenticated network fetch; the service worker does not cache
  them.
- Clearly unsent text drafts are memory-only in version one and disappear on
  reload/logout rather than pretending offline durability.
- Approved headshot/grid variants may use an application-managed active-show
  cache namespace, purged on logout, user switch, performance removal or policy
  revocation.
- Session tokens are not stored in URLs or general persistent web storage.
- The dedicated-device profile and full-disk encryption remain necessary;
  browser cache policy is not a substitute for device custody.

## Initial collaboration envelope

These are proposed hard safety limits, not validated capacity claims:

| Resource | Initial limit |
| --- | ---: |
| Concurrent Live users | 8 |
| Open tasks plus incidents per performance | 500 |
| Retained messages per performance | 10,000 |
| Text message bytes | 8 KiB |
| Image upload / decoded pixels | 16 MiB / 40 megapixels |
| Voice note | 30 seconds and 4 MiB |
| Concurrent attachment processing | 4 deployment-wide, 1 per client |
| Ready attachment storage per performance | 2 GiB by default |
| Message sends | 60/min/user, burst 20 |

Crossing a limit rejects or archives lower-priority work; it never allocates
unbounded resources or evicts canonical show-control history. Phase 1B/1C
benchmarks may lower these limits and must justify any increase.
