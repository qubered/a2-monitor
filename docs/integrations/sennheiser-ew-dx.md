# Sennheiser EW-DX integration specification

**Status:** Proposed

**Research checked:** 2026-09-18

## Receiver coverage matrix

| Receiver model | Channels | Network audio | Firmware/transport plan |
| --- | ---: | --- | --- |
| EW-DX EM 2 | 2 | Analogue only | Firmware 4.0+ through authenticated SSCv2/OpenAPI; pre-4 SSCv1 is legacy opt-in. |
| EW-DX EM 2 Dante | 2 | Dante | Firmware 4.0+ through authenticated SSCv2/OpenAPI; pre-4 SSCv1 is legacy opt-in. |
| EW-DX EM 4 Dante | 4 | Dante | Firmware 4.0+ through authenticated SSCv2/OpenAPI; pre-4 SSCv1 is legacy opt-in. |

Regional frequency ranges and power-cord variants map to the base model unless
the reported protocol identity or behavior differs.

## Transport and firmware policy

Firmware 4.0 and later uses the documented EW-DX OpenAPI over SSCv2. Third-party
access is disabled by default on the receiver and must be deliberately enabled;
credentials remain only in the audio node's protected secret store.

Firmware before 4.0 uses SSCv1. Because that path lacks the SSCv2 security
properties, it is never auto-enabled. An operator must opt in at the node,
acknowledge a persistent warning, and keep the receiver network isolated. The
oldest supportable firmware is not guessed: it will be established from
physical hardware and recorded in the compatibility manifest.

For known but untested firmware inside the same protocol generation, the
adapter starts read-only and probes required properties. Unknown future major
versions remain unsupported until reviewed.

## Normalized capability target

Where the selected model/firmware exposes them, publish:

- RF level/RSSI with the documented unit;
- reception quality/RSQI and diversity state;
- receiver-channel audio level;
- frequency, mute, link, sync, and transmitter identity;
- battery state and remaining-time information;
- device/channel warnings and interference indications; and
- receiver and transmitter firmware/identity diagnostics.

The runtime capability descriptor is authoritative. SSCv1 and SSCv2 may expose
different field shapes or update behavior; the adapter normalizes them without
claiming unavailable values. Credentials and raw SSC sessions never leave the
node.

## Acceptance tests

Each chassis and firmware profile must pass identity, full-state, subscription,
metering, transmitter swap, battery, RF/AF, warning, reconnect, credential
failure, and 12-hour soak tests. SSCv1 and SSCv2 are separate test matrices.
Test the oldest supported and latest available firmware on physical receivers,
including connection-limit, startup-storm, and coexistence behavior with the
supported Sennheiser management software. Unobtainable firmware remains
unverified rather than receiving a waived claim.

## Primary sources

- [Sennheiser EW-DX OpenAPI](https://docs.cloud.sennheiser.com/en-us/api-docs/api-docs/open-api-ew-dx.html)
- [Sennheiser Sound Control Protocol versions](https://docs.cloud.sennheiser.com/en-us/api-docs/api-docs/sound-control-protocol.html)
- [Sennheiser EW-DX third-party access](https://docs.cloud.sennheiser.com/en-us/tc-bar/control-cockpit/ew-dx-access.html)
