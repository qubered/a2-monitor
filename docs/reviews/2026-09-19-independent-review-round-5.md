# Independent plan review: round 5 closure verification

**Status:** Exit criterion not met; bounded contract closure required

**Reviewed:** 2026-09-19

**Baseline:** commit `7c64bb4e3cb75817ba64fab8c4d3b6163925d1e8`

This review used only the committed repository as the reviewed artifact. It
tested the Round 4 closure claims against schemas, fixtures, verifier behavior,
transition catalogues and normative prose. Repository checks pass, but that is
not yet equivalent to a safe promotion or interoperable runtime contract.

## Verdict

| Stage | Round 5 decision |
| --- | --- |
| Phase 0A disposable capture implementation | **GO.** The remaining findings do not prevent instrumented, non-promoting capture work. |
| Phase 0A evidence promotion | **NO-GO.** Promotion does not enforce the required OS/profile matrix or artifact contents. |
| Phase 0B isolated experiments | **GO after relevant non-promoting 0A measurements.** |
| Phase 0B integrated/formal gate | **NO-GO.** Bootstrap/control authority, lease vectors, boot-grant lifecycle and security evidence remain under-specified or unenforced. |
| Phase 1A slices/operator reliance | **NO-GO.** Event/recovery reconstruction and slice-level operator promotion remain under-constrained. |
| General architecture-review exit | **NOT YET.** Five P0 contract findings remain. |

The architecture direction is stable: single selected audio device, one node
runtime sequencer, foreground Live, component-level physical truth, power-fenced
takeover, conventional communications fallback and staged theatre-first delivery
remain sound. The failures below are bounded contract defects, not a reason to
restart product discovery.

## P0 closure findings

### 1. Evidence promotion still permits an incomplete phase

`verifyPromotion` checks only that each required test ID appears in a passing
run. It does not examine OS, device/profile tuple, build or required matrix
coverage. A synthetic set containing only macOS runs closes Phase 0A even though
the roadmap and validation matrix require both Windows and macOS. The Phase 0B
catalogue also has no mandatory confinement/IPC, PKI rotation/revocation,
canonical/media-channel isolation or minimum reconciliation test despite making
those part of its formal exit.

The verifier compares declared artifact kinds/hashes but never resolves
`store_key`, reads bytes, checks length or recomputes the SHA-256. The checked-in
passing fixture deliberately contains placeholder hashes and nonexistent stores,
yet passes. The statement that CI independently verifies content hashes is
therefore false.

Required closure:

- make promotion consume signed run records with an exact required tuple matrix,
  including both supported OS families and every named profile;
- add the missing Phase 0B security, channel-isolation and reconciliation tests
  to the closed catalogue; and
- give the verifier an artifact resolver that checks stored bytes, size and hash,
  with missing/tampered-artifact negative tests.

Evidence: [`evidence-verifier.mjs`](../../tools/evidence-verifier.mjs),
[`evidence-tests.v0.json`](../../tests/catalog/evidence-tests.v0.json), and the
[replacement passing metrics fixture](../../tests/fixtures/evidence/phase0a-nominal.metrics.valid.json).

### 2. The canonical command schema conflates bootstrap and Live authority

The only canonical command envelope always requires a Live `lease_id`, channel
ID/counter and ACK head, while its body also admits `PrepareActivation` and
`CommitActivation`. Activation occurs before a Live lease and before node runtime
authority exists. The prose separately assigns activation to a backend
coordinator, but no backend/bootstrap command envelope exists.

The body schemas group many commands under shared optional fields rather than
encoding their guards. Executable counterexamples currently accepted include:

- `CommitActivation` without a prepared token, immutable revision or hardware
  manifest;
- `RecoverPerformance` targeting `planned` instead of the recorded prior
  operational state; and
- `AdvanceCue` carrying only a `PhysicalAssignment` expected revision.

Required closure: separate authenticated backend/bootstrap and leased Live
routes while converging on one node result ledger; define a discriminated schema
per command, exact authority/aggregate/revision set and state-specific payload;
then add a negative vector for every forbidden transition/aggregate combination.

Evidence: [`runtime-command.schema.json`](../../packages/protocol/schema/v0/runtime-command.schema.json),
[`runtime-command-body.schema.json`](../../packages/protocol/schema/v0/commands/runtime-command-body.schema.json),
and the [runtime command contract](../architecture/runtime-command-contract.md).

### 3. Activation and boot-grant issuance are circular and replay handling is incomplete

ADR 0008 says the boot grant is delivered after activation, while the
performance automaton requires that grant to commit activation and says the
commit records it. The schema supplies an issue time plus relative validity but
does not define the one-time node monotonic anchor. Re-accepting a still-signed
same-boot grant after authority loss could reset its local lifetime unless the
node durably remembers grant generation/consumption, which conflicts with the
simple “grant is never persisted” wording.

Required closure: define an activation authorization distinct from the
post-commit runtime grant, or an atomic challenge/issue/commit protocol; bind the
grant to a monotonically increasing grant generation and one node-recorded
deadline that replay cannot extend; specify revocation/loss state; and test
same-boot replay after expiry, authority loss, sleep and failed activation.

Evidence: [ADR 0008](../decisions/0008-safe-authority-takeover.md), the
[performance lifecycle](../architecture/performance-lifecycle.md), and
[`boot-authority-grant.schema.json`](../../packages/protocol/schema/v0/boot-authority-grant.schema.json).

### 4. Canonical events and ledger chunks do not yet preserve executable truth

The event schema closes the event-type enum but leaves `prior_state`,
`current_state` and `payload` as arbitrary objects. A `ComponentInstalled` event
with empty states/payload and a false payload hash validates. The chunk schema
likewise accepts arbitrary event objects and does not represent each event hash
or inclusion order even though the reconciliation contract requires both.
Compaction-marker and quarantined-tail-decision contracts remain absent, and the
migration manifest is unsigned.

Required closure: discriminated event variants with exact prior/current/payload
shapes; semantic hash/chain verification; a chunk entry binding order, event
bytes and event hash; signed compaction, quarantine and migration decisions; and
valid/invalid rebuild vectors proving historical identity survives replay.

Evidence: [`runtime-event.schema.json`](../../packages/protocol/schema/v0/runtime-event.schema.json),
[`ledger-chunk.schema.json`](../../packages/protocol/schema/v0/ledger-chunk.schema.json),
and [ledger reconciliation](../architecture/ledger-reconciliation.md).

### 5. Phase 1 operator evidence verifies a run, not a slice promotion

The operator catalogue has two required 1A.2 tests but no slice requirements or
promotion verifier, so nothing requires both to pass. The schema requires two
participants but not an A1 and A2, permits any experience mix, and lets each run
choose thresholds as weak as 120 seconds for a swap despite the roadmap's
10–20-second drill. It records only a repetition count, not per-repetition
completion/abort and fault allocation. Operator artifacts are also not content-
verified.

Required closure: add exact `1A.1`/`1A.2`/`1A.3` promotion sets; require the
named A1/A2/observer roles and declared experience cohorts; freeze numeric
thresholds in the catalogue; model every repetition and abort as a result; and
reuse verified artifact resolution. Include a negative test proving the
operator drill alone cannot close 1A.2 without the alert qualification.

Evidence: [`operator-tests.v0.json`](../../tests/catalog/operator-tests.v0.json),
[`phase1-operator-run.schema.json`](../../tests/manifests/phase1-operator-run.schema.json),
and the [operator evidence contract](../quality/phase1-operator-evidence-contract.md).

## P1 contract and governance findings

These do not require a new architecture decision, but each needs an owner and
the named closure gate:

| Finding | Owner role | Closure gate |
| --- | --- | --- |
| ADR 0009 promises lease, handshake, result and query golden vectors; only command/result fixtures exist, and the lease has no protected-header/wire schema | Security/platform | Before Phase 0B canonical mutation |
| Transition CI checks only that three schema enums are subsets of the catalogue; it does not derive prose or cover backend Task/Incident/Handoff commands | Protocol owner | Before Phase 1A.1 implementation |
| Runtime prose calls `FailChange`/`AbandonChange`; schemas/catalogue use `FailPhysicalChange`/`AbandonPhysicalChange` | Protocol owner | Next contract correction |
| One client-profile sentence still says `show-ready` after the state was renamed `transport-ready` | Frontend/QA | Next documentation correction |
| A waiver schema exists but no verifier checks authority, expiry or promotion scope; current safe behavior rejects every waiver | Release/security | Before any waiver can be used |
| Runnable verifier code is present, but dependency/license/secret/SAST/SBOM jobs promised by governance are not yet in CI | Release engineering | Before audio runtime code merges |
| JCS is implemented locally and tested against self-generated vectors only; add RFC/cross-runtime conformance vectors, including Unicode edge cases | Protocol/security | Before Phase 0B signing interoperability |

## Review-loop decision

Do **not** schedule a broad Round 6. Create one bounded “Round 5 closure” change
covering the five P0 acceptance lists and the P1 table. Its verification is
mechanical:

1. all new negative vectors fail for the intended reason;
2. Windows-only or macOS-only evidence cannot promote 0A;
3. missing/tampered artifacts cannot verify;
4. bootstrap and Live commands each have one unambiguous authority path;
5. invalid command/aggregate/state combinations and empty canonical events fail;
6. boot-grant replay cannot extend or restore authority; and
7. no Phase 1A slice promotes without every required operator/alert/recovery run.

When those checks pass and each P1 row is closed or linked to its named phase
gate, the architecture loop closes without another general review. Subsequent
reviews are the evidence milestones already defined in repository governance.
