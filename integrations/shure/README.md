# Shure wireless adapter

This audio-node adapter will translate Shure receiver command strings into the
normalized device, radio-link, transmitter, battery, meter, warning, and
capability events defined by the shared protocol.

## Planned receiver profiles

- Axient Digital: AD4D/AD4D-DC and AD4Q/AD4Q-DC;
- scalable Axient Digital/ULX-D: ANX4, with dynamic licensed-channel discovery
  and operating-mode awareness;
- ULX-D: ULXD4, ULXD4D, ULXD4Q, and the corresponding `-GV` variants;
- QLX-D: QLXD4;
- SLX-D: SLXD4 and SLXD4D; and
- SLX-D+: SLXD4+, SLXD4D+, SLXD4Q+, and SLXD4QDAN+.

Portable ADX5D, SLXD5, and SLXD5+ receivers remain explicit catalogue entries
but are not direct-v1 targets because an ordinary receiver-Ethernet control path
has not been established.

The TCP 2202 transport is local to the audio node and is treated as plaintext,
unauthenticated control. Monitoring is the initial scope; mutating commands are
disabled unless separately designed, permissioned, and audited.
