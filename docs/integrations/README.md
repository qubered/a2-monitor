# Receiver integration standard

**Status:** Proposed

Receiver adapters run inside the audio node. A browser or backend service must
never open a vendor-control connection directly. This keeps credentials,
insecure legacy protocols, reconnect behavior, and hardware-specific rate
limits at the trusted edge of the system.

The management backend owns desired receiver inventory, channel mappings, show
revision, and policy. The node owns physical discovery, local addresses,
credentials, sessions, live capability state, and last-known activated
configuration. It must continue monitoring the active show during a backend
outage.

## Adapter contract

Every adapter must expose the same lifecycle:

1. discover or connect to an explicitly approved endpoint;
2. identify the exact model, firmware, operating mode, and logical channels;
3. match that identity against the compatibility manifest;
4. fetch a complete initial state before publishing the device as ready;
5. subscribe to change notifications and explicitly enable metering;
6. normalize supported values without inventing unavailable values; and
7. reconnect with bounded exponential backoff and rebuild state atomically.

An adapter publishes:

- device identity, connection health, firmware, mode, and clock timestamps;
- a dynamic list of receiver channels;
- frequency, link state, RF level, quality, diversity, and interference state;
- audio peak/RMS when the receiver supplies it;
- linked-transmitter identity, mute/power state, and battery telemetry;
- vendor warnings and normalized warnings; and
- a capability descriptor for every field and action.

Meter samples from a receiver and meters calculated from captured PCM are
different sources. They retain separate source labels and timestamps even when
the Live UI displays them together.

## Compatibility policy

Support is claimed for a tuple, not a marketing family:

`vendor + exact model + firmware range + operating mode + adapter version`

Each tuple has one of these states:

| State | Behavior |
| --- | --- |
| `verified` | Tested on physical hardware; monitoring and approved controls are enabled. |
| `compatible-read-only` | Protocol is recognized but this firmware/model tuple has not completed hardware validation; safe monitoring only. |
| `legacy-opt-in` | An older or insecure transport that requires an explicit node setting and persistent warning. |
| `unsupported` | No reliable direct integration path or an unknown incompatible protocol; never guess. |

An unknown patch/minor release may enter `compatible-read-only` only when the
protocol handshake and required-command probe pass. An unknown major release
is `unsupported` until reviewed. The UI must show the state and reason.

Regional frequency bands, AC/DC power variants, and sales-region suffixes map
to the same profile when the reported control model and behavior are
identical. They become separate tuples if testing finds a protocol difference.

The compatibility manifest records:

- exact model strings and aliases returned by hardware;
- minimum, maximum-tested, and excluded firmware versions;
- transport and security properties;
- dynamic channel-count and operating-mode rules;
- available metrics/actions and their units;
- hardware, fixture, and soak-test evidence; and
- the date and source used for the claim.

“All versions” therefore means every known chassis and relevant transport is
listed, including a truthful unsupported or unverified state. It does not mean
silently promising compatibility with untested future firmware.

## Normalization rules

- RF power is dBm when the vendor provides dBm. Vendor scales remain explicitly
  named raw fields and are never relabelled as dBm.
- Audio level is dBFS when available. Integer vendor meter scales remain raw.
- Frequency is integer hertz.
- Battery remaining time is an integer duration plus an availability reason.
- Each value carries `observedAt`, `receivedAt`, `source`, `quality`, and
  `availability`.
- Missing channel quality, battery health, or interference classification is
  `unavailable`; it is not inferred from a different metric without a named,
  versioned derived signal.
- Transmitter model strings are preserved even when a new transmitter is not
  yet in the friendly-name catalogue.

## Control and security baseline

Monitoring is the default. Mutating commands require an explicit capability,
role permission, rate limit, confirmation policy, and audit event. Discovery
never makes an unknown device controllable.

Receiver networks should be isolated from client Wi-Fi. The node uses an
allowlist of receiver addresses, restricts egress, bounds frame/message sizes,
redacts credentials and secrets, and does not forward raw vendor sessions.
Plaintext or unauthenticated protocols are clearly marked and never routed
beyond the local production network.

## Required tests

Every model/firmware profile needs:

- parser fixtures for complete, fragmented, coalesced, malformed, and unknown
  messages;
- initial-state and reconnect transcripts;
- channel-count, mode-change, and transmitter-swap tests;
- missing/partial telemetry behavior;
- meter enable/disable and rate-limit tests;
- disconnect, address-change, and duplicate-notification tests;
- a hardware-in-loop identity and capability run; and
- a long-running coexistence test with the vendor's supported management tool.

Catalogue coverage and release support are separate. A model may be documented
as planned or unsupported without blocking a release; only explicitly named
release profiles can become gates, and none becomes `verified` without physical
evidence.

Vendor protocol examples may be used to author original fixtures, but vendor
schemas, manuals, or large captured datasets must not be copied into the repo
without checking redistribution rights.
