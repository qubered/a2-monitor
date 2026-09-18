# Independent plan review action ledger

**Status:** Incorporated into the plan on 2026-09-18

Three context-free reviews assessed real-time architecture, A2/operator product
fit, and security/reliability. This ledger prevents findings from disappearing
into narrative. “Addressed” means the plan now contains a decision or release
gate; implementation evidence is still required.

| Finding | Plan response | Phase/status |
| --- | --- | --- |
| Windows/macOS and DVS host model undefined | Cross-platform ASIO/WASAPI/Core Audio, one-device ADR and validation matrix | Accepted decision; Phase 0A evidence |
| Concurrent DVS/USB creates clock ambiguity | Exactly one selected audio device/clock; no aggregate or simultaneous devices in v1 | Accepted decision |
| Timeline cannot survive restart/discontinuity | Capture sessions and explicit epochs; no invisible joining | Phase 0A |
| Receiver telemetry is not sample-accurate | Arrival mapping carries uncertainty and provenance | Phase 0B/1 |
| Replay storage/capacity undefined | Preallocated segmented ring, 44.2 GB float32 baseline, 64 GB reservation, bounded writer and gap policy | Phase 0B ADR; Phase 1/2 scale |
| Replay/backend authority ambiguous | Node owns media/local replay journal; backend owns durable operator events; idempotent upload | Protocol v0 |
| Browser latency claim too broad | Support exact client profiles; gesture-to-audible and node-to-mix measured separately | Phase 0B |
| Browser lifecycle untested | Lock/wake, reload, background, output, roaming and ICE tests added; background unsupported unless proven | Phase 0B |
| Multi-NIC WebRTC/ICE design absent | Client-interface-only candidates, bounded port range, no public STUN/TURN, default-deny firewall | Phase 0B |
| Receiver parser can crash audio | Audio engine, media, replay, adapter and supervisor processes separated with bounded IPC | Phase 0B |
| Capacity stated but not modeled | Combined full-load profile and explicit resource envelope/admission thresholds | Phase 0A/0B/2 |
| Backend outage freezes useful control | Signed, bounded Live-to-node show-time lease; new sessions/config still require backend | Protocol v0; Phase 0B |
| Degraded behavior and RTO/RPO absent | Failure matrix and reconciliation contract added | Phase 0B/1 |
| Device/receiver enrollment and TLS trust vague | Local CA, physical bootstrap, node keys, sealed receiver credentials, rotation/revocation | Phase 0B/1 |
| Show workflow only named | End-to-end build, preflight, mic-check, live, incident, replay and handoff workflow | Phase 1 |
| Physical A2 vocabulary missing | Asset/rack/slot/pack/spare/costume/zone/cue/operator concepts added | Phase 1 |
| Alerts would create fatigue | Arming, duration, debounce, hysteresis, cooldown, dedupe, cue/zone context and confidence | Phase 1 |
| Source identity is unsafe after repatch | Full activation identity manifest/diff, block/override, audit and atomic remap | Phase 1 |
| Replay can hide current failure | Strong replay state, live alerts retained, separate gain and one-action return | Phase 1 |
| Appliance recovery arrives too late | Update, rollback, UPS, cold start, spare restore and recovery are Phase 1 gates | Phase 1 |
| Threat model was only boundaries | Assets, actors, entry points, controls and abuse tests added | Before external pilot |
| Node was too privileged | Least-privilege multi-process boundary and OS sandbox ADR requirement | Phase 0B/1 |
| Local auth/grace/revocation undefined | Console bootstrap, RBAC, session classes, signed lease and offline tradeoff | Phase 1 |
| Certificate lifecycle undefined | Offline CA issuance, rotation, revocation, expiry/show-window check and reset | Phase 1 |
| Secret encryption lacked key custody | OS/hardware keystore and node-public-key sealed provisioning | Phase 1 |
| Update security/recovery vague | Signed provenance, power-safe install, health rollback, anti-rollback and offline recovery | Phase 1 |
| Wire contract semantics absent | Protocol v0 defines negotiation, bounds, ordering, snapshots, idempotency and activation | Freeze before Phase 1 code |
| Import/export is an attack boundary | Isolated, bounded, checksummed import with no partial state | Phase 1 |
| Observability requirements scattered | Bounded collection, health hierarchy, retention, correlation, redaction and SLO ownership specified | Phase 0 onward |
| Impaired-network profile undefined | Numeric nominal, venue Wi-Fi and stress profiles added | Phase 0B |
| One soak is weak evidence | Five 24-hour runs, 500 aggregate hours, cold boot and power-cycle minimums before beta | Phase 2 |
| Shure release scope contradicted catalogue | Only named pilot tuples block Phase 2; remainder stays planned until Phase 3 | Roadmap/integration corrected |
| “All versions” could imply untested support | Exact tuples and unverified/unsupported states remain mandatory | Ongoing |
| Phase 0 Shure/replay scope contradicted README/ADR | Phase 0B now explicitly includes one Shure profile and minimal replay ring | Reconciled |
| Roadmap was too optimistic | Split Phase 0, added rehearsal phase, lengthened beta and exposed dependencies | Rebaselined |
| Repository governance was advisory | CI baseline, review classes, severity and support policy documented | Before hosted development/pilot |
| License/security contact unresolved | Explicit external-release blockers retained | Open organizational dependency |
| First target segment undefined | Theatre/musical accepted first; corporate AV second; later profiles deferred | Resolved |
| Browser background behavior undefined | Version one is foreground-only; suspension is detected and foreground recovery is tested | Resolved |

## Deliberately deferred

Multi-node atomic operation, simultaneous devices, broad receiver catalogue,
frequency coordination, native client, automatic diagnosis, adapter SDK, fleet
management, and adjacent RF infrastructure stay outside the first trusted
operator loop. They require new evidence and ADRs rather than placeholder
complexity now.
