# Audio node

The audio node is a headless deployment component installed beside the
production audio and receiver networks. It should feel like an appliance
endpoint, not a second management application. Internally it is several
least-privilege supervised processes, not one large privileged process.

## Owns

- Windows ASIO/WASAPI and macOS Core Audio discovery/capture from exactly one
  explicitly selected device, including DVS and hardware interfaces;
- sample clock and discontinuity detection;
- bounded metering and audio analysis;
- timestamped rolling replay;
- one personal monitor mix per authorized client;
- Opus encoding and WebRTC media endpoint;
- local receiver adapters that require device-network access;
- node capability, health, and diagnostics; and
- a cached immutable active-show revision.

## Process boundary

- the audio engine alone owns the selected device and real-time callback;
- media, replay, receiver adapters, and supervision run in separate failure
  domains with bounded IPC;
- network parsers cannot allocate or block work in the callback; and
- switching device, sample rate, or channel layout closes one capture epoch and
  starts another after identity validation.

## Does not own

- editable show building;
- users, roles, fleet management, or global policy;
- long-term event reporting;
- a general-purpose local UI; or
- cross-node orchestration.

## Availability rule

A temporary backend loss cannot stop capture, replay writing, or established
monitor mixes. An established Live session may continue bounded listen/replay,
cue, verification, and activated-pool emergency-swap commands in its signed
lease. The node reports disconnection, keeps the active revision and performance
overlay, and reconciles state after reconnect. New sessions, inventory creation,
and privileged configuration fail safely until the backend returns.

Implementation language, driver library, IPC, and WebRTC stack require ADRs
from the Phase 0A/0B spikes.
