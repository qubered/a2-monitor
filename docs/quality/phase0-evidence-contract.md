# Phase 0 evidence contract

**Status:** Executable promotion gate

The closed catalogue is
[`evidence-tests.v0.json`](../../tests/catalog/evidence-tests.v0.json). Every run
validates against the phase-specific
[`0A`](../../tests/manifests/phase0a-capture-run.schema.json) or
[`0B`](../../tests/manifests/phase0b-run.schema.json) manifest and the common
[`result`](../../tests/manifests/evidence-result.schema.json) schema.

The verifier, not the runner, computes pass. It requires the exact catalogue
test, minimum trials/duration/client classes, required faults, assertions and
content-addressed artifacts. Every assertion must pass; `failed` or `not-run`
cannot promote. Deviations require a separately signed
[`waiver`](../../tests/manifests/evidence-waiver.schema.json) whose authority,
scope, expiry and allowed phase are verified. A phase closes only when every
catalogued test has a verified passing result.

The input manifest is immutable and hash-bound to the result. The result
signature is ES256 IEEE-P1363 over RFC 8785 bytes of the object excluding its
`signature` member. Artifact hashes are SHA-256. The checked-in
[`evidence verifier`](../../tools/evidence-verifier.mjs), valid fixture, false-
pass fixture and contract tests define the implementation behavior.

0A freezes the exact Windows/macOS device/driver/firmware/rate/block/channel
tuple and uses a seeded channel/frame integrity oracle. The nominal profile is
three 12-hour trials; device/clock change testing proves a new capture epoch and
no silent repatch.

0B freezes clients, output kit, browser, network, limits and fault schedule. It
covers wired/Wi-Fi impairment, combined resource load, power-fenced takeover,
cue shadow qualification, reconnect level, latched-listen cancellation and
intercom coexistence. Media artifacts include field-kit acoustic/output-route
measurements. Exact thresholds live in the catalogue so prose cannot silently
weaken them.

CI compiles every Draft 2020-12 schema, independently verifies signatures and
hashes, rejects unknown commands and false-pass evidence, and runs on Windows,
macOS and Linux. Runnable audio code must additionally add callback allocation/
lock guards, applicable sanitizers, dependency/license/secret scanning and
signed evidence emission before it can promote a phase.
