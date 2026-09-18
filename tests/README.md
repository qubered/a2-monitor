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

Component-local unit tests should live beside their component. Generated audio,
captures, logs, databases, and performance reports belong in ignored artifact
directories, not Git.
