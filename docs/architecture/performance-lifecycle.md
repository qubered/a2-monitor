# Performance, activation, and show-lock lifecycle

**Status:** Normative design baseline for protocol v0

Activation and performance state are separate aggregates. Activation proves a
revision and hardware manifest are installed on one node. Performance state says
whether operators may preflight, run or close one dated occurrence.

## Authority transfer

The backend owns a performance while it is `planned`. `PrepareActivation`
creates a node-side candidate without transferring runtime authority.
`CommitActivation` atomically records the activation, authority epoch and
boot-scoped authority grant, then transfers the performance aggregate to that
node in `activated`. From that point through terminal closure, only the node
sequences performance, cue, mic-check, overlay and physical-assignment commands.
The backend forwards or reconciles them; it does not write a competing state.

An activation candidate may be rolled back before commit. After commit, changing
node requires the takeover procedure and a new activation/epoch; it is never an
activation rollback.

## State machine

| From | Command | To | Required guard |
| --- | --- | --- | --- |
| `planned` | `PrepareActivation` | `configuring` | immutable revision, hardware manifest, backend authority |
| `configuring` | `CommitActivation` | `activated` | exact unexpired prepare token, boot authority grant, durable commit |
| `configuring` | `RollbackActivation` | `planned` | candidate has not committed |
| `planned`, `configuring` | `CancelPerformance` | `cancelled` | reason and backend authority |
| `activated` | `EnterPreflight` | `preflight` | required clients/fallback may still be incomplete but are visible |
| `preflight` | `MarkPerformanceReady` | `ready` | mandatory preflight policy and printed fallback satisfied |
| `ready` | `StartPerformance` | `active` | named show caller/operator confirmation; show lock engages |
| `active` | `EnterInterval` | `interval` | cue/actor and reason recorded; show lock remains engaged |
| `interval` | `ResumePerformance` | `active` | interval rechecks and cue rebase policy satisfied |
| `active`, `interval` | `BeginPerformanceClose` | `closing` | no physical transaction still changing components |
| `closing` | `CompletePerformance` | `completed` | leases closed, final chunk sealed/imported and backup barrier satisfied |
| any node-owned nonterminal | `EnterPerformanceRecovery` | `recovery-required` | crash, ledger, authority, timebase or hardware ambiguity |
| `recovery-required` | `RecoverPerformance` | recorded prior operational state | backend reconciliation, physical verification and named authorization |
| `activated`, `preflight`, `ready`, `active`, `interval`, `recovery-required` | `AbortPerformance` | `aborted` | reason, conventional fallback and open-work disposition |

Terminal states are `cancelled`, `completed` and `aborted`. Reopening creates a
new performance; it never mutates the terminal history.

## State capabilities

| Capability | Earliest state | Additional rule |
| --- | --- | --- |
| Manager configuration edits | `planned` | activated revision remains immutable |
| Node configuration validation | `configuring` | no Live lease or operator mutation |
| Mic-check sessions | `preflight` | allowed in `ready` and policy-selected `interval`; not only `active` |
| Prepared spares and component checks | `preflight` | validity tuple and expiry enforced |
| Live listening/replay | `preflight` | transport-ready client and safe output preflight required |
| Cue observer shadowing | `preflight` | cannot arm production behavior until qualified |
| Cue authority and show-time overlay mutation | `active` | interval behavior is policy-specific and visible |
| Direct backend-outage canonical control | `preflight` | existing boot-bound lease only; state permissions still apply |
| Performance close/pruning | `closing` | pruning separately requires verified import and backup permit |

## Show lock and restart

Show lock engages at `StartPerformance` and remains through interval, recovery and
closing. It blocks show-definition, identity-pool, rule and route-plan edits;
only activated-pool runtime commands are allowed. Emergency override is not a
generic unlock: it is a named scoped command with reason, second authorization
where policy requires and a canonical event.

A node process restart loses its in-memory boot authority grant and all direct
leases. It reloads the last durable state read-only as `recovery-required`, then
requires backend epoch/ledger reconciliation and physical verification before
`RecoverPerformance`. It cannot infer `active` merely from the clock or audio.

