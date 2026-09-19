# Phase 0 evidence contract

**Status:** Normative gate; no Phase 0 result is release evidence without it

Every run validates against
[`phase0-evidence.schema.json`](../../tests/manifests/phase0-evidence.schema.json)
before execution. The checked-in manifest is immutable for that run; any change
creates a new manifest ID and invalidates comparison as the same experiment.

## Frozen inputs

The manifest pins commit/build/signing identity; Windows/macOS version and power
policy; CPU/RAM/storage/filesystem; audio device/driver/firmware/rate/block/input
count; node/backend/client builds; browser/OS/output route; network/switch/AP;
receiver/firmware; queue, replay, ledger, memory, handle/socket and disk limits;
load generator seeds/rates; trial count/duration/warm-up; fault schedule; and
all numeric assertions.

The audio integrity oracle uses a seeded per-channel sequence with unique
channel IDs, frame counters and periodic impulse/correlation markers. It must
detect channel permutation, duplication, omission, inserted/lost frames and
cross-channel contamination—not merely callback underruns. Raw oracle hashes,
metrics and packet traces are content-addressed artifacts.

## Required Phase 0A thresholds

Each exact OS/device tuple runs three 12-hour trials. The existing callback
deadline targets apply, with zero unexplained frame loss, duplication,
permutation or discontinuity. Device/clock changes must create a new capture
epoch. Unsupported tuples fail explicitly. A result qualifies only its exact
named tuple.

## Required Phase 0B thresholds

Each wired and Wi-Fi reference client runs three two-hour impairment/fault
trials plus one 12-hour combined soak. Browser/listen targets are those in the
performance baseline. Additional gates are:

- a visible supported client reports heartbeat every 1 second; the server marks
  it suspect at 3 seconds and interrupted at 5 seconds without heartbeat or
  advancing media evidence;
- transient recovery reaches coherent state within 2 seconds and audible media
  within 5 seconds; every reconstructed blind interval is displayed/audited;
- output device identity, effective gain and capture-to-ear latency remain within
  the qualified route profile; any unverified route change blocks show-ready;
- the foreground field kit completes the declared maximum show duration plus
  60 minutes, ending with at least 20% battery, or remains on validated external
  power through cable-disconnect/reconnect tests;
- camera, microphone/voice, tones and notifications remain disabled unless that
  exact client tuple separately passes route/gain/latency/media-continuity gates;
- old-node takeover, ledger capacity, backend/node crash, hostile decode, replay
  seek, collaboration proxy-load and resource-shedding schedules are predeclared;
  and
- proxy collaboration load is sizing evidence only; actual Phase 1B/1C code
  repeats the full combined qualification before enablement.

## Evidence store and signing

The runner writes artifacts into an append-only, access-controlled evidence
location. A result manifest contains the input-manifest hash, runner/build IDs,
start/end, assertion outcomes, raw artifact hashes, unexpected deviations and
an asymmetric signature from the CI/lab runner identity. Promotion verifies the
signature and every content hash. Manual exceptions cannot edit a result; they
are separate signed waiver records with owner, expiry and prohibited promotion
levels.

## First-code CI gate

The first runnable change must add pinned Windows and macOS builds, unit and
schema/golden-vector contract tests, callback allocation/lock guards, applicable
sanitizers, dependency/license/secret scans and signed evidence-manifest output.
No code-bearing PR may reduce these jobs without an accepted ADR.
