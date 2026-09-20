# ADR 0020: Build evidence verification from bytes inward

- **Status:** Accepted for verifier conformance; product promotion deferred
- **Date:** 2026-09-20
- **Owners:** Evidence authority; relevant domain owner
- **Supersedes:** None

## Context

The withdrawn evidence apparatus asserted more assurance than its checked-in
evidence supported. A later repair attempted filesystem byte verification, but
it remained unproven end to end and retained unsafe trust edges: promotion
accepted caller-created summaries, catalogue and keyring trust was not pinned,
time was a declared wall-clock interval, and scalar metrics and signed run facts
were treated as if they were independently observed.

The replacement must be exercised against runnable emitters. Exact Phase 0A and
0B thresholds, hardware tuples and raw-trace extractors are not yet frozen, so
publishing a production promotion catalogue now would repeat the same mistake.

## Decision

Build the verifier in this trust order:

1. parse bounded UTF-8 JSON while rejecting duplicate keys, ambiguous numbers,
   invalid Unicode and unknown fields;
2. open regular artifact files only beneath one explicit root, stream and bound
   their bytes, and compare both length and SHA-256;
3. bind signed results to the exact raw manifest and catalogue bytes;
4. compute predicates from verified metric bytes with closed typed operators;
5. validate each trial and fault against one boot-bound monotonic timeline; and
6. only then emit a normalized verifier-owned result.

The first executable catalogue is explicitly
`a2-evidence-verifier-conformance-catalog`. Its output always carries
`promotionEligible: false` and identifies metrics, timelines, fault records,
identities, catalogue data and keyring data as supplied conformance inputs, not
independent product evidence. It exists to test the verifier. It cannot
close Phase 0A, Phase 0B, a hardware profile or a release gate.

Runner results use ES256 with 64-byte IEEE-P1363 signatures and a purpose-bound
P-256 key. Conformance verification rejects deviations and waivers until their
separate authority contract exists. Catalogue and keyring paths supplied to the
conformance CLI are test inputs, not production trust anchors.

A production promotion path is added only after runtime-specific extractors can
derive eligible metrics from raw traces, exact coverage rows and thresholds are
frozen, catalogue/keyring trust anchors are defined, verified summaries are
independently signed or full bundles are reverified, and cross-platform fixture
bundles exercise the CLI end to end.

## Consequences

### Positive

- Missing, changed, aliased, oversized and unsafe-path artifacts fail before a
  predicate is evaluated.
- A result cannot declare pass; the verifier owns that conclusion.
- Internally inconsistent short or overlapping trial records and missing or
  out-of-window fault records fail even when the supplied outer wall-clock
  interval appears long enough.
- Current tests can harden parsers and trust direction without fabricating a
  hardware or performance claim.

### Negative

- Conformance success is deliberately not promotion.
- Safe-integer metrics are the only numeric form in this first boundary;
  decimal measurements need a later exact-decimal representation.
- Portable Node.js lacks descriptor-relative `openat`; the loader compensates
  with no-follow opens and pre/post root, path and inode checks, but production
  evidence collection still needs named-host race and reparse-point testing.
- Raw-trace extractors, catalogue signing, verifier-authority summaries,
  waivers and exact promotion matrices remain work.

## Validation

- Adversarial JSON tests cover duplicate keys, invalid UTF-8 and Unicode,
  unsafe numeric forms and every parser bound.
- Filesystem tests cover traversal, Windows path aliases, symlinks, special
  files, final-path replacement, root stability, count/size limits, missing
  files, length drift and same-length byte tampering.
- Run tests cover all six closed predicates, raw-byte bindings, signature
  purpose/status/validity, false measurements, per-trial duration and exact
  fault occurrence windows.
- A fixed Unicode-bearing JCS byte sequence and OpenSSL-generated P-256
  signature exercise Node verification of both DER and 64-byte IEEE-P1363
  encodings without using Node to sign the fixture. This remains a
  non-promotional conformance vector, not a trust anchor.
- Independent review must confirm that no conformance output is represented as
  product evidence.
