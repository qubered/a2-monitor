# Testing strategy

## Test layers

### Unit tests

Cover pure DSP, unit conversion, alert rules, schema validation, state reducers,
permissions, and show-file migrations. Tests must be deterministic and use
fixed seeds for generated signals.

Audio-device tests cover enumeration, stable identity, sample conversion,
channel layouts, one-device enforcement, capture epochs, and bounded resampling
for ASIO, WASAPI, and Core Audio abstractions.

### Contract tests

Every node/backend, backend/frontend, and adapter/domain contract needs:

- valid and invalid fixtures;
- version compatibility tests;
- unknown/additive-field behavior;
- reconnect and duplicate-message behavior; and
- clock/timestamp edge cases.

Show-domain contracts additionally cover cast and microphone swap
preview/commit, prepared/physical/unverified/RF-audio/A1-confirmed stages,
physical-first late entry, multi-role cast plans, idempotent retry, stale
authority epochs/aggregate revisions, bitemporal boundaries, historical replay
identity, offline activated-pool authorization, and backend reconciliation.

Cue contracts cover definition versus occurrence, absolute expected-state
snapshots, GO/start/audition/playhead distinction, duplicate/drop/reorder,
back/skip/repeat/hold/resync, scheduled-transaction revalidation and stale/
unknown suppression of every cue-derived alert/view.

Collaboration contracts cover server message order, idempotent send, reconnect
and duplicate delivery, correction/tombstone history, read-cursor monotonicity,
presence expiry, page acknowledgement/rate limits, historical identity snapshots
and retention. Task/incident claim races prove that chat reactions and read
receipts cannot alter ownership or lifecycle.

Generate negative object-level authorization cases from the collaboration
matrix for every resource ID, relationship, subscription topic, signed asset
URL, search/export path and midstream revocation. Crash after each database/
outbox/asset-ready write step proves the documented durable acceptance boundary.

### Integration tests

Use synthetic audio devices and receiver simulators for routine CI. Maintain a
separate hardware-in-loop suite for DVS, supported USB devices, every claimed
EW-DX and Shure receiver/firmware profile, target browsers, and network
appliances. A compatibility claim records the exact hardware, firmware, adapter
version, and test evidence.

Receiver simulators must cover fragmented/coalesced transport messages,
unsolicited updates, meter activation, dynamic channel counts, missing
capabilities, malformed values, reconnects, and unknown additive fields. They
support development but do not promote a profile to `verified` without a
physical hardware run.

Integration coverage also includes snapshot/delta gaps, duplicated commands,
activation prepare/commit conflicts, authority fencing/takeover, durable ledger
reserve exhaustion, lease expiry/proof-of-possession/replay, backend
reconciliation, replay-reader isolation and process crash containment.

A representative two-operator scenario runs the A1 mix-confidence workspace and
A2 intervention workspace concurrently: either operator raises an incident,
the A2 claims and diagnoses it from linked replay/telemetry, records a swap or
placement action, and the A1 confirms or rejects mitigation without losing cue
context. Guided mic check, a 10–20 second pack change, intervention windows,
cue drift/resync, simultaneous faults, locked client, multi-role swing cascade,
accepted handoff, priority paging, attachment validation, unsent drafts during
backend loss and post-recovery ordering are included. Working theatre operators
perform the dress-rehearsal study while the A1 continues mixing; report wrong-
source actions, time-to-audition, verbal clarifications and abandoned work.

### Performance tests

- physical loopback latency;
- callback deadline and underrun instrumentation;
- meter/render load at full channel count;
- replay write/read/rollover;
- client admission/resource limits; and
- chat fan-out, page/upload storms, hostile media decode, database/asset/audit
  pressure, transcription gating and deterministic priority shedding; and
- controlled loss, jitter, reordering, outage, and reconnect.

### Soak and chaos tests

Run for at least the durations in the performance baseline while:

- restarting backend and frontend services;
- disconnecting and reconnecting receivers;
- renewing addresses where supported;
- filling and rolling replay storage;
- adding/removing clients within capacity;
- exhausting each per-process and disk-reservation quota;
- degrading the client network; and
- verifying the node remains bounded.

Before limited beta, the combined supported profile runs at least five
independent 24-hour soaks and 500 aggregate instrumented lab hours, plus cold
boot, power-cut, certificate, update/rollback, disk-corruption, and spare-restore
cycles. See [the validation matrix](validation-matrix.md).

### Security tests

Fuzz vendor and shared-protocol parsers. Exercise authorization denials, CSRF,
XSS/CSP, upload/import limits, archive traversal/bombs, token replay, certificate
expiry/revocation, hostile discovery, LAN connection storms, secret/log leakage,
update tamper/downgrade/interruption, disk exhaustion, and clock skew.

Image tests enforce upload-byte and decoded-pixel limits, safe decoding and
re-encoding, EXIF/GPS stripping, malformed/polyglot rejection, authorization,
variant access, retention, deletion and diagnostic/export redaction.
Voice-note and message tests add duration/codec bounds, stored-content escaping,
conversation authorization, mention/page abuse limits and sensitive export
redaction.

## Test data

Prefer generated speech-like signals, tones, impulses, silence, clipping,
dropouts, RF event fixtures, and explicitly licensed recordings. Real show
material requires documented consent, restricted storage, and a retention date.

## Reproducibility

Every failed hardware/performance run should produce a sanitized manifest with
configuration, versions, timestamps, metrics, and artifact checksums. Avoid raw
audio capture unless it is necessary and approved.
