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
- `crates/pcm-abi`, a dependency-free page-separated descriptor/region layout,
  consumer-control byte contract and single-threaded hostile-peer state-machine
  model plus a separate atomic in-process SPSC composition model;
- `crates/media`, dependency-free 48 kHz source-frame-to-RTP/RTCP arithmetic
  and media-session identity fencing;
- `services/audio-node`, a deterministic synthetic host, smoke binaries and a
  local-MVP `pulse-device-capture` adapter for one exact 48 kHz Core Audio/WASAPI
  input;
- `pulse-media-worker`, the local-MVP listen transport (ADR 0026). It runs
  `pulse-device-capture` as a child and serves each listener an ICE-lite
  `str0m` session with 10 ms mono Opus of the selected input. Input switches
  crossfade server-side. Given an output device it also renders one shared host
  monitor mix and pipes it to `pulse-device-output` (ADR 0031);
- `pulse-device-output`, the local-MVP host monitor output. It opens one exact
  48 kHz Core Audio/WASAPI output device, copies the worker's mono feed to the
  listed output channels, and reports underruns and dropped frames. The device
  callback only reads a preallocated SPSC ring (`monitor_output`). The reserved
  name `Pulse simulated output` discards the feed; and
- `crates/supervisor`, a deterministic native-worker lifecycle policy with
  boot/generation fencing, role-specific readiness gates, bounded heartbeats,
  restart/quarantine, and confirmed-death shutdown deadlines behind injected
  process and clock boundaries.

The audio-node library also has a bounded in-process worker-control adapter.
It decodes either Phase 0T JSON or Protobuf candidate bytes into the shared v2
semantic type, maps the full boot ID, worker ID, role, generation, readiness
evidence and heartbeat sequence, compares that full tuple with a trusted
connection-bound identity, verifies the claimed role against configured
supervisor state, and only then dispatches ready or heartbeat events. The bound
identity must come from the spawn/connection registry, not the decoded message;
the comparison is a routing fence, not peer authentication. Health probes,
unknown workers, peer mismatches and configured-role mismatches fail before
supervisor mutation. This composes two codec candidates with lifecycle policy;
it does not choose a production codec or provide sockets, peer authentication,
process creation, privilege separation or codec/media work.

The adjacent framed-session model pins that codec and connection-bound identity
for the life of one session and applies the existing big-endian length prefix
with a fixed 512-byte worker-control ceiling. It consumes at most one frame per
call. Any framing, decoding, identity or routing error—and any supervisor result
other than `Accepted`—permanently requires connection close; trailing bytes are
never used to resynchronize. Clean EOF is accepted only between frames and is
not reported as worker process death. This is still an in-process composition
model: it has no socket/pipe/XPC adapter, peer credential/PID binding, partial-
frame timer, response delivery, request replay cache or OS lifecycle bridge.
The unvalidated `request_id` is returned as opaque correlation metadata with an
in-process outcome; zero, repeated and maximum values have no policy meaning.

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
counter so published storage is never overwritten. This remains distinct from
the `pcm-abi` serialized overwrite-oldest state-machine model. Its separate
atomic SPSC model supports bounded in-process composition tests, but is not an
OS mapping or cross-process ABI and is not used by the capture callback.

Run the native checks and deterministic smoke path from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo run --locked --bin a2-synthetic-capture
cargo run --locked --bin a2-synthetic-capture -- --trace-jsonl
cargo run --locked --bin a2-replay-smoke
cargo run --locked --bin a2-media-worker-smoke
```

`a2-replay-smoke` is a deterministic, Cargo-runnable composition harness for
the single-threaded in-memory ingress and replay models. It is not included in
the immutable application slot or process-boundary contract and is not a
deployed, supervised, confined or durable replay worker.

`a2-media-worker-smoke` is a closed, zero-argument Cargo harness joining the
in-process atomic PCM model and pure media-clock arithmetic to the platform-
neutral supervisor policy through deterministic clock and process-driver
doubles. Fixed 48 kHz fixtures cover a source-frame gap, 32-bit RTP wrap,
matching RTCP projection, fresh-session readiness, an unexpected-exit restart,
stale-generation rejection, and the required fresh media-session epoch and SSRC
for the replacement generation. The sample rate, identities, RTP bases, SSRCs,
PCM and clock anchor are deterministic fixtures—not random values, clock
readings or measurements. `FreshMediaSessions` is caller-asserted policy evidence
in this model; it does not inspect or attest peer sessions. `WorkersReady` covers
only the one configured media shard, not a complete node topology. The single
bounded output line declares those limits. It creates no process and is not the
packaged `a2-media-worker`, WebRTC, Opus, networking, browser interoperability,
confinement, performance evidence or promotion evidence.

The optional trace mode writes exactly 18 newline-delimited JSON records to
stdout: one start record, 16 capture-block records and one end record. It is a
bounded metadata-only raw trace for a separate extractor. The start record
declares both the requested and host-resolved tuple and explicitly sets
`promotionEligible` to `false`. Block records carry the observed capture epoch,
sequence, frame position and shape, monotonic timing and uncertainty,
discontinuity flags and cumulative source-xrun count. Unsigned 64-bit values
are decimal strings so a JavaScript consumer cannot lose precision. JSON
serialization happens only after the control-side ring consumer has copied a
block; it never runs in the callback and never includes PCM samples. Unknown
arguments fail instead of changing the fixed trace size.

This scaffold does not open a physical device and provides no latency,
stability, hardware-support, or real-time scheduling evidence.
Its exclusive-open, tuple and epoch checks are synthetic contract tests only;
they do not demonstrate equivalent behavior from ASIO, WASAPI, Core Audio,
DVS, CPAL or any professional interface.
The supervision adapter likewise does not yet claim restricted OS child
creation, launchd/XPC integration, privilege separation, or production health
IPC; those remain platform evidence work.
