# Changelog

All notable operator-visible changes will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project will use [Semantic Versioning](https://semver.org/) after the first
externally tested release.

## Unreleased

### Added

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
