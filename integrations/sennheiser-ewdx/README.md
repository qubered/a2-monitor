# Sennheiser EW-DX adapter

This adapter converts the supported Sennheiser SSC interface into normalized
receiver, radio-link, transmitter, battery, meter, warning, and capability
events.

## Receiver profiles

Implemented (read-only, `compatible-read-only`, hardware-unverified):

- EW-DX EM 2 Dante, two channels, firmware 4.x through authenticated
  SSCv2/OpenAPI (release 1.7). The adapter lives in
  `services/listen-gateway/src/sennheiser-ewdx.ts`.

Not implemented: the analogue EW-DX EM 2 and the four-channel EW-DX EM 4
Dante. They are refused by product code rather than read as an EM 2 Dante.

Pre-4.0 SSCv1 firmware is refused today with an explicit message. A future
`legacy-opt-in` profile for it would require isolated configuration, physical firmware validation, and a
persistent UI warning. Unknown future major versions remain unsupported until
reviewed.

The hardware-facing adapter runs at the audio-node boundary. Credentials stay
local to the node's protected secret store. The backend receives normalized
state and capability descriptions, never credentials or raw vendor sessions.

Fixtures derived from vendor schemas must be checked for redistribution rights
before being committed.
