# Runtime command and ledger contract

**Status:** Normative design baseline for protocol v0

## Authorities and revisions

The activated audio node is the only sequencer for `CueRuntime`,
`PerformanceOverlay`, `PhysicalAssignment` and `MicCheckSession` while a
performance is active. The backend is the only sequencer for `Task`, `Incident`,
`Handoff`, `Conversation` and `Page`. Show definitions remain immutable activated
configuration. Cross-authority operations are sagas with explicit receipts,
never one imagined distributed transaction.

Every revision and sequence is a canonical unsigned decimal string. Every
authority epoch is the fixed-width hexadecimal type from ADR 0008. Commands use
an idempotency namespace of
`{authority}/{aggregate-type}/{aggregate-id}/{actor-session}`; a UUIDv4 key is
unique within it for result-retention lifetime.

## Command matrix

| Command | Authority / aggregate | Preconditions and transaction | Revisions/events | Result retention |
| --- | --- | --- | --- | --- |
| `ActivateShow` | node / `Activation` | prepared token, hardware hash, epoch | activation rev; `ShowActivated` | permanent performance evidence |
| `AdvanceCue`, `BackCue`, `SkipCue`, `HoldCue`, `ResumeCue` | node / `CueRuntime` | expected runtime rev; valid authority mode | runtime rev + sequence; cue occurrence/quality event | through close + reconciled backup |
| `BeginCueRebase`, `CommitCueRebase`, `TransferCueAuthority` | node / `CueRuntime` | named actor, expected rev, target mode/cursor | runtime rev; authority/quality events | through close + reconciled backup |
| `PrepareAssignmentPlan` | node / `PerformanceOverlay` | expected overlay rev, activated-pool assets | no domain rev; expiring prepared result | expiry + 24 h diagnostic |
| `CommitAssignmentIntent` | node / `PerformanceOverlay` | exact prepared hash/epoch/rev | overlay rev; intended-plan event | permanent performance evidence |
| `BeginPhysicalChange` | node / `PhysicalAssignment` | expected assignment rev, reservation | assignment rev; transition event | permanent performance evidence |
| `RecordInstalledBoundary` | node / assignment set | expected revs; exclusivity and temporal transaction | each assignment rev; interval close/open + installed event | permanent performance evidence |
| `RecordVerification`, `RecordA1Receipt` | node / `PhysicalAssignment` | expected rev; evidence actor/time | assignment rev; verification/receipt event | permanent performance evidence |
| `FailChange`, `AbandonChange`, `RevertAssignment`, `PromoteFallback` | node / assignment set | expected revs and explicit physical state | affected revs; compensating events | permanent performance evidence |
| `StartMicCheck`, `AdvanceMicCheck`, `RecordCheckDimension`, `CloseMicCheck` | node / `MicCheckSession` | expected session rev and per-track cursor | session rev; session/evidence event | permanent performance evidence |
| `CreateTask`, `ClaimTask`, `ReleaseTask`, `ReassignTask`, `CompleteTask`, `VerifyTask` | backend / `Task` | expected task rev; permission/assignment rules | task rev; task event + causally linked system message | policy retention, never cache-only |
| `OpenIncident`, `HandoffIncident`, `ReleaseIncident`, `ResolveIncident`, `ReopenIncident` | backend / `Incident` | expected incident rev; coordinator rules | incident rev; incident event + system message | policy/evidence retention |
| `DraftHandoff`, `AttestHandoff`, `AcceptHandoff`, `DisputeHandoff`, `ForceHandoff` | backend / `Handoff` | expected rev; watermark/item decisions | handoff rev; handoff/system-message events | policy/evidence retention |
| `SendMessage`, `CorrectMessage`, `TombstoneMessage` | backend / `Conversation` | conversation authorization and expected policy | conversation sequence; message event | conversation retention |
| `SendPage`, `AcknowledgePage`, `DeclinePage`, `ExpirePage` | backend / `Page` | recipient bounds/status precondition | page rev + per-recipient timestamps | audit retention |
| `SelectListen`, `SetGain`, `SetPan`, `SetDim`, `ScrubReplay` | node media session | live bound session; numeric/media bounds | volatile session sequence only | none after session |

No command may increment the immutable show revision. Multi-assignment interval
closure/opening is one local node transaction, but each assignment receives its
own revision and actual effective boundary. Backend tasks caused by a node event
store that event ID as causation and can be retried independently.

## Persistence classes

| Class | Examples | Storage/ack | Capacity and shedding |
| --- | --- | --- | --- |
| Canonical evidence | cue occurrences, assignment boundaries, checks, activation | non-evicting hash-chained ledger; durable before ACK | reserved bytes/IOPS/latency; reject new mutation at safety floor |
| Bounded session state | idempotency results, channel counters, selections | durable only where retry/recovery requires; explicit TTL | per-session quotas; close abusive session |
| Ephemeral media control | gain/pan/dim, scrub motion, meters | volatile/coalescing; never blocks audio callback | newest-wins/drop under pressure |

Canonical idempotency results live until performance close, verified import,
backup barrier and compaction marker. Session results live for lease lifetime
plus 24 hours, never less than the documented client retry window. Ephemeral
commands cannot carry a domain aggregate or emit a canonical event.

## Stable errors

Protocol v0 freezes these machine codes: `INVALID_ARGUMENT`, `UNAUTHORIZED`,
`FORBIDDEN`, `STALE_REVISION`, `STALE_AUTHORITY`, `LEASE_EXPIRED`,
`LEASE_BOOT_MISMATCH`, `REPLAY_DETECTED`, `IDEMPOTENCY_CONFLICT`,
`PREPARE_EXPIRED`, `PHYSICAL_STATE_CONFLICT`, `CAPACITY_FLOOR`,
`DEPENDENCY_STALE`, `UNSUPPORTED_SCHEMA`, `OUTCOME_UNKNOWN` and
`TAKEOVER_FENCE_REQUIRED`. Human text is diagnostic and not branching logic.
