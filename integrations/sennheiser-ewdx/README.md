# Sennheiser EW-DX adapter

This adapter converts the supported Sennheiser SSC interface into normalized
receiver, radio-link, transmitter, battery, meter, warning, and capability
events.

## Planned receiver profiles

- EW-DX EM 2;
- EW-DX EM 2 Dante;
- EW-DX EM 4 Dante; and
- firmware 4.0 or later through authenticated SSCv2/OpenAPI.

Pre-4.0 SSCv1 is a listed `legacy-opt-in` profile rather than an invisible gap.
It requires isolated configuration, physical firmware validation, and a
persistent UI warning. Unknown future major versions remain unsupported until
reviewed.

The hardware-facing adapter runs at the audio-node boundary. Credentials stay
local to the node's protected secret store. The backend receives normalized
state and capability descriptions, never credentials or raw vendor sessions.

Fixtures derived from vendor schemas must be checked for redistribution rights
before being committed.

See the [full EW-DX specification](../../docs/integrations/sennheiser-ew-dx.md)
and the [common integration standard](../../docs/integrations/README.md).
