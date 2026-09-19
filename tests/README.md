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

It is currently empty. There is no product code to test.

The previous contents — an evidence catalogue, manifest schemas, protocol
golden vectors and adversarial contract tests — were withdrawn along with the
verifier they exercised, because the verifier did not verify: it compared
declared artifact hashes without resolving the storage key, reading bytes,
checking length or recomputing SHA-256, and its passing fixture used
placeholder hashes against nonexistent stores.

## What the replacement must do

When evidence runners are written against a working runtime:

- runners do not declare pass/fail. They emit signed results whose assertions
  name a content-addressed artifact and include a mandatory metrics artifact;
- the verifier reads files beneath a supplied artifact root, hashes their
  actual bytes, evaluates catalogue predicates and returns normalized coverage
  for promotion; and
- contract tests carry adversarial cases for changed bytes, fabricated
  measurements, insufficient elapsed time, out-of-window faults and promotion
  with an incomplete OS/device/browser matrix. Each must fail for the intended
  reason, proven by a negative test.

See [open questions](../docs/open-questions.md).

Component-local unit tests should live beside their component. Generated audio,
captures, logs, databases, and performance reports belong in ignored artifact
directories, not Git.
