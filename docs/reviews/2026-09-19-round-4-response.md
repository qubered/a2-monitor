# Round 4 response and closure ledger

**Status:** Implemented; ready for bounded Round 5 verification

The response converts the review's prose gaps into executable contracts where
possible. “Implemented” here means the plan/repository contract is repaired; it
does not claim the future product has passed its phase evidence.

| Finding | Resolution | Gate |
| --- | --- | --- |
| False Phase 0 promotion | Closed phase catalogues/schemas, computed outcome, signed projection, waiver and negative tests | CI + 0A/0B |
| Ambiguous signed command/retry | Exact signed projection, ES256 vector, handshake/result/query schemas, ACK/idempotency/route rules | CI + 0B |
| Canonical model not executable | Closed command bodies, multi-revision envelope, complete event/result envelope and transition catalogue | CI + 1A |
| Takeover not continuously fenced | V1 witnessed power fence plus per-commit, in-memory boot grant; network-only fence removed | 0B |
| False swap truth | Component disconnect/install, no-current/partial path and physical-first recovery | 1A.1/1A.2 |
| Missing performance lifecycle | Activation/performance automaton, node authority and recovery/close guards | CI + 1A.1 |
| Confinement/PKI deferred | ADR 0012 platform process profiles and ADR 0013 purpose-separated offline PKI | 0B security |
| Non-reproducible operator gates | Frozen theatre fixture, manifest/catalogue, repeated blinded faults and zero-tolerance rules | each 1A slice |
| Cue threshold | Three complete shadow runs with zero missed/false/duplicate/fenced-late authority errors | 0B |
| State catalogues disagree | Machine transition catalogue plus schema consistency test; task/incident/handoff/cue gaps closed | CI |
| Lease/channel/time ambiguity | Monotonic deadline, two channels, exact retry/query and route handover | 0B |
| “Show-ready” overclaim | Renamed transport-ready; explicit local listen confirmation | 0B |
| Listening safety absent | Limiter/headroom, reconnect mute/ramp, latch cancellation, acoustic/intercom field-kit gate | 0B/1A |
| Resource/rollback overclaim | Measured storage SLO, split-host trigger, external receipt/head comparison and explicit offline limit | 0B/1A.1 |
| Recovery objects prose-only | Chunk, receipt, permit and migration schemas; minimum reconciliation moved earlier | CI/0B/1A.1 |
| Alert evidence late | Labeled alert qualification before 1A.2 dependency | 1A.2 |
| API/domain mismatch | Explicit camel/kebab to snake/Pascal adapter and UUID rule; removed mutable `show` aggregate | API contract |

Remaining implementation work is intentionally phase-gated: OS enforcement must
be proven on actual Windows/macOS builds, vendor integrations on named hardware,
and human workflows with real operators. Those are not reasons to keep rewriting
the architecture before measurements exist.

Round 5 uses the exit rule in
[repository governance](../quality/repository-governance.md): no P0, every P1
owned/gated, and executable contracts agreeing ends general plan review. Later
reviews occur at evidence milestones or when a test/scope/security change
reopens an assumption.
