# Documentation

This directory is the durable project record. Pull-request discussion can
explain a change, but architecture, operating constraints, and product intent
must remain understandable without access to the original conversation.

## Start here

- [Open questions](open-questions.md)
- [Product vision](product/vision.md)
- [Reference productions](product/reference-productions.md)
- [Cast, microphone, image, and cue workflows](product/cast-mics-cues.md)
- [A1/A2 views and collaboration](product/a1-a2-views-and-collaboration.md)
- [System architecture](architecture/overview.md)
- [Implementation and workspace structure](architecture/implementation-structure.md)
- [Process supervision and update lifecycle](architecture/process-and-update-lifecycle.md)
- [Media clock and native IPC ABI](architecture/media-clock-and-ipc-abi.md)
- [Deployment topologies](architecture/deployment.md)
- [Latency architecture](architecture/latency.md)
- [Time, clock, and replay](architecture/time-and-replay.md)
- [Failure and degraded modes](architecture/failure-and-degraded-modes.md)
- [Runtime command contract](architecture/runtime-command-contract.md)
- [Temporal identity and physical swap](architecture/temporal-identity-and-swap.md)
- [Cue and operator state machines](architecture/cue-and-operator-state-machines.md)
- [Control-ledger reconciliation](architecture/ledger-reconciliation.md)
- [Performance lifecycle](architecture/performance-lifecycle.md)
- [Stable domain glossary](architecture/domain-glossary.md)
- [Observability and operational evidence](architecture/observability.md)
- [Domain model](architecture/domain-model.md)
- [Operator workflows](product/operator-workflows.md)
- [Design language](design/DESIGN.md)
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
- [Dependency and licence inventory](quality/dependency-license-inventory.md)
- [Repository governance](quality/repository-governance.md)
- [Show management and control API](api/show-management-and-control.md)
- [Technology stack selection](research/technology-stack-selection.md)
- [A1/A2 theatre workflow research](research/a1-a2-collaboration.md)

## Decisions

ADRs 0001-0003 are accepted. ADRs 0004-0018 are hypotheses with no
supporting evidence; their status lines say so individually. ADR 0019 is an
accepted product decision. ADR 0020 accepts only the verifier-conformance trust
boundary; production evidence promotion remains deferred.

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
- [Cue-optional operation and show-time scope](decisions/0019-cue-optional-and-show-time-scope.md)
- [Evidence verifier trust boundary](decisions/0020-evidence-verifier-trust-boundary.md)
- [Temporary PCM listen MVP](decisions/0021-temporary-pcm-listen-mvp.md) (superseded)
- [Local MVP showfile](decisions/0022-local-mvp-showfile.md)
- [Menu-bar shell and temporary Shure MVP host](decisions/0023-menu-bar-shell-and-shure-mvp-host.md)
- [App window for device and network selection](decisions/0024-app-window-device-and-network-selection.md)
- [Manager production library and inline photo upload](decisions/0025-manager-production-library-and-photo-upload.md)
- [WebRTC/Opus listen transport for the local MVP](decisions/0026-webrtc-opus-listen-mvp.md)
- [MVP live monitoring state and alert lifecycle](decisions/0027-mvp-live-monitoring-and-alerts.md)
- [MVP shared mic checks and A1 fault reports](decisions/0028-mvp-shared-checks-and-fault-reports.md)
- [MVP sessions and a shared run of show](decisions/0029-mvp-sessions-and-run-of-show.md)
- [MVP rooms and categories](decisions/0030-mvp-rooms-and-categories.md)
- [Shared host monitor output](decisions/0031-shared-host-monitor-output.md)
- [Per-channel monitor trim](decisions/0033-channel-monitor-trim.md)

## Reference

- `decisions`: architecture decision records (ADRs)
- `api`: public management, control, event, and integration contracts
- `quality`: testing, performance, security, and release gates
- `integrations`: receiver coverage, transports, capability maps, and firmware policy
- `research`: source-backed technical and competitive research
- `runbooks`: repeatable development and operational procedures

## Document states

Use these labels at the top of technical documents where ambiguity matters:

- **Hypothesis**: written ahead of evidence. Nothing in it has been measured
  and it may be wrong in ways nobody has discovered yet.
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
