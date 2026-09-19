# Reference profiles and validation matrix

**Status:** Proposed; exact products and versions are selected during Phase 0A

## Capture matrix

The first validation lab covers:

| OS | Host API | Device class | Required proof |
| --- | --- | --- | --- |
| Windows | ASIO | DVS/DVS Pro | 32/64 channels in Phase 0A; 128 before beta |
| Windows | ASIO | Representative professional USB interface | Enumeration, stable identity, capture, loss/recovery |
| Windows | WASAPI | Representative non-ASIO device | Declared exclusive/shared mode and measured latency |
| macOS | Core Audio | DVS/DVS Pro | 32/64 channels in Phase 0A; 128 before beta |
| macOS | Core Audio | Representative USB/Thunderbolt interface | Enumeration, stable identity, capture, loss/recovery |

Only one row/device is active at a time. The published compatibility record
includes OS build, host API, driver, device firmware, sample format/rate, buffer,
channels, node build, and test evidence. Device enumeration is broad;
certification is tuple-specific.

Each tuple also records its host hardening profile: Windows power plan,
MMCSS/Pro Audio policy, DPC/ISR evidence, USB selective suspend, driver control
panel, update/reboot and security-software policy; or macOS sleep/App Nap,
Audio Workgroup use, update policy and thermal/power behavior as applicable.

## Client matrix

The pilot selects exact versions of at least:

- one supported Chromium desktop profile on Windows or macOS;
- Safari on a named iPadOS/iPad profile;
- one wired headphone/USB-output profile;
- one dedicated Wi-Fi profile and wired fallback; and
- the nominated switch and AP configuration.

Each record distinguishes browser product, browser engine and execution
profile. Phase 0B promotion specifically requires real-device Chrome/Chromium and
Firefox wired runs and a real-device Safari/iPadOS Wi-Fi run. Playwright
Chromium/WebKit/Firefox runs remain mandatory CI regression coverage but cannot
stand in for those product/device rows.

The mobile field profile is a dedicated, foreground, screen-awake device with
validated power/battery reserve, approved wired/USB output and documented
mount/body-worn/Guided Access or MDM practice. Intercom/radio remains the urgent
path.

Each profile tests foreground operation and wake-lock loss/reacquisition,
reload/crash, screen lock/wake, app switch, notification interruption, camera
use, microphone acquire/record/release, audio-focus/echo-processing/route/gain/
latency changes, output unplug/replug, permission reset, roaming, ICE restart,
backend restart, thermal state and full-performance battery endurance.
Background listening is unsupported in version one.

For version one, moving the browser to the background or locking the device is
expected to suspend or interrupt monitoring. The release requirement is that
Live detects loss/suspension, never implies audio is still being monitored, and
recovers clearly when returned to the foreground. Continuous background audio
is deferred even if a particular browser happens to allow it.

If no foreground iPad/browser profile meets the latency targets, survives a
full reference-performance lifecycle without manual recovery, restores media/
control within the roaming target, or provides safe output selection, Phase 0B
opens a native-client ADR. Making locked/background listening or reliable
background paging a core promise also triggers that ADR. Deliberate background
failure alone does not trigger native work while the foreground profile meets
the accepted product promise.

Published compatibility covers a bounded browser/iPadOS version range, unknown-
version pre-show warning/block policy, requalification cadence and emergency
workaround. Automatic browser/OS updates cannot silently inherit a validated
claim.

## Network impairment profiles

| Profile | Conditions | Expected behavior |
| --- | --- | --- |
| Nominal wired | RTT <= 5 ms, loss <= 0.01%, low jitter | Meet low-latency release targets. |
| Venue Wi-Fi | RTT p95 <= 30 ms, random loss <= 1%, jitter <= 15 ms, bursts up to 3 packets | Continuous usable monitoring with visible metrics. |
| Stress | loss up to 3%, jitter up to 50 ms, reordering 0.1%, short roam outage | No crash or control corruption; audible degradation and recovery are allowed and reported. |

The executable manifest records direction, base delay and distribution, loss
and burst model/parameters, jitter distribution, reordering, duplication,
corruption, bandwidth, queue limit, and every outage or roam interval. Human
labels such as `venue Wi-Fi` are never sufficient evidence. These profiles are
starting definitions and may be changed only with a linked benchmark/ADR.

## Full-load profile

Capacity tests combine, rather than separately benchmark:

- maximum validated input channels;
- worst approved analysis set and meter rate;
- active replay writer and simultaneous replay readers;
- eight independent worst-case monitor buses and encoders;
- complete receiver fleet telemetry and reconnect storm;
- backend state and event persistence; and
- maximum text message/subscription fan-out, page storm, attachment upload/
  hostile decode, asset/database/audit write pressure and optional transcription;
- Manager plus Live clients on the reference appliance/network.

The resource envelope records reserved memory, maximum inputs per bus, queue
depths, encoder deadlines, concurrent replay limit, thermal state, disk budget,
and deterministic admission thresholds.

Capacity qualification includes a declared-maximum-plus-one attempt. The
additional client must be rejected without interrupting existing media or
exceeding any declared resource ceiling.

The declared collaboration envelope includes maximum messages/history,
conversations, open tasks/incidents, pages/rate, attachment bytes/pixels/voice
duration, processing concurrency, asset quota, subscription fan-out and audit
rate. Every rejection is bounded and lower-priority work sheds in the order
defined by ADR 0007.

## Reliability evidence

Before limited beta:

- at least five independent 24-hour full-load soaks with zero callback
  underruns and no unexplained discontinuities;
- at least 500 aggregate instrumented lab hours across supported profiles;
- 20 cold boots and 20 controlled plus abrupt power cycles;
- repeated driver, worker, backend, network, disk, and receiver failure tests;
- spare-appliance restore and certificate/clock-expiry drills; and
- every release-blocking recovery target demonstrated on named hardware.

Phase 0B adds both-OS storage power-cut/restore and installed-package update,
interruption and rollback rows. An application slot is not activated until
migration, startup, selected-device open and API health gates pass; the prior
slot and compatible database state remain recoverable.

These are minimum evidence thresholds, not statistical proof of zero failures.
Field show-hours and incidents remain part of each compatibility record.

## Security and protocol gates

The release matrix includes authorization negatives, parser fuzzing, malformed
imports, token replay, TLS/certificate expiry and revocation, update tampering,
rollback, disk exhaustion, clock skew, LAN connection storms, secret leakage,
snapshot/delta gaps, duplicated commands, and activation conflict tests.
