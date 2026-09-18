# Performance and reliability baselines

**Status:** Proposed release gates. Values are targets until a result is marked
Validated with a linked report.

## Supported reference profile

Phase 0A must define exact Windows and macOS reference hardware. Until then, results
must include all relevant details and cannot be generalized to the product.

Minimum report fields:

- build/commit and configuration;
- audio-node CPU, memory, OS, power profile, and thermal state;
- interface, driver, sample rate, bit depth, block size, and DVS latency;
- operating system and ASIO, WASAPI, or Core Audio host path;
- active input count, analysis modules, replay state, and client count;
- backend location and node/backend network path;
- client device, OS, browser version, output device, and connection type;
- switch/AP model and relevant network configuration; and
- duration, percentiles, maximum, errors, and raw artifact location.

## Audio node

| Metric | Technical spike | Limited field beta |
| --- | ---: | ---: |
| Inputs at 48 kHz | 32–64 | 128 |
| Continuous soak | 12 hours | 24 hours |
| Audio callback underruns | 0 | 0 |
| Unexplained sample discontinuities | 0 | 0 |
| Callback p99 budget | < 50% of deadline | < 40% of deadline |
| Callback maximum | < 80% of deadline | < 70% of deadline |
| Existing mixes survive backend restart | Required | Required |
| Active audio devices | Exactly 1 | Exactly 1 |

Callback results must come from low-overhead instrumentation and be corroborated
by output continuity testing.

## Browser listening

Physical capture-to-ear target:

| Path | p50 | p95 | Notes |
| --- | ---: | ---: | --- |
| Wired validated client | <= 50 ms | <= 75 ms | Non-Bluetooth output |
| Dedicated Wi-Fi 6/6E | <= 80 ms | <= 120 ms | Venue-like RF load |

Additional gates:

- gesture-to-audible tap-to-switch p95 <= 100 ms on wired and dedicated Wi-Fi
  profiles, with node-receipt-to-mix reported separately;
- no sustained interruption under the approved impaired-network profile;
- media stats and UI indicate degraded latency/loss rather than hiding it; and
- unsupported Bluetooth/output behavior is reported separately.

## Control and UI

| Metric | Target |
| --- | ---: |
| Show grid size | 128 channels |
| Meter update rate | 20–30 Hz |
| UI frame rate during updates | p95 >= 50 fps on reference client |
| Command acknowledgement, wired | p95 <= 75 ms |
| State resync after brief reconnect | <= 2 s |
| Stale telemetry indication | <= 1 s after threshold |

## Replay

- Phase 1A rehearsal core: at least ten minutes for 64 active inputs and two
  concurrent replay readers on the named appliance.
- Limited field beta: thirty minutes for all 128 active inputs and the declared
  full-load concurrent reader count.
- The uncompressed 128-channel, 48 kHz, 32-bit baseline is approximately
  44.2 GB plus index and safety margin; the reference profile reserves at
  least 64 GB unless a validated storage ADR changes the format.
- Synchronized channel alignment within one 48 kHz sample at the node index.
- Seek-to-audible p95 <= 250 ms on the reference appliance.
- Ring rollover cannot block the audio callback.
- Unexpected power loss may lose the newest segment but cannot corrupt the
  complete retained window or active show file.

## Capacity guardrails

- New audio clients are rejected cleanly before resource exhaustion.
- Disk-low thresholds warn early and preserve live monitoring over history.
- Telemetry backpressure drops/coalesces obsolete meter updates before durable
  events or control acknowledgements.
- Every limit is queryable as node capability, not hard-coded in the frontend.

Release capacity is tested as one combined worst-case profile: capture,
analysis, receiver telemetry, ring writing, concurrent replay, eight buses and
encoders, backend persistence, and active web clients. Component-only best-case
benchmarks do not satisfy the gate.

The combined profile also drives the declared collaboration envelope: text and
subscription fan-out, page storm, upload/quarantine/hostile decode, database/
asset/audit pressure and optional transcription. Passing without those loads
does not qualify a co-located rich-collaboration profile.

Before limited beta, run at least five independent 24-hour full-load soaks, 500
aggregate instrumented lab hours, 20 cold boots, and 20 controlled/abrupt power
cycles across the supported reference profiles.
