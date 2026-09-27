# Open questions

**Status:** Live working list

**Last updated:** 2026-09-27

This file carries the findings that were still open when the review documents
were withdrawn, plus the questions that block the plan. It replaces the
review-round documents as the record of what is unresolved.

The withdrawn material — five independent review rounds, their response
ledgers, the `schema/v0` wire contracts and the evidence-verifier apparatus —
is recoverable at commit `6c123f3b44f69392da62ee9da0f61d07c7999daf`
(local tag `spec-baseline-2026-09-19`).

## Why the contract layer was withdrawn

The repository reached 66,000 words of specification, 18 ADRs and five review
rounds without a single measurement. The fifth review established that the
first evidence verifier did not verify stored bytes and that its passing
fixture used placeholder hashes against nonexistent stores. The recoverable
baseline includes a later attempted byte-reading repair, but that repair
remained unproven end to end and still allowed caller-created summaries to
fabricate promotion. The review also found the canonical command envelope
conflated bootstrap and Live authority, and that canonical events and ledger
chunks accepted arbitrary objects.

Those artifacts were wrong *and* premature. A broken contract in
`packages/protocol` with a green CI badge is worse than no contract, because it
will be built against and it asserts an assurance level the project does not
have. They are withdrawn rather than repaired: they will be rewritten against a
runtime that exists, not ahead of one.

## The two questions that decide the product

Neither needs a ledger, a lease protocol, an offline PKI or a packaging
rollback transaction to answer.

1. **Can a browser hold usable capture-to-ear latency across Chrome, Firefox
   and Safari/iPad, reliably, on venue Wi-Fi?**
2. **Do the EW-DX and Shure APIs expose telemetry rich enough to support causal
   diagnosis, rather than another meter grid?**

Until both have measured answers, every document in this repository is a
hypothesis.

### Next action: disposable spike

**Execution update, 2026-09-20:** the maintainer chose to defer this disposable
spike and start building the real application in small, locally testable slices.
The first Live channel-grid slice is in progress. This sequencing choice does
not answer either product question below, validate the selected stack, or turn
any target into a measured result. The spike remains the gate before browser
latency or receiver support is claimed.

Two weeks, explicitly thrown away, no contracts and no schemas:

- one macOS or Windows host, DVS or any professional interface, 8 channels;
- whatever WebRTC implementation stands up fastest — a Node SFU, GStreamer,
  `pion` — deliberately *not* `str0m`, because this spike tests the product
  question, not the implementation choice;
- one server-side stereo mix, one browser, tap-to-switch between sources;
- impulse in, headphone out, both recorded on one reference interface, at least
  100 events, report p50/p95/p99/max; and
- one EW-DX on the bench, SSCv2 authenticated, dump what the subscription
  actually delivers and at what rate.

Write the numbers into this file. No new architecture document until a measured
number exists that it is responding to.

## Latency gate needs two tiers

`docs/quality/performance-baselines.md` states wired p50 <= 50 ms / p95 <= 75 ms
as a single gate. The plausible budget — DVS buffer, host buffer, block and
routing, 10 ms Opus frame plus encoder lookahead, transit, receiver jitter
buffer, decoder and browser graph, OS output — may land at 100–130 ms, and
`jitterBufferTarget` is only meaningfully implemented in Chromium.

For auditioning and diagnosis, which is the stated product boundary, 130 ms is
usable. As written, missing a self-imposed target triggers the native-client
escape hatch for no product reason.

**Open:** define a `target` tier and a `ship-acceptable` tier, with the
native-client trigger bound to the second, *before* Phase 0B measures anything.

**Measured, 2026-09-27 (synthetic, not capture-to-ear).** The
[latency harness](../tools/latency/README.md) timed the shipped path from the
capture pipe to a PulseAudio sink through headless Chromium 141 on a Linux
container ([audit G4](research/next-level-audit-2026-09.md#g4--the-audio-core),
raw data alongside it):

| Path                                               | p50        | p95       | Notes                                                                              |
| -------------------------------------------------- | ---------- | --------- | ---------------------------------------------------------------------------------- |
| Clean loopback, steady state                       | 87–102 ms  | 92–117 ms | Across 5 identical-config runs; ~32 ms of it is the sink's reported output latency |
| First seconds of a new session                     | 170–370 ms | —         | 13 of 14 sessions; drains over 5–10 s                                              |
| Relay: 1 % loss, 2–8 ms jitter, 1 % stalls ≤ 60 ms | 150 ms     | 157 ms    | steady state; 1.05 % concealed                                                     |
| Relay: 5 % loss, 4–19 ms, 2 % stalls ≤ 120 ms      | 228 ms     | 249 ms    | steady state; 5.05 % concealed                                                     |

Inferred from these: the part Pulse and the browser control is ~55–65 ms on a
clean path, so wired p50 ≤ 50 ms is not reachable once any real input and
output buffering is added, and the Wi-Fi p50 ≤ 80 ms gate fails under even the
mild relay profile. A user-stated ceiling for phone listening is "≤ 200 ms"
([ShowStack issue 74](https://github.com/chazw661/ShowStack/issues/74),
accessed 2026-09-27).

**Proposed tiers (not decided):**

- `target` — wired, reference host and client: capture-to-ear p50 ≤ 80 ms,
  p95 ≤ 100 ms, max ≤ 150 ms.
- `ship-acceptable` — wired p95 ≤ 120 ms; declared venue-Wi-Fi profile
  p95 ≤ 200 ms with no single audible interruption over 250 ms. The
  native-client trigger binds to missing this tier on physical hardware.

Still unmeasured: Safari/iOS, Firefox, a physical interface and output device,
and a real access point. The physical test in
[latency.md](architecture/latency.md#test-method) remains the gate.

## Carried-forward contract findings

These are recorded so the thinking is not lost. None is actionable until there
is a runtime; each must be re-derived against working code rather than restored
from the withdrawn schemas.

| Area | What was unresolved |
| --- | --- |
| Bootstrap vs Live authority | Activation happens before a Live lease exists, but only one command envelope was defined and it always required a lease. Bootstrap and leased routes need separating while converging on one node result ledger. |
| Boot-grant lifecycle | ADR 0008 and the performance lifecycle disagree on whether the grant precedes or follows activation. Grant generation, a node-recorded deadline that replay cannot extend, and revocation state are undefined. |
| Canonical event truth | Event `prior_state`, `current_state` and `payload` were unconstrained, so an empty event with a false payload hash validated. Discriminated variants and chain verification are required. |
| Ledger chunks | No representation of per-event hash or inclusion order despite the reconciliation contract requiring both. Compaction-marker and quarantined-tail contracts absent; migration manifest unsigned. |
| Evidence promotion | Promotion must consume signed run records with an exact OS/device/profile matrix, and the verifier must resolve stored bytes, size and hash with missing/tampered negative tests. |
| Phase 1 operator promotion | Slice promotion sets, named A1/A2/observer roles, catalogue-frozen numeric thresholds and per-repetition results were all missing. |
| Lease wire format | ADR 0009 promises lease, handshake, result and query golden vectors; the lease had no protected-header or wire schema. |
| JCS conformance | One fixed Unicode-bearing vector is signed by OpenSSL and verified by Node. Full RFC cross-runtime vectors and broader Unicode edge cases remain required for promotion. |
| Naming drift | Runtime prose used `FailChange`/`AbandonChange` against `FailPhysicalChange`/`AbandonPhysicalChange`; one client-profile sentence still said `show-ready` after the rename to `transport-ready`. |

## Commercial questions, unaddressed

The plan has no position on any of these, and they decide whether the
engineering matters:

- Who buys this, and at what price?
- Why does a rental house or production switch from WAVETOOL, which is mature
  and effectively bundled with the hardware they already own?
- What happens when Shure or Sennheiser ships the same feature?
- No software licence has been selected; the repository is "all rights
  reserved" by default.
- The ASIO SDK (Steinberg) and WiX licensing decisions are identified but
  unowned, and a licence negotiation can outrun the phase budgeted for it.
  These should start in parallel now, not as a phase gate.

## Deferred deliberately

Real work for a shipping v1.0, not needed to know whether the product exists:

- signed control ledger with compaction, quarantine and migration;
- offline PKI issue/rotate/revoke/expiry;
- boot-authority-grant and fenced-takeover protocol;
- A/B application-slot update and rollback for MSI and pkg; and
- chat, reactions, attachments and transcription — the former Phase 1B/1C. The
  collaboration contract document is withdrawn with them.
