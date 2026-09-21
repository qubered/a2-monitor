# Shure wireless integration specification

**Status:** Proposed

**Research checked:** 2026-09-18

## Local MVP implementation

The macOS MVP includes bounded read-only command-string clients for multiple
Manager-configured receivers. Manager now records an explicit model for each
unit (from the coverage matrix below), an explicit control-network IP, and an
optional name; channel count is derived from the model except for the
dynamically-licensed ANX4. The adapter looks up a per-model capability
profile (`packages/protocol/receivers/shure-models.ts`) and a per-family
command-string table (`services/listen-gateway/src/shure.ts`) before it opens
a connection, so it only issues `GET`/`SET` commands the selected model is
expected to support.

Each unit queries `MODEL` and `FW_VER`, then, gated by the model's capability
profile: transmitter identity (`CHAN_NAME`, `FREQUENCY`, `TX_TYPE`/`TX_MODEL`),
battery (`BATT_BARS`/`TX_BATT_BARS`, `BATT_CHARGE`/`TX_BATT_CHARGE_PERCENT`,
and — where the family exposes it — battery type/cycle count/runtime), RF
level and antenna diversity state, channel/link quality (Axient Digital's
0–5 `CHAN_QUALITY`, expressed to the UI as a percentage of that scale),
interference detection, a receiver audio meter, and transmitter mute state.
Values are converted to dBm/dBFS only where the vendor's own documentation
states a conversion formula; everywhere else the raw vendor scale is kept
and labelled as such, never relabelled as a physical unit. Unsupported
metrics stay `null`/`unavailable`, never a fabricated zero. The client
accepts fragmented/coalesced unsolicited `REP` frames and exposes freshness
per channel. Manager stores the receiver inventory in the local showfile and
the gateway reconciles additions, removals and edits without restarting
audio.

This client currently runs in the listen-gateway process under ADR 0023 because
the dedicated adapter process/IPC is not built. It is parser/simulator evidence,
not physical receiver evidence; every tuple remains unverified and is labelled
`compatible-read-only`. The exact command-string property names come from
Shure's published network command-string references for Axient Digital,
ULX-D, QLX-D and SLX-D; ANX4 and SLX-D+ have no published command-string
reference and reuse the closest documented family (Axient Digital and SLX-D
respectively) as a best-effort placeholder pending vendor documentation or a
hardware-in-loop capture. QLX-D's RF level is only published as part of a
packed `SAMPLE` meter message rather than a plain scalar property, so this
client leaves it `unavailable` rather than guess at the packed layout; a
future revision can add `SAMPLE` parsing once the exact per-family field
grammar is confirmed. Every property name, offset and enum mapping here is a
required or optional command probe for that model's hardware acceptance test,
per the "Firmware support" section below.

## Decision

The audio node will implement Shure's receiver command-string protocol as the
primary transport for networked rack receivers. The controller opens a TCP
connection to the receiver's Shure Control address on port 2202, discovers
`MODEL` and `FW_VER`, fetches full state, consumes unsolicited reports, and
enables metering explicitly.

The protocol is plaintext and does not authenticate the controller. It is a
local-production-network exception to the secure default: receiver addresses
must be allowlisted, the network must not be exposed to audience/client Wi-Fi,
and write commands remain disabled until separately approved.

Shure SystemAPI is an optional later transport for compatible ULX-D and QLX-D
installations. It is not the common adapter foundation because its current
Windows service and device/firmware matrix do not cover all target Shure
families. The normalized domain contract remains identical whichever transport
is selected.

## Receiver coverage matrix

“Planned” means the model is in adapter scope; it becomes `verified` only after
the exact firmware tuple passes the hardware suite.

| Family                 | Receiver model                |                         Channels | Direct node path                               | Planned state and notes                                                                                                                                      |
| ---------------------- | ----------------------------- | -------------------------------: | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Axient Digital         | AD4D and AD4D-DC              |                                2 | TCP 2202                                       | Planned; DC-power and regional variants share the profile unless their reported behavior differs.                                                            |
| Axient Digital         | AD4Q and AD4Q-DC              |                                4 | TCP 2202                                       | Planned; include Quadversity and frequency-diversity capabilities when reported.                                                                             |
| Axient Digital / ULX-D | ANX4, including DC-power SKUs | Dynamic: up to 16 AD or 24 ULX-D | TCP 2202                                       | Planned; discover licensed/available channels and Axient Digital versus ULX-D operating mode. Never assume a fixed count or that both modes run at once.     |
| Axient Digital         | ADX5D                         |                       2 portable | No ordinary receiver-Ethernet path established | Listed as conditional/unsupported for direct v1 integration. Networked WWB use depends on its supported accessory/workflow and needs a separate proven path. |
| ULX-D                  | ULXD4                         |                                1 | TCP 2202                                       | Planned; no Dante audio on the single receiver, but network control is supported.                                                                            |
| ULX-D                  | ULXD4D                        |                                2 | TCP 2202                                       | Planned; this and ULXD4Q are sometimes informally called “ULXD4DQ”; they are separate models.                                                                |
| ULX-D                  | ULXD4Q                        |                                4 | TCP 2202                                       | Planned.                                                                                                                                                     |
| ULX-D Government       | ULXD4-GV                      |                                1 | TCP 2202                                       | Planned as an explicit variant; permanently enabled encryption behavior must be represented.                                                                 |
| ULX-D Government       | ULXD4D-GV                     |                                2 | TCP 2202                                       | Planned as an explicit variant.                                                                                                                              |
| ULX-D Government       | ULXD4Q-GV                     |                                4 | TCP 2202                                       | Planned as an explicit variant.                                                                                                                              |
| QLX-D                  | QLXD4                         |                                1 | TCP 2202                                       | Planned; capability set is smaller than Axient Digital and must stay model-specific.                                                                         |
| SLX-D                  | SLXD4                         |                                1 | TCP 2202                                       | Planned legacy-generation profile; controller access must be enabled on the receiver.                                                                        |
| SLX-D                  | SLXD4D                        |                                2 | TCP 2202                                       | Planned legacy-generation profile; controller access must be enabled.                                                                                        |
| SLX-D                  | SLXD5                         |                       1 portable | No direct Ethernet path                        | Listed but unsupported for direct v1 integration.                                                                                                            |
| SLX-D+                 | SLXD4+                        |                                1 | TCP 2202                                       | Planned as a distinct protocol profile from legacy SLX-D.                                                                                                    |
| SLX-D+                 | SLXD4D+                       |                                2 | TCP 2202                                       | Planned.                                                                                                                                                     |
| SLX-D+                 | SLXD4Q+                       |                                4 | TCP 2202                                       | Planned; non-Dante quad receiver.                                                                                                                            |
| SLX-D+                 | SLXD4QDAN+                    |                                4 | TCP 2202                                       | Planned; Dante-capable quad receiver.                                                                                                                        |
| SLX-D+                 | SLXD5+                        |                       1 portable | No direct Ethernet path established            | Listed but unsupported for direct v1 integration. Bluetooth/mobile support is not treated as a server integration API.                                       |

Frequency-band and country SKUs are covered by their base receiver row unless
the hardware reports a distinct model or the protocol differs. The manifest
will retain the observed SKU/band for diagnostics without multiplying adapter
implementations unnecessarily.

### Legacy and adjacent Shure scope

The compatibility catalogue must reserve explicit entries for legacy AXT400
Axient and UR4S/UR4D UHF-R receivers because they remain relevant in rental
inventories, but they are backlog profiles until hardware and supported
protocol documents are available. PSM in-ear transmitters, AD600 spectrum
management, AD610 ShowLink infrastructure, chargers, and access points are
useful future integrations, not receiver channels, and will use separate
domain capabilities.

## Capability profiles

The adapter uses a common event envelope, not a lowest-common-denominator
payload. A capability descriptor determines what the Live UI renders.

| Capability                 |               AD4D/Q               |                 ANX4                 |           ULXD4/D/Q            |       QLXD4        |   SLXD4/D    |       SLX-D+ rack       |
| -------------------------- | :--------------------------------: | :----------------------------------: | :----------------------------: | :----------------: | :----------: | :---------------------: |
| Frequency / link state     |                Yes                 |                 Yes                  |              Yes               |        Yes         |     Yes      |           Yes           |
| Per-antenna RF / RSSI      |                Yes                 |                 Yes                  |              Yes               |  Vendor-scale RF   |     RSSI     |          RSSI           |
| Channel/link quality       |                Yes                 |                 Yes                  |    Model/firmware dependent    |         No         |      No      |           No            |
| Interference state         |                Yes                 |                 Yes                  |              Yes               |    Limited/none    | Limited/none |           Yes           |
| Receiver audio meter       |              Peak/RMS              |               Peak/RMS               |          Vendor meter          |    Vendor meter    |   Peak/RMS   |        Peak/RMS         |
| Battery bars/runtime       |                Yes                 |                 Yes                  |              Yes               |        Yes         |     Yes      |           Yes           |
| Battery health/cycles/type |                Rich                |                 Rich                 |       Model/TX dependent       | Model/TX dependent |   Limited    | Limited/model dependent |
| Rich transmitter slots     |          AD/ADX dependent          |          Mode/TX dependent           |          TX dependent          |    TX dependent    |   Limited    |      TX dependent       |
| Receiver mode features     | Quadversity, FD, transmission mode | Axient/ULX-D mode, licensed channels | HD/FD/audio summing by chassis |      Limited       |   Limited    |     Model dependent     |

This table is a design scope, not a guarantee for every firmware. At runtime,
required-command probing and the compatibility manifest are authoritative.
Unsupported values are `unavailable`, never zero.

Linked transmitter catalogues are non-gating. Known Axient Digital, ULX-D,
QLX-D, and SLX-D bodypack, handheld, plug-on, boundary, and gooseneck models
receive friendly names, while any new model string remains visible and usable.

## Manager and Live behavior

The Manager app presents every discovered receiver with exact model, firmware,
control address, compatibility state, mode, channel count, and capability
summary. It supports explicit approval, source/audio/radio binding, safe test
connection, and model-specific setup guidance such as enabling controller
access. Secrets and raw protocol fields are not returned to the browser.

The Live app gives Shure channels the same operator experience as EW-DX:

- source identity and listen controls remain primary;
- AF, RF, battery, mute, link, diversity, interference, and warning indicators
  appear when supported;
- transmitter model/ID and receiver channel remain inspectable;
- unavailable metrics show a clear `N/A`/unsupported state, never a healthy
  zero or a fabricated score;
- stale telemetry is visually distinct from a low measured value; and
- alert rules are offered only for capabilities the active profile supplies.

PCM audio monitoring remains independent of receiver control. Losing Shure
telemetry must not stop listening to an already-bound DVS or USB input, and an
audio-source failure must not erase the receiver's RF evidence.

## Connection behavior

For each receiver connection the adapter must:

1. connect only to the configured Shure Control address;
2. request model and firmware before selecting a parser profile;
3. enumerate the actual logical channels and, for ANX4, licensed/available
   capacity and current operating mode;
4. issue the profile's complete-state query and wait for a coherent snapshot;
5. request the selected meter rate, keeping high-rate samples on the node;
6. publish normalized deltas with receive and device/source timestamps;
7. keep parsing unsolicited reports without assuming request/response order;
8. detect stalled metering separately from a dead control connection; and
9. reconnect with jittered backoff and republish one atomic snapshot.

The parser must accept TCP fragmentation and coalescing, unknown additive
properties, and unsolicited `REP` messages. It must bound buffers and reject
invalid channel numbers or lengths. A receiver's numeric meter scale is
retained as a vendor value unless official documentation defines a conversion
to dBm or dBFS.

Receiver telemetry can run at the vendor-supported cadence (commonly up to
10 Hz for command-string meters), while PCM-derived meters can update faster.
Neither path may enter the real-time audio callback.

## Implementation sequence

1. Build one bounded TCP command-string transport, transcript recorder, and
   simulator harness.
2. Prove ULXD4D/ULXD4Q and QLXD4, which exercise multi-channel and reduced
   capability profiles.
3. Add AD4D/AD4Q rich telemetry and mode features.
4. Add legacy SLXD4/SLXD4D and the separate SLX-D+ rack profiles.
5. Add ANX4 dynamic licensing, 16/24-channel scaling, and operating-mode tests.
6. Evaluate ADX5D-through-AD610 and legacy AXT400/UR4 paths without coupling
   them to the rack-receiver release gate.

## Firmware support

No broad statement such as “all ULX-D firmware” is acceptable. Initial
implementation work creates one manifest row for every receiver above and
records:

- the oldest physical firmware validated;
- the latest physical firmware validated;
- excluded releases and known defects;
- required and optional command probes; and
- coexistence results with the current supported Wireless Workbench release.

Recognized firmware outside the physically tested range starts in
`compatible-read-only`; an unknown major version starts `unsupported`.
SystemAPI, if added, follows its own vendor-published minimums and is not used
to imply direct-command compatibility. At the time of this research, Shure's
SystemAPI feature-interactivity table lists QLXD4 from 2.5.2 and ULXD4/D/Q from
2.7.x; older versions have reduced SystemAPI behavior.

## Acceptance tests

Every model promoted from `planned` to a supported release profile needs a
physical test at the oldest claimed and latest available firmware. Hardware
that cannot be obtained remains explicitly planned/unverified and cannot be
waived into the supported matrix. Phase 2 is blocked only by the named pilot
tuples; completing every catalogue row remains Phase 3 scope. For each promoted
profile, the release gate is:

- exact identity and channel enumeration;
- initial state, transmitter swap, mute, frequency, battery, RF, and AF updates;
- interference and enhanced metrics where the model claims them;
- 12-hour metering soak with no unbounded memory growth;
- receiver reboot, cable pull, DHCP/address change, and node restart recovery;
- simultaneous monitoring from Wireless Workbench and the audio node; and
- read-only safety verification, including rejected unauthorized writes.

If simultaneous third-party control proves unsafe for a model/firmware tuple,
the manifest must state the conflict and the Manager must prevent activation.

## Primary sources

- [Shure command strings: Axient Digital AD4](https://www.shure.com/en-US/docs/commandstrings/AD4)
- [Shure command strings: ANX4](https://www.shure.com/en-US/docs/commandstrings/ANX4)
- [Shure ANX4 product and licensed channel capacities](https://www.shure.com/en-US/products/wireless-systems/anx/anx4)
- [Shure ADX5D network-mode guide](https://pubs.shure.com/view/guide/ADX5D/en-US.pdf)
- [Shure command strings: ULX-D](https://www.shure.com/en-US/docs/commandstrings/ULXD)
- [Shure ULX-D Government variants](https://www.shure.com/en-US/insights/ulxd-gv-wireless-system-with-always-on-encryption-provides-enhanced-security-for-government-military-and-corporate-users)
- [Shure QLX-D network command strings](https://content-files.shure.com/Pubs/qlxd4/qlx-d-network-string-commands.pdf)
- [Shure command strings: SLX-D](https://www.shure.com/en-US/docs/commandstrings/SLXD)
- [Shure command strings: SLX-D+](https://www.shure.com/en-US/docs/commandstrings/SLXDplus)
- [Shure third-party controller connection guidance](https://service.shure.com/Service/articles/en_US/Knowledge/crestron-amx-connection-problems-to-shure-products)
- [Shure Wireless Workbench ports and protocols](https://service.shure.com/articles/en_US/Knowledge/wwb6-ports-and-protocol-information)
- [Shure SystemAPI](https://www.shure.com/en-US/products/software/systemapi)
- [Axient Digital receiver family](https://www.shure.com/en-US/products/wireless-systems/axient_digital)
- [ULX-D receiver family](https://www.shure.com/en-US/products/wireless-systems/ulx-d_digital_wireless)
- [QLX-D receiver family](https://www.shure.com/en-US/products/wireless-systems/qlx-d_digital_wireless)
- [SLX-D+ receiver family](https://www.shure.com/en-US/products/wireless-systems/slxd-plus)
