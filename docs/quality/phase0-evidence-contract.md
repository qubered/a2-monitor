# Phase 0 evidence contract

**Status:** Hypothesis; verifier-conformance foundation only, no product evidence.
See [open questions](../open-questions.md).

This document states what an evidence contract must do. It does **not**
describe a production promotion path that exists. The previous catalogue,
manifest schemas and verifier were withdrawn after the original implementation
failed to verify stored bytes. A later repair attempted filesystem verification
but remained unproven end to end and kept unsafe promotion trust edges. The
checked-in evidence still did not justify the assurance claim.

The dependency-free foundation in [`tools/evidence`](../../tools/evidence)
now exercises strict bounded JSON, artifact-root containment, byte length and
SHA-256 recomputation, ES256 consistency under a supplied conformance keyring,
per-trial time/fault record checks and verifier-computed predicates. Its only
accepted catalogue kind is explicitly
non-promotional and every output says `promotionEligible: false`. Metrics,
timelines, fault occurrences, runner identity, catalogue and keyring remain
supplied conformance inputs; they cannot promote a phase until runtime-specific
extractors and trusted authorities establish them independently. See
[ADR 0020](../decisions/0020-evidence-verifier-trust-boundary.md).

When this is rebuilt against a working runtime, it must hold:

- the verifier, not the runner, computes pass. A trusted catalogue owns the
  assertion IDs; the runner supplies artifact hashes and run facts, never a
  trusted pass/fail field;
- the verifier opens every artifact beneath an explicit artifact root, hashes
  the bytes itself, parses the metrics document and evaluates the catalogue
  predicate (`eq`, `lt`, `lte`, `gt`, `gte`, `abs_lte`). Every predicate must
  pass, and missing or tampered artifacts must fail with negative tests
  proving it;
- promotion consumes signed run records against an exact required tuple
  matrix covering both supported OS families and every named profile.
  Windows-only or macOS-only evidence cannot close Phase 0A;
- the input manifest is immutable and hash-bound to the result. Trial
  start/end times cover at least `trials * (duration + warmup)`, and every
  scheduled fault falls inside that interval;
- result signatures are ES256 IEEE-P1363 over RFC 8785 bytes of the object
  excluding its `signature` member, with cross-runtime canonicalization
  vectors including Unicode edge cases;
- deviations require a separately signed waiver whose authority, scope,
  expiry and allowed phase are verified; and
- a phase closes only when every catalogued test has a verified passing
  result.

The requirements below record what the phases were intended to freeze.

0A freezes the exact Windows/macOS device/driver/firmware/rate/block/channel
tuple plus build, Rust, audio-host adapter, CPAL, SQLite and lockfile
identifiers, and uses a seeded channel/frame integrity oracle. The nominal
profile is three 12-hour trials. Promotion requires Windows ASIO DVS, Windows
ASIO professional interface, Windows WASAPI ordinary-device, macOS Core Audio
DVS and macOS Core Audio professional-interface coverage; clock-change and IPC
confinement tests run on both operating systems. Device/clock change proves a
new capture epoch and no silent repatch. IPC evidence includes incompatible-ABI
rejection, unauthorized-open attempts and producer continuity during a hostile
consumer.

0B freezes the capture device/driver/block tuple, requested Opus packet/bitrate/
FEC/jitter profile, clients, output kit, browser product and engine, real-device
versus automation execution, network, numeric impairment profile, limits and
fault schedule. It also freezes build, Rust, `str0m`, selected crypto provider,
`libopus`, exact Node/Fastify, SQLite, generated-contract and lockfile IDs. It
covers wired/Wi-Fi latency tails and audible interruption, capture-clock to
RTP/RTCP mapping and drift, media-worker recovery, declared-capacity-plus-one
admission, runtime contract conformance, storage power cuts, packaged lifecycle
and rollback, PKI lifecycle, combined resource load, power-fenced takeover and
QLab shadow qualification. Promotion requires real-device Chromium and Firefox
wired results, real-device Safari/iPad Wi-Fi, plus Windows and macOS storage and
package-lifecycle results. Browser product and engine must agree. Playwright is
useful regression evidence but cannot
satisfy a real-device row. Exact thresholds live in the catalogue so prose
cannot silently weaken them.

CI compiles every Draft 2020-12 schema with a non-mutating Ajv 2020 validator,
independently verifies signatures and artifact bytes, rejects unknown commands,
fabricated metrics, insufficient elapsed time, faults outside the run and
incomplete promotion matrices, and runs on Windows, macOS and Linux. The
Fastify runtime uses the same strict schema dialect and validates first so
response serialization cannot erase evidence of invalid data. Runnable audio code must additionally add callback allocation/
lock guards, applicable sanitizers, dependency/license/secret scanning and
signed evidence emission before it can promote a phase.

The current CLI takes `verify-conformance-run CATALOG MANIFEST RESULT KEYRING
ARTIFACT_ROOT`; the artifact root is mandatory and unsafe aliases, symlinks and
special files are rejected. It deliberately has no `verify-promotion` command.
The first runtime-specific extractor fixture consumes the synthetic audio-node's
bounded JSONL metadata trace, requires its fixed 160 ms manifest interval, and
binds derived continuity/exact-frame-timing/xrun metrics to the exact trace and
manifest hashes. The verifier reruns the closed extractor
over verified trace bytes and requires exact canonical metric-byte equality
before predicate evaluation. The trace contains no PCM oracle and remains
explicitly non-promotional.
The future production CLI must consume pinned or signed catalogue/keyring trust
anchors and either reverify full bundles or accept only independently signed
verified summaries matched against exact named coverage rows.
