# Evidence verifier conformance tools

This directory contains the dependency-free foundation for Phase 0 evidence
verification. It is executable verifier test infrastructure, not a production
evidence catalogue and not evidence that any product gate passed.

The current CLI verifies a closed synthetic/conformance run:

```sh
node tools/evidence/evidence-verifier.mjs verify-conformance-run \
  CATALOG MANIFEST RESULT KEYRING ARTIFACT_ROOT
```

It reads bounded strict JSON, checks ES256 consistency under a supplied
conformance keyring, binds the result to the exact catalogue and manifest bytes,
opens every declared regular file beneath the explicit artifact root,
recomputes length and SHA-256, checks internally consistent per-trial time/fault
records, and computes closed typed predicates from the verified metrics bytes.

Every successful summary says `promotionEligible: false`. Metrics, timelines,
fault occurrences, runner identity, catalogue and keyring are supplied
conformance inputs, not independently observed facts. Do not use this command to
claim Phase 0A, Phase 0B, hardware, performance, security or release support.
Production promotion still needs raw-trace extractors, frozen thresholds and
coverage rows, trust anchors, independently authorized summaries, waivers and
cross-platform on-disk bundles.

Run the focused suite with:

```sh
node --test tools/evidence/*.test.mjs
```
