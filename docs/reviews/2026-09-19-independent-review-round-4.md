# Independent plan review: round 4

**Status:** Open findings; reviewed plan unchanged

**Reviewed:** 2026-09-19

Three fresh context-free reviewers independently read committed baseline
`6bfdebd`: theatre operations/human factors, distributed systems/real-time
security, and API/protocol/data/release governance. They were explicitly barred
from `docs/reviews/**`, did not consult one another, and made no edits. The
maintainer then verified cited contradictions and fixture hashes. Repository
hygiene passed, but the check currently proves only Markdown links and JSON
syntax—not JSON Schema semantics or cryptographic vectors.

## Consolidated verdict

| Stage | Round 4 decision |
| --- | --- |
| Phase 0A engineering | **GO for disposable implementation and non-promoting measurements.** |
| Phase 0A evidence exit | **NO-GO.** The manifest/result schemas can certify a run that violates the normative prose. |
| Phase 0B isolated experiments | **GO only as non-promoting spikes after relevant capture evidence.** |
| Phase 0B integrated/formal gate | **NO-GO.** Signed command bytes, continuous fencing, platform confinement, PKI and cue/output gates are incomplete. |
| Phase 1A.1 | **NO-GO.** Physical swap truth, performance lifecycle, executable canonical contracts and minimum reconciliation are unresolved. |
| Phase 1A.2 | **NO-GO.** Cue promotion, alerts, task/incident/handoff transitions and their recovery dependencies are incomplete. |
| Phase 1A.3 | **NO-GO.** Reconciliation/migration/restore objects and operator evidence gates are not executable contracts. |
| Supervised rehearsal | **NO-GO.** Bench, tabletop and paper-log studies are appropriate; operator reliance is not. |

The previous response materially improved the architecture, but several items
marked specified are prose decisions whose machine contracts do not yet enforce
the same invariants.

## P0 blockers

### The Phase 0 schemas can produce a false promotion

The [Phase 0 evidence contract](../quality/phase0-evidence-contract.md) requires
exact tuples, three 12-hour 0A trials, prescribed 0B profiles/faults, numeric
assertions and content-addressed evidence. The input schema instead permits one
60-second trial, empty client/fault arrays and arbitrary untyped hardware,
network, limits, load and metric names
([input schema](../../tests/manifests/phase0-evidence.schema.json), lines 30–68
and 81–92). The result schema permits `outcome: pass` with failed/not-run
assertions, no artifacts and arbitrary deviations
([result schema](../../tests/manifests/phase0-result.schema.json), lines 20–48).
It does not define the signature projection, so its own signed hash may be
circular or runner-specific.

Required response:

- phase-specific closed test/metric/fault/artifact catalogues and conditional
  minimum duration/trial/client requirements;
- a manifest/result bijection and rule that promotion passes only when every
  required assertion and artifact passes;
- exact JCS signing projection, waiver schema and promotion authority; and
- CI metaschema, valid/invalid fixture, signature and promotion-verifier tests.

Phase 0A coding may begin, but no result can close the phase through the current
evidence verifier.

### Canonical signed-command and retry bytes are not uniquely implementable

[ADR 0009](../decisions/0009-live-control-lease-and-data-channel.md) says the
client signs
`{lease_id,node_boot_id,channel_id,channel_counter,previous_ack_hash,command}`.
The [command schema](../../packages/protocol/schema/v0/runtime-command.schema.json)
is a flat object containing additional authority, idempotency, aggregate,
deadline, payload-hash and signature fields. `command` is undefined: signing the
whole envelope is recursive, while signing only payload leaves safety-critical
envelope fields outside the declared image.

`command_type` and payload are effectively free-form; no handshake, ACK/result,
idempotency-result-query, prepared result or error-envelope schema exists. The
general protocol promises same-key replay returns the stored result, while ADR
0009 accepts only an unused key and tells the caller to use an undefined query.
The checked-in “golden” signature is explicitly a placeholder. Independent hash
verification also found both declared payload hashes wrong:

- runtime-command fixture: declared `aaaa…`, actual
  `2c788db3a7ac066862c2eb3db29f2eeb948ad0912a97f9a2f75f33850320bf40`;
- runtime-event fixture: declared `aaaa…`, actual
  `c0dd2f69130d95e4c1e887e36e791da6b68cf7a9c8a7f3f35c6939c04fca8c59`.

Required before canonical mutation code: freeze a nonrecursive signed projection,
protected JWS headers/key selection and encoding, handshake/channel identity,
initial/ACK-chain hashes, retry/result query and route handover; add real
deterministic crypto vectors and command-specific closed payload schemas.

### Command/event schemas do not encode the canonical safety model

The current command schema has one aggregate and one expected revision, but
`RecordInstalledBoundary`, revert and fallback are atomic assignment-set
transactions with multiple expected/updated revisions. It cannot enforce
command/aggregate compatibility, activated-pool IDs or automaton preconditions.
The runtime-event schema makes capture/effective time optional and omits
prior/current state, transaction identity and causation even though the
[protocol specification](../../packages/protocol/specification.md) requires
those fields to reconstruct cast/mic/path/cue history.

Required: discriminated per-command schemas, multi-aggregate preconditions and
results, complete canonical event variants and negative state-transition
fixtures. Independent runtimes remain blocked until these are frozen.

### Takeover proof is not a continuously held fence

[ADR 0008](../decisions/0008-safe-authority-takeover.md) proves power removal,
switch quarantine or key-path removal at activation time. It does not specify
continued ownership/monitoring of the fence. Its own validation later removes
the quarantine and checks only that the old tail cannot update backend
projections. A still-running old node and old client can resume local commits
when a temporary rule disappears; the newer epoch still cannot reach them.

Required: model fence acquisition, ownership, renewal/loss and release as
durable states; enumerate all network paths; require each allowed mechanism to
remain physically or synchronously enforced; and fail-stop new canonical
mutation immediately on fence uncertainty. Test old local commits—not only
backend import—after fence loss.

### The swap model records false physical truth during removal/install gaps

The [swap automaton](../architecture/temporal-identity-and-swap.md) states that
the old identity remains current throughout `change-in-progress`, then closes
all old intervals and opens all new intervals at one installed boundary. In a
real 10–20 second change, the old element/transmitter may be disconnected or
removed before the replacement is fitted, powered, associated and audible.
There may be a genuine no-current-component/path interval and different
boundaries for element, transmitter, receiver association and captured input.

Required before even the 1A.1 prepared-spare path: component-level disconnect/
remove and connect/install boundaries, an explicit no-current-path state,
separate intended/observed signal-path state, and failure/revert/fallback drills
at every partial boundary. Replay must never attribute a dropout to hardware no
longer physically present.

### Performance/activation lifecycle and mic-check authority are missing

The product names `planned`, `preflight`, `active`, `interval`, `completed` and
`cancelled`, but the runtime contract gives the node mic-check authority only
while a performance is active. It defines `ActivateShow` but no commands/guards
for activation prepare/commit/rollback, entering/leaving preflight, show start,
interval, re-entry, abort/cancel or close. The reconciliation contract refers to
a close command that is not in the command matrix.

Required before 1A.1: a normative performance/activation automaton defining
sequencer, show lock, lease eligibility, cue authority, preflight mic-check,
interval recheck, emergency override, crash recovery and close/prune guards.

### Core node confinement and local PKI remain deferred

The threat model promises unprivileged media/gateway/adapter/replay/supervisor
workers but explicitly defers final sandbox and IPC mechanisms. ADR 0011 covers
only image decoding. Phase 0B nevertheless claims a sandboxed receiver adapter,
unprivileged gateway and no unresolved P0 security blocker.

Likewise, the plan names a deployment CA, enrollment, offline rotation/revocation
and lease signing without freezing CA/lease-key separation, JWS `kid` rollover,
SAN/EKU profiles, node trust-store rollback, offline revocation distribution,
clock-failure behavior, key custody/export fallback or compromise recovery.

Required before the formal 0B security gate: Windows/macOS identities, ACLs,
network capabilities, IPC/shared-memory authentication and ownership, child/
crash containment and privilege transitions for every network-facing node
worker, plus a complete offline PKI/key-lifecycle ADR and adversarial fixtures.

### Phase 1 operator gates are not reproducible evidence

The Phase 1 gates say operators complete or pass drills without freezing fixture
size, cast/channel/cue/track complexity, operator experience/training, repeated
or blinded faults, zero-tolerance events, allowed error budget, observer method,
abort criteria or numeric time/recovery limits. A non-repeatable dress rehearsal
cannot be promotion evidence.

Required before any 1A exit: a signed Phase 1 evidence manifest and named theatre
fixture with operator roles, repetitions, fault scripts, scoring, thresholds,
wrong-source/unsafe-action zero-tolerance criteria and artifact policy.

## P1 architecture and product findings

### Cue observation has no promotion threshold

QLab shadow comparison is a 0B deliverable but not an exit condition. Define
minimum full runs and permitted missed, duplicate, false, late, reset, audition,
panic and reconnect events. A production-specific shadow pass is required before
cue-derived alert arming.

### State-machine command catalogues still disagree

- task `VerifyTask` has no transition, while block/unblock/cancel/reopen are
  absent from the runtime matrix;
- incident resolution can occur without a coordinator;
- handoff has no dispute resolution command, incoming-operator-absent path,
  explicit coverage gap, or transfer of future track/zone responsibility,
  intervention plans and asset custody;
- the cue automaton has disable but no disable command or initial/enable
  transition; and
- fast spare promotion is described as an exceptional direct transition but is
  absent from the allowed-transition table.

Freeze one generated aggregate/command/transition catalogue and derive prose,
schemas and conformance cases from it.

### Route, lease-time and data-channel behavior need exact failure semantics

- define monotonic lease age at authenticated handshake and its relationship to
  UTC `nbf/exp`, clock correction, suspension and reboot;
- define backend/direct-route changeover, duplicate retry and unknown-outcome
  ordering during asymmetric partitions;
- a single reliable ordered channel mixes canonical mutations with scrub/gain/
  listen traffic, allowing head-of-line delay after enqueue; specify strict
  `bufferedAmount` admission/priority or separate canonical and coalescible
  channels and measure the switch target; and
- the decimal `u64` regex accepts values above `2^64-1`.

### “Show-ready” overstates browser observability

Heartbeat and advancing RTP statistics prove page/transport progress, not
audible rendering, physical sink identity, system gain or headphones being worn.
Call this transport-ready unless a qualified native/platform mechanism proves
more. Keep operator output-route/preflight confirmation and interruption state.

Personal listening also needs a normative limiter/headroom, reconnect level,
latched-listen cancellation, acoustic-output limit and intercom/radio coexistence
test for real A1 console-PFL and mobile A2 workflows.

### Resource reservations and rollback detection overclaim guarantees

Per-process disk IOPS/fsync “reservation” on shared consumer storage is normally
a measured supported-profile SLO rather than hard isolation. Either select
separate storage/controllers or state the empirical guarantee and automatic
split-host/feature-disable trigger. Hash chaining detects modification but not
restoring/deleting a valid tail; anchor the ledger head outside the mutable
database or explicitly exclude rollback attackers/failures.

### Compatibility, temporal order and recovery objects remain prose-only

- top-level schemas reject unknown fields while the protocol promises safe
  additive fields and unknown-enum preservation;
- required common envelope/version/correlation/causation fields are not present
  consistently and no current/previous-pair fixtures exist;
- recorded intervals lack one globally comparable cross-epoch coordinate, and
  monotonic fallback boundaries lack boot/timebase identity; and
- chunk, import receipt, prune permit, compaction marker, quarantine decision,
  migration, backup and projection-rebuild objects have no schemas/vectors.

Minimal import/reconciliation must move before any 1A.1 offline identity
mutation and before 1A.2 handoff; its current placement in 1A.3 is a dependency
inversion.

### Alert/listen and phase-scoped testing need earlier gates

1A.2 makes alerts an operator dependency, but false-positive/missed-event
measurement is deferred to Phase 2. Require labeled sensitivity/specificity,
alarm-flood/retrigger and human detection/correct-action timing before 1A.2.
The integration strategy also requires paging, attachments and unsent drafts
that are hidden until 1B/1C. Split executable manifests by capability slice so
deferred features neither block 1A nor get silently waived.

## P2 hardening

- 1A.1 is nominally “identify” and both views show headshots, while managed
  images arrive in 1A.3. Label 1A.1 text-only/nonrepresentative or move the
  qualified safe subset earlier.
- Check-reuse ages are unsupported default claims. Make them show policy derived
  from battery chemistry/mode, placement/costume, zone, show length and safe
  change opportunity; validate them before fast promotion.
- Public API camelCase/ULID-looking IDs/hyphenated commands and shared-protocol
  snake_case/UUID/PascalCase need an explicit translation rule. Remove `shows`
  from API terminology or reconcile it with the normative glossary.
- ADR 0002 remains Proposed while later documents speak as though WebRTC/Opus is
  selected. Keep status conditional until 0B evidence.
- Name go/no-go owner, promotion record, waiver authority/expiry and security/
  theatre veto roles; add CODEOWNERS when code arrives.

## Strengths retained

- Backend remains outside the sample/audio path and the single-device clock
  model is clear.
- One runtime sequencer, durable-before-ACK intent and fail-closed ledger
  capacity remain the right direction.
- Foreground-only browser scope and conventional intercom/monitor fallback are
  honest constraints.
- Bitemporal identity, cue occurrences and component-separated mic inventory are
  strong foundations once partial physical boundaries are added.
- Backup-gated pruning, hostile-media isolation and explicit feature slicing are
  substantial improvements over the prior baseline.

## Next-review entry criteria

A fifth architecture review should wait until at least:

1. phase-specific evidence schemas plus executable promotion verifier;
2. exact signed command/handshake/ACK/result/query/error contracts and real
   vectors;
3. command-specific mutation/event schemas including multi-aggregate revisions;
4. continuously held takeover fence and fence-loss test;
5. component-level physical transition model with no-path intervals;
6. performance/activation lifecycle and preflight/interval/close authority;
7. node worker confinement and offline PKI/key-lifecycle ADRs;
8. generated command/state-machine consistency tests;
9. minimum reconciliation before identity/handoff plus recovery object schemas;
10. cue, alert, output/comms and Phase 1 operator evidence thresholds.
