# Cross-component tests

This directory is for tests that cross a component boundary or require a
shared test environment:

- audio-node/backend contract and reconnect suites;
- backend/frontend end-to-end workflows;
- receiver simulators and hardware-in-loop manifests;
- WebRTC compatibility and physical latency harnesses;
- replay synchronization and recovery tests;
- long-running soak and controlled network impairment; and
- appliance upgrade/rollback tests.

It is currently empty. Component-independent conformance tests for the
artifact-byte verifier in `tools/evidence` live beside their implementation
there; they check parser/verifier behavior, not product or hardware evidence.

Component-local unit tests should live beside their component. Generated audio,
captures, logs, databases, and performance reports belong in ignored artifact
directories, not Git.
