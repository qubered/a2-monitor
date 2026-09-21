# Changelog

All notable operator-visible changes will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project will use [Semantic Versioning](https://semver.org/) after the first
externally tested release.

## Unreleased

### Removed

- Withdrew the specification layer that ran ahead of evidence: five independent
  review rounds and their response ledgers, the `schema/v0` wire contracts and
  their golden fixtures, the evidence catalogues, manifest schemas and the
  evidence verifier, and the collaboration contract that specified the
  deferred Phase 1B/1C chat features. Recoverable at commit
  `6c123f3b44f69392da62ee9da0f61d07c7999daf`.
- The verifier was withdrawn rather than repaired because it did not verify:
  it compared declared artifact hashes without resolving the storage key,
  reading bytes, checking length or recomputing SHA-256, and its passing
  fixture used placeholder hashes against nonexistent stores. A green check
  asserted an assurance level the project did not have.

### Changed

- ADRs 0004-0018 and the dependent architecture, quality and protocol
  documents are marked Hypothesis rather than Accepted or Normative. ADRs
  0001-0003 keep Accepted.
- Added `docs/open-questions.md` as the live working list: the two questions
  that decide the product, the disposable spike that answers them, the
  contract findings still open when the reviews were withdrawn, and the
  commercial questions the plan has never addressed.
- Closed the general architecture-review loop. Review moves to
  evidence-bearing milestones.

### Added

- Expanded the Shure receiver integration from battery-only telemetry to the
  full read-only suite the coverage matrix scopes: an explicit per-receiver
  model picker in Manager (with channel count derived from the model, except
  the dynamically-licensed ANX4), a shared model/capability registry
  (`@a2-monitor/protocol/shure-models`), and a per-family command-string
  adapter in listen-gateway covering RF level, antenna diversity, channel/link
  quality, interference detection, a receiver audio meter, transmitter
  identity/mute, and transmitter battery health (type, cycle count, runtime).
  Live now shows RF/antenna/interference status alongside battery. Every
  value stays `null`/unavailable rather than fabricated when a model's
  capability profile does not support it; the adapter remains
  `compatible-read-only` pending hardware acceptance testing.
- Added the first runnable Live application slice: a responsive A2 channel
  grid with fabricated local data, independent status dimensions, alert
  acknowledgement, listen selection, channel detail, Paper/dark themes and a
  muted-by-default listening bar. Added the npm workspace, shared design tokens,
  locally bundled fonts, interaction tests and Node 24 CI checks.

- Resolved the independent stack reviews with executable evidence predicates
  over verified artifact bytes, explicit OS/device/browser/lifecycle promotion
  matrices, capture-frame/RTP rules, a hardened shared-memory ABI, complete
  native/backend supervision, media-worker recovery, immutable-slot updates,
  strict Ajv 2020/Fastify conformance, explicit WebRTC crypto providers,
  hermetic ASIO builds, accountable release roles and conditional WiX use.
- Rebased Phase 0 into a prerequisite closure slice, stack scaffold, capture
  proof and three attributable Phase 0B media/appliance/integration gates.
- Aligned branch governance with the current single-maintainer phase: pull
  requests and required cross-platform checks remain enforced, while the
  impossible second-person approval gate returns before an external pilot.

- Selected and documented the implementation baseline: Rust with a replaceable
  CPAL audio-host layer, shared-memory/Protobuf IPC, `str0m` plus `libopus`, a
  TypeScript/Fastify backend, independent React/Vite applications, pinned
  SQLite, Cargo/npm workspaces, cross-browser testing and native signed
  Windows/macOS packages. Hardware-sensitive choices remain evidence-gated.
- Added the target workspace/dependency map and a Phase 0T scaffold gate before
  hardware capture work.
- Initial product, architecture, quality, and repository-management baseline.
- Closed the third independent-review design findings with safe takeover
  fencing, exact Live lease/data-channel semantics, persistence and media-
  sandbox ADRs, runtime/cue/swap/handoff/reconciliation state machines,
  machine-readable protocol/evidence schemas, and a three-slice Phase 1A plan.
- Recorded a fourth independent review of that baseline without changing the
  reviewed plan; it found remaining evidence-schema, signed-wire, continuous-
  fence, physical-transition, lifecycle, confinement and operator-gate blockers.
- Implemented the Round 4 response: executable evidence promotion, signed
  command/result contracts and vectors, component-level swap/performance state
  machines, power-fenced boot authority, platform confinement/offline PKI,
  reconciliation objects, listening/operator gates and a bounded review exit rule.
- Recorded the bounded Round 5 closure review. It retained the architecture but
  found five executable-contract blockers in evidence promotion, command
  authority, boot-grant issuance, event/reconciliation truth and operator-slice
  promotion; remediation is a targeted closure change, not another broad review.
