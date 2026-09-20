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

## Fixed OpenSSL conformance vector

[`fixtures/openssl-es256-jcs-v1.json`](fixtures/openssl-es256-jcs-v1.json)
freezes an intentionally unordered JSON payload, its expected canonical UTF-8
bytes, a P-256 public key, and both the OpenSSL-native DER and converted
IEEE-P1363 forms of one ES256 signature. The payload includes decomposed and
precomposed Unicode, a non-BMP key, escaped characters, the largest safe
integer and an explicit `promotionEligible: false` marker. The private key was
discarded; this is a verification vector, not a signing identity or trust
anchor.

The fixture was produced with OpenSSL 3.6.3 on 2026-09-20. To regenerate a new
vector, first review and independently freeze the canonical byte string, then:

```sh
xxd -r -p canonical.hex > canonical.json
openssl ecparam -name prime256v1 -genkey -noout -out fixture-private.pem
openssl pkey -in fixture-private.pem -pubout -out fixture-public.pem
openssl dgst -sha256 -sign fixture-private.pem \
  -out signature.der canonical.json
openssl asn1parse -inform DER -in signature.der
openssl dgst -sha256 -verify fixture-public.pem \
  -signature signature.der canonical.json
```

`openssl asn1parse` prints the two ECDSA integers. Strip only DER sign-padding,
left-pad each integer to 32 bytes, and concatenate `r || s` to obtain the
64-byte IEEE-P1363 value. Export the SPKI public key as DER and hash it to
recheck the fixture provenance:

```sh
openssl pkey -pubin -in fixture-public.pem -outform DER \
  | openssl dgst -sha256
```

OpenSSL ECDSA signing is randomized, so regeneration creates a new key and
signature. Never add `fixture-private.pem` to the repository. The test verifies
both OpenSSL's DER form and the fixed IEEE-P1363 form with Node; passing it is
canonicalization/signature conformance only and is never product evidence.

Run the focused suite with:

```sh
node --test tools/evidence/*.test.mjs
```
