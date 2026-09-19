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

`manifests` contains machine-readable evidence input/result schemas. `fixtures`
contains versioned protocol golden vectors. Both are validated by
`scripts/check-repo.sh`; executable code must add semantic schema and
cryptographic-vector validation rather than relying on JSON syntax alone.

Evidence runners do not declare pass/fail. They emit signed results whose
assertions name a content-addressed artifact and include a mandatory
`evidence-metrics/v0` artifact. The verifier reads the files beneath a supplied
artifact root, hashes their actual bytes, evaluates catalogue predicates and
returns normalized coverage for promotion. Its run form is:

```text
node tools/evidence-verifier.mjs verify-run \
  MANIFEST RESULT CATALOG KEYRING MANIFEST_SCHEMA RESULT_SCHEMA ARTIFACT_ROOT
```

Contract tests must retain adversarial cases for changed bytes, fabricated
measurements, insufficient elapsed time, out-of-window faults and promotion
with an incomplete OS/device/browser matrix.

Component-local unit tests should live beside their component. Generated audio,
captures, logs, databases, and performance reports belong in ignored artifact
directories, not Git.
