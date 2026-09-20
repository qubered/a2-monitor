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

It is currently empty. Component-independent verifier-conformance tests live
beside their dependency-free implementation in `tools/evidence`; they are not
product or hardware evidence.

The previous contents — an evidence catalogue, manifest schemas, protocol
golden vectors and adversarial contract tests — were withdrawn along with the
verifier they exercised. The original verifier did not read stored bytes; a
later repair attempted that work, but no committed independent on-disk bundle
proved the CLI end to end and caller-created summaries could still fabricate
promotion. The evidence set did not support its claim.

## What the replacement must do

The current non-promotional foundation implements bounded artifact-byte
verification and verifier-owned predicate evaluation. When evidence runners
are written against a working runtime, production promotion must additionally
do all of the following:

- runners do not declare pass/fail. They emit signed results that reference an
  exact artifact set including a mandatory metrics artifact;
- the verifier reads files beneath a supplied artifact root, hashes their
  actual bytes, evaluates catalogue predicates and returns normalized coverage
  that a separate trusted promotion policy can consume; and
- contract tests carry adversarial cases for changed bytes, fabricated
  measurements, insufficient elapsed time, out-of-window faults and promotion
  with an incomplete OS/device/browser matrix. Each must fail for the intended
  reason, proven by a negative test.

See [open questions](../docs/open-questions.md).

Component-local unit tests should live beside their component. Generated audio,
captures, logs, databases, and performance reports belong in ignored artifact
directories, not Git.
