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
- one canonical sequencer owns runtime command order and durable acceptance;
- a least-privilege client gateway validates leased data-channel commands but
  cannot commit state independently;
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

## Implementation baseline

- Rust 2024 on the repository-pinned stable toolchain;
- a project-owned host interface with CPAL as the Phase 0A ASIO/WASAPI/Core
  Audio adapter;
- page-separated fixed shared-memory PCM rings and codec-neutral bounded pipe/
  socket control IPC; bounded JSON versus Protobuf is a Phase 0T measurement;
- upstream `libopus` and `str0m`, with explicit OS crypto features, in an
  isolated Phase 0B media worker;
- bundled `rusqlite` for the node control ledger; and
- supervised Rust replay and receiver-adapter workers.

CPAL and `str0m` are reference implementations, not compatibility claims. ADR
0014 and ADR 0017 define the evidence and targeted replacement rules.

Capture frame and epoch—not wall clock—drive RTP timestamps. A media-worker
restart creates fresh peer/RTP generations and reconnects clients without
stopping capture. The full normative process, time and ABI rules are linked
from the architecture index.

## Current Phase 0T scaffold

The runnable native scaffold now contains:

- `crates/audio-host-api`, a project-owned device and capture callback boundary
  with no CPAL or platform type in its public interface;
- `crates/audio-core`, a fixed-capacity in-process SPSC PCM ring whose storage
  is allocated before capture;
- `services/audio-node`, a deterministic synthetic host and smoke binary; and
- `crates/supervisor`, a deterministic native-worker lifecycle policy with
  boot/generation fencing, role-specific readiness gates, bounded heartbeats,
  restart/quarantine, and confirmed-death shutdown deadlines behind injected
  process and clock boundaries.

The callback path and ring push are covered by an allocation-counting test
after setup. The callback types expose no lock or I/O facility, and the current
implementation contains no locking primitive on that path; this is structural
review evidence, not a general runtime proof that future code cannot block.
The synthetic host advertises one exact 64-channel, 48 kHz test tuple and
rejects every other device, rate, channel and block request. Cloned handles
share one atomic open claim, so only one input stream can own the synthetic device. A
successful reopen receives a new nonzero capture epoch; failed and busy opens
do not consume an epoch. Streams retain both the requested and resolved tuple,
which are equal for this synthetic adapter. The host passes the resolved tuple
to a control-thread callback factory before downstream rings or callback
resources are constructed. Device ownership is released by an explicit
control-thread close or by dropping the stream, not by stopping it or by a
callback requesting stop. Clones share one node-boot epoch namespace;
independently constructed hosts represent separate node boots and pair their
epochs with the node boot identifier in production metadata.

When the in-process ring is full it drops the newest block and increments a
counter so published storage is never overwritten. This is deliberately not
the page-separated shared-memory ABI, whose overwrite-oldest policy and hostile
consumer tests remain separate Phase 0T/0D work.

Run the native checks and deterministic smoke path from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo run --locked --bin a2-synthetic-capture
```

This scaffold does not open a physical device and provides no latency,
stability, hardware-support, or real-time scheduling evidence.
Its exclusive-open, tuple and epoch checks are synthetic contract tests only;
they do not demonstrate equivalent behavior from ASIO, WASAPI, Core Audio,
DVS, CPAL or any professional interface.
The supervision adapter likewise does not yet claim restricted OS child
creation, launchd/XPC integration, privilege separation, or production health
IPC; those remain platform evidence work.
