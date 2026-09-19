# Round 3 review response and closure ledger

**Status:** Design response complete; implementation evidence pending

**Responded:** 2026-09-19

This response does not relabel unbuilt mechanisms as validated. `Specified`
means an implementable normative choice now exists. `Gated` means the choice is
also blocked on a named experiment/evidence contract. Phase 1A remains NO-GO
until the fourth-review entry criteria and applicable evidence pass.

| Finding | Response | State |
| --- | --- | --- |
| Unreachable old-node fencing | ADR 0008 requires externally proven power/network/key-path isolation; no fence means no mutation; stale tail quarantined | Specified + gated |
| Physical identity boundary | Temporal/swap automaton makes `RecordInstalledBoundary` the only atomic interval transition and covers failure/revert/fallback/post-hoc | Specified |
| Cue recovery and QLab ownership | Node-side sandboxed observer plus external-stale/rebase/named-manual-transfer/switch-back automaton | Specified + gated |
| Lease proof/anti-replay | ADR 0009 freezes claims, client key, JCS proof bytes, DTLS/data-channel binding, counters, ACK durability, boot invalidation and partition behavior | Specified + gated |
| Ledger class conflation | Runtime command contract separates canonical, bounded-session and ephemeral media classes | Specified |
| Resource priority/reservations | ADR 0007 corrected; canonical ledger precedes media/replay and has bytes/IOPS/fsync reservation; readers/writer separated | Specified + gated |
| Foreground lifecycle | Server-observed lifecycle, blind interval, route/gain recovery and numeric Phase 0B duration/recovery gates | Specified + gated |
| Browser local trust/origin | Browser uses one backend HTTPS origin; node control uses pinned-DTLS WebRTC data channel; MDM/manual CA ceremony tested offline | Specified + gated |
| Immeasurable Phase 0 | Input/result JSON schemas freeze tuples, loads, faults, integrity oracle, thresholds, hashes and signatures | Specified; manifests due with code |
| Code CI | First-code gate requires pinned Windows/macOS jobs, tests, callback guards, scanners and signed results | Gated with first scaffold |
| Persistence/restore | ADR 0010 selects SQLite WAL/FULL candidate profile, ACK boundary, checksums, scrub, backups, RTO/RPO and power-cut qualification | Specified + gated |
| Media sandbox | ADR 0011 selects Windows LPAC/AppContainer + Job Object and macOS sandboxed XPC with no-network, broker-only handles | Specified + gated |
| Replay reader isolation | Separate writer/read budgets, two-reader Phase 1A admission, bounded prefetch and newest-seek cancellation | Specified + gated |
| Browser drift | Named owner, pinned range, MDM posture, five-day canary requalification and pre-show block/fallback | Specified |
| Proxy collaboration load | Marked sizing-only; actual 1B/1C implementation repeats combined qualification | Specified |
| Evidence store/signing | Append-only access-controlled store plus signed result schema and artifact hashes | Specified; implementation gated |
| Command/aggregate matrix | Authority, aggregate, precondition, revision, transaction, event and retention matrix added | Specified |
| Cue automaton/conditions | Hold/resume/back/skip/rebase, occurrences, generation fencing and v0 condition language defined | Specified |
| Bitemporal identity | Valid/recorded intervals, query modes, correction, uncertainty, exclusivity and cross-epoch rule defined | Specified |
| Reconciliation/pruning | Hash-chained chunks, transactional import/projection/outbox, receipt, backup barrier, permit and crash-safe marker | Specified + gated |
| Handoff/task/incident | Handoff aggregate, item disposition, composite watermark/re-ack plus release/reassign/coordinator commands | Specified |
| Check reuse/A1 receipt | Exact validity tuple/default ages; receipt separated from effectiveness with unavailable/reason path | Specified |
| Phase 1A dependencies | Capability matrix hides deferred controls; tasks use foreground queue; intercom/radio mandatory | Specified |
| Phase 1A breadth | Re-sliced into 1A.1 monitor/identify, 1A.2 operate/intervene and 1A.3 recover/rehearse; old estimate withdrawn | Specified |
| Protocol wire types | JCS/I-JSON, string counters, fixed-width epoch, stable errors and v0 JSON Schemas/fixture added | Baseline specified; route specs/golden signature freeze gate code |
| Database migrations | Expand/migrate/contract, compatibility gates, backup, rollback and projection rebuild required | Specified + gated |
| Attachment saga | Intent/quarantine/blob/metadata/ready/tombstone/orphan/evidence-pin sequence defined | Specified |
| Image vs message media | Shared low-level blob pipeline; separate `ManagedImageAsset` 1A and `MessageAttachment` 1C resources/policy | Specified |
| Page state and bounds | Cumulative ordered timestamps/terminal outcomes plus recipient/topic/filter/fan-out/audit limits | Specified; load-gated |
| Domain naming | Stable production/revision/performance/activation/overlay/lease/event/export glossary added | Specified |
| Guided mic check | Resumable named-controller session, per-track cursor/states, dimension evidence/concurrency/A1 async receipt | Specified |
| Printable pack | Physical-presence preflight, revision markings, emergency fields and low-light/glove/re-entry tests | Specified + gated |
| Stale-cue My Track | Physical route/actions/fallback preserved; timing removed and show-caller confirmation shown | Specified |
| A2 hidden criticals | Primary exception retained with badges/counts for every other critical category | Specified + UX gated |

## Remaining go/no-go position

- Phase 0A implementation: **GO** once its frozen manifest and first-code CI land.
- Phase 0B experiments: **GO after relevant Phase 0A evidence**.
- Phase 0B integrated exit and Phase 1A: **NO-GO** until the mechanisms above
  have executable fixtures, real golden signatures/routes and named-tuple
  evidence. OpenAPI/AsyncAPI must be generated and frozen with the first concrete
  HTTP/subscription implementation; independent runtimes cannot begin before it.
- Supervised rehearsal: **NO-GO** until Phase 1A.3 and a fresh independent review
  pass.
