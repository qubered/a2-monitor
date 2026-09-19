# Documentation

This directory is the durable project record. Pull-request discussion can
explain a change, but architecture, operating constraints, and product intent
must remain understandable without access to the original conversation.

## Start here

- [Product vision](product/vision.md)
- [Reference productions](product/reference-productions.md)
- [Cast, microphone, image, and cue workflows](product/cast-mics-cues.md)
- [A1/A2 views and collaboration](product/a1-a2-views-and-collaboration.md)
- [Roadmap](product/roadmap.md)
- [System architecture](architecture/overview.md)
- [Implementation and workspace structure](architecture/implementation-structure.md)
- [Deployment topologies](architecture/deployment.md)
- [Latency architecture](architecture/latency.md)
- [Time, clock, and replay](architecture/time-and-replay.md)
- [Failure and degraded modes](architecture/failure-and-degraded-modes.md)
- [Collaboration state and authorization contract](architecture/collaboration-contract.md)
- [Runtime command contract](architecture/runtime-command-contract.md)
- [Temporal identity and physical swap](architecture/temporal-identity-and-swap.md)
- [Cue and operator state machines](architecture/cue-and-operator-state-machines.md)
- [Control-ledger reconciliation](architecture/ledger-reconciliation.md)
- [Performance lifecycle](architecture/performance-lifecycle.md)
- [Stable domain glossary](architecture/domain-glossary.md)
- [Observability and operational evidence](architecture/observability.md)
- [Domain model](architecture/domain-model.md)
- [Operator workflows](product/operator-workflows.md)
- [Phase capability matrix](product/phase-capability-matrix.md)
- [Receiver integration standard](integrations/README.md)
- [Shure wireless integration](integrations/shure-wireless.md)
- [Sennheiser EW-DX integration](integrations/sennheiser-ew-dx.md)
- [Performance baselines](quality/performance-baselines.md)
- [Phase 0 evidence contract](quality/phase0-evidence-contract.md)
- [Phase 1 operator evidence contract](quality/phase1-operator-evidence-contract.md)
- [Personal listening safety](quality/listening-safety.md)
- [Client and appliance profiles](quality/client-and-appliance-profiles.md)
- [Reference validation matrix](quality/validation-matrix.md)
- [Threat model](quality/threat-model.md)
- [Repository governance](quality/repository-governance.md)
- [Definition of done](quality/definition-of-done.md)
- [Show management and control API](api/show-management-and-control.md)
- [Technology stack selection](research/technology-stack-selection.md)
- [A1/A2 theatre workflow research](research/a1-a2-collaboration.md)
- [Independent-review response research](research/review-response-research.md)
- [Round 3 response research](research/round-3-response-research.md)
- [A1/A2 independent review](reviews/2026-09-18-a1-a2-independent-review.md)
- [Independent plan review: round 3](reviews/2026-09-19-independent-review-round-3.md)
- [Round 3 response and closure ledger](reviews/2026-09-19-round-3-response.md)
- [Independent plan review: round 4](reviews/2026-09-19-independent-review-round-4.md)
- [Round 4 response and closure ledger](reviews/2026-09-19-round-4-response.md)
- [Independent plan review: round 5 closure verification](reviews/2026-09-19-independent-review-round-5.md)

## Accepted decisions

- [Component boundaries](decisions/0001-three-component-boundary.md)
- [WebRTC and Opus transport](decisions/0002-webrtc-opus.md)
- [Cross-platform single-device capture](decisions/0003-cross-platform-single-capture-device.md)
- [Active-performance authority and control ledger](decisions/0004-active-performance-command-authority.md)
- [Cue authority and occurrences](decisions/0005-cue-authority-and-occurrences.md)
- [Foreground Live client profile](decisions/0006-foreground-live-client-profile.md)
- [Appliance resource isolation](decisions/0007-appliance-resource-isolation.md)
- [Safe authority takeover](decisions/0008-safe-authority-takeover.md)
- [Live control lease and data channel](decisions/0009-live-control-lease-and-data-channel.md)
- [Persistence, recovery, and migrations](decisions/0010-persistence-recovery-and-migrations.md)
- [Untrusted media sandbox](decisions/0011-untrusted-media-sandbox.md)
- [Node process confinement](decisions/0012-node-process-confinement.md)
- [Offline PKI and key lifecycle](decisions/0013-offline-pki-and-key-lifecycle.md)
- [Rust native runtime and audio-host boundary](decisions/0014-rust-audio-runtime-and-host-boundary.md)
- [TypeScript/Fastify and React/Vite application stack](decisions/0015-typescript-fastify-react-application-stack.md)
- [Shared-memory and Protobuf local IPC](decisions/0016-shared-memory-and-protobuf-local-ipc.md)
- [`str0m` WebRTC media worker](decisions/0017-str0m-webrtc-media-worker.md)
- [Workspaces, testing and native packaging](decisions/0018-workspaces-testing-and-native-packaging.md)

## Reference

- `decisions`: architecture decision records (ADRs)
- `api`: public management, control, event, and integration contracts
- `quality`: testing, performance, security, and release gates
- `integrations`: receiver coverage, transports, capability maps, and firmware policy
- `research`: source-backed technical and competitive research
- `reviews`: review findings and action ledgers
- `runbooks`: repeatable development and operational procedures

## Document states

Use these labels at the top of technical documents where ambiguity matters:

- **Proposed**: not yet accepted or proven.
- **Accepted**: the current project decision.
- **Validated**: measured on a named test setup.
- **Superseded**: retained for history and linked to its replacement.

Targets and verified measurements must never be presented as the same thing.

## Keeping documentation healthy

- Update a document in the same pull request as the behavior it describes.
- Add an ADR for decisions that are costly to reverse.
- Link to primary vendor or standards sources for changing technical facts.
- Record source access dates for web research.
- Prefer diagrams for process boundaries and timing paths, not decoration.
