# Technology stack selection

**Status:** Decision record supporting ADRs 0014–0018

**Research date:** 2026-09-19

**Scope:** Phase 0 through the first theatre rehearsal product

## Executive recommendation

Use two implementation languages and keep them on opposite sides of the
real-time boundary:

| Area | Baseline | Decision strength |
| --- | --- | --- |
| Audio engine, media, replay, receiver adapters, supervisor | Rust 2024 on a pinned stable toolchain | Accepted |
| Audio host layer | CPAL over ASIO/WASAPI/Core Audio, behind a project-owned adapter | Phase 0A reference; production acceptance is measured |
| Audio codec | Upstream `libopus` through one audited Rust FFI wrapper | Accepted, then benchmarked |
| Native WebRTC | `str0m` in a separate media process | Phase 0B reference; production acceptance is measured |
| Management backend | TypeScript on Node.js 24 LTS with Fastify | Accepted |
| Database | Local SQLite WAL/FULL; `better-sqlite3` in a dedicated backend storage worker and bundled `rusqlite` on the node | Accepted with version and power-cut gates |
| Manager and Live | Separate React + TypeScript + Vite applications | Accepted |
| Browser state transport | Versioned REST commands/snapshots plus WebSocket deltas; WebRTC only for media and its bounded control channel | Accepted |
| Internal native IPC | Page-separated shared-memory SPSC PCM rings plus local pipes/sockets using codec-neutral bounded frames | Accepted; JSON versus Protobuf measured in Phase 0T |
| Repository | Cargo workspace plus npm workspaces and one lockfile for each ecosystem | Accepted |
| Test stack | Rust native tests/fuzzing/benchmarks, Vitest for TypeScript components, Playwright for browser flows, custom hardware evidence harness | Accepted |
| Installation | Signed MSI on Windows; signed/notarized flat package on macOS; audio runtime in the logged-in show-user session | Accepted; WiX is conditional on commercial/EULA approval |

This is a production-shaped baseline, not a claim that CPAL or `str0m` has
already passed the named-hardware gates. Those two layers sit behind narrow
interfaces and have explicit replacement criteria. Every other component can
start implementation without waiting for that evidence.

## Forces and constraints

The selection is driven by the system already specified in this repository:

- Windows and macOS are equal product targets.
- Exactly one explicitly selected physical or virtual audio device is open at
  a time; DVS is one supported profile, not the architecture.
- The capture callback may not allocate, lock, log, use a database, or wait on
  another process.
- Media, replay and untrusted receiver parsers must not share the capture
  process's failure domain.
- The backend and both web applications must remain productive to build while
  native audio work is being proven.
- The default installation is a local, offline-capable appliance rather than a
  public cloud service.
- Live is a foreground browser client in version one. A native desktop shell
  must be justified by failed browser evidence, not assumed up front.
- Theatre/musical operation comes first; the data and UI stack must support
  cues, identity history, understudies, physical mic swaps, incidents and two
  concurrent operator views.

## Evaluation method

Options were scored from 1 (poor) to 5 (strong). The totals are directional
decision aids, not benchmark results. Hardware validation can overturn a
library choice even when it scores highest here.

| Criterion | Weight |
| --- | ---: |
| Real-time and latency suitability | 25% |
| Windows/macOS and driver coverage | 20% |
| Fault isolation, security and bounded behavior | 15% |
| Maintainability and implementation speed | 15% |
| Local/offline deployment | 10% |
| Testability and protocol interoperability | 10% |
| Licensing and redistribution | 5% |

## Native language and audio I/O

### Comparison

| Option | Weighted fit | Strengths | Material costs |
| --- | ---: | --- | --- |
| Rust + CPAL | 4.4/5 | Memory-safe default, explicit ownership, one native language across workers, ASIO/WASAPI/Core Audio coverage | CPAL is a thinner and younger abstraction than established C++ hosts; ASIO still introduces C SDK/tooling and licence work |
| C++ + JUCE | 4.0/5 | Mature pro-audio device management, strong cross-platform ecosystem | Larger framework, C++ safety burden, and AGPL/commercial licensing decision |
| C/C++ + PortAudio | 3.8/5 | Long-lived, small uniform callback API with major host APIs | More manual device identity, modern platform behavior, packaging and safe wrapper work |
| Direct WASAPI/ASIO/Core Audio | 3.6/5 | Maximum platform control and visibility | Two implementations, much more unsafe/platform code, slower Phase 0 learning |
| C + miniaudio | 3.3/5 | Small, permissive, simple distribution | No first-class ASIO backend in the documented backend list |

### Why Rust

Rust does not make a callback real-time safe automatically, but ownership and
thread-safety checks remove classes of lifetime and data-race defects from the
largest safety-critical part of the product. The official Rust documentation
describes ownership-based concurrency and the requirement to isolate unsafe
FFI behind safe interfaces; see [Fearless Concurrency](https://doc.rust-lang.org/book/ch16-00-concurrency.html)
and the [Rust FFI guide](https://doc.rust-lang.org/nomicon/ffi.html). That maps
well to small, audited leaves for ASIO,
Opus and operating-system confinement while keeping project code safe by
default.

Rust also lets the supervisor, media worker, replay worker and receiver
adapters share contract, timing and observability crates without putting Node
or a garbage collector in the sample path.

### Why CPAL first, not forever by decree

[CPAL](https://github.com/RustAudio/cpal) currently exposes device enumeration,
stable IDs, stream configuration, buffer/clock queries and callbacks. Its
documented backends are Core Audio on macOS, WASAPI by default on Windows and
optional ASIO. That is the smallest coherent route to one capture contract on
both operating systems.

The project-owned `AudioHost` boundary must not leak CPAL types. Phase 0A must
exercise named DVS and hardware interfaces, stable device identity, fixed
buffers, timestamps, invalidation, 32–64 channels and recovery. If CPAL cannot
meet those tests, replace only the host adapter with direct native code or a
small C++ host shim.

On Windows, use ASIO for DVS and professional devices that expose it. For
ordinary devices, evaluate low-period WASAPI shared mode before exclusive mode;
Microsoft recommends evaluating low-latency shared mode and documents that
exclusive mode takes sole control of the endpoint. See Microsoft's
[low-latency audio](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio)
and [exclusive-mode](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams)
guidance. No backend fallback or default-device switch is automatic.

On macOS, use Core Audio and join any auxiliary real-time threads to an Audio
Workgroup when the native path makes that appropriate. Apple documents Audio
Workgroups as the mechanism for coordinating real-time audio threads against a
common deadline in [Understanding Audio Workgroups](https://developer.apple.com/documentation/audiotoolbox/understanding-audio-workgroups).

### Alternatives retained

- [JUCE's AudioDeviceManager](https://juce.com/tutorials/tutorial_audio_device_manager/)
  is the first full-framework fallback if CPAL exposes systemic driver
  incompatibility. Its [dual AGPL/commercial terms](https://github.com/juce-framework/JUCE/blob/master/LICENSE.md)
  require a business decision before use.
- [PortAudio](https://portaudio.com/docs/v19-doxydocs/api_overview.html) is the
  smaller C fallback. Its documented ASIO one-device restriction is compatible
  with this product, but it would require more project-owned platform behavior.
- Direct native adapters are the precision fallback when only one host API or
  driver family fails. They are not a reason to duplicate the whole engine.
- [miniaudio](https://miniaud.io/docs/manual/) remains useful for small audio
  utilities but is not the primary host because its documented native backends
  do not include ASIO.

### ASIO legal and build gate

Steinberg publishes an open-source GPLv3 path as well as proprietary licensing
information for ASIO. The working product assumption is proprietary
distribution, so the first ASIO evidence build—not merely the first public
release—requires an approved proprietary Steinberg route, recorded SDK
provenance and a reviewed local `CPAL_ASIO_DIR`. CPAL's convenience build may
download the SDK when that variable is absent; release/evidence builds prohibit
public-network access and must fail instead. If a proprietary route is not
available, ASIO artifacts and compatibility claims remain blocked rather than
silently inheriting GPLv3 obligations. The SDK, headers or binaries are never
committed casually. See Steinberg's
[ASIO SDK page](https://www.steinberg.net/developers/asiosdk-open/) and CPAL's
documented LLVM/Clang build requirement.

## DSP, mixing, replay and Opus

Build a deliberately small in-house DSP graph rather than adopting a plugin
host:

- planar or explicitly documented interleaved `f32` PCM at 48 kHz;
- preallocated channel fan-out, meters and per-client stereo buses;
- fixed-capacity command queues applied only at block boundaries;
- no VST/AU plugin loading in phases 0–2;
- replay storage and readers outside the capture process; and
- deterministic signal generators and golden vectors for every transform.

Use upstream [`libopus`](https://github.com/xiph/opus) for WebRTC encoding. It
is the reference-quality implementation, documents 48 kHz stereo input and an
audio mode suitable for mixed/music material, and publishes RTP usage against
RFC 7587. Wrap its C API in one small crate; preallocate encoder state and
packet buffers outside the hot loop; pin and checksum its source; and run the
upstream test vectors. Do not write a codec or use a file-oriented Opus wrapper
for live RTP.

## Native WebRTC engine

### Comparison

| Option | Weighted fit | Strengths | Material costs |
| --- | ---: | --- | --- |
| `str0m` | 4.3/5 | Rust, sans-I/O, no internal threads, externally driven time, browser media and data channels, deterministic testing | No capture/codec/TURN and no receive jitter buffer; project owns sockets and scheduling |
| `libdatachannel` | 4.0/5 | Lightweight, browser-compatible C++/C API, media and data channels, mature ICE choices | C++ FFI/dependency chain and callback lifetime management |
| GStreamer `webrtcbin` | 3.6/5 | Full media framework and PeerConnection-shaped API | Large runtime and packaging surface for a narrow send-only audio worker |
| `webrtc-rs` | 3.5/5 | Conventional async Rust PeerConnection stack | More internal async/task behavior than the appliance needs to control |
| Google libwebrtc | 3.0/5 | Broadest reference implementation and browser lineage | Very large build/dependency surface; upstream says native code is primarily for browser developers |

[`str0m`](https://github.com/algesten/str0m) is the Phase 0B reference because
its sans-I/O state machine has no hidden network threads or clock calls. The
media worker already owns Opus, UDP sockets, admission and scheduling, so the
features it omits are mostly deliberate project responsibilities. Its lack of
a receive jitter buffer is irrelevant to a send-only monitor endpoint; the
browser remains the receiver.

The acceptance test must cover Chromium, Safari/WebKit and Firefox; offer/
answer and trickle ICE; interface-scoped host candidates; DTLS/SRTP; reliable
ordered data channel behavior; restart and renegotiation; client admission;
loss/jitter; and capture-to-ear latency. A short `libdatachannel` fallback spike
is kept buildable if `str0m` fails a gate. [libdatachannel](https://github.com/paullouisageneau/libdatachannel)
documents Windows/macOS and major-browser compatibility with media and data
channels. [GStreamer's `webrtcbin`](https://gstreamer.freedesktop.org/documentation/webrtc/)
is the full-pipeline fallback. Google explicitly says its
[native WebRTC package](https://webrtc.googlesource.com/src/+/main/docs/native-code/)
is intended primarily for browser developers, making it the last rather than
first application choice.

This choice does not change ADR 0002's one continuous Opus track per client or
the standard local profile's no-public-STUN/TURN rule.

Disable `str0m` default features and select the cryptographic backend
deliberately: `apple-crypto` on macOS and `wincrypto` on Windows, with the
AWS-LC/Rustls path retained only as an explicitly measured fallback. Record the
provider and version in every evidence manifest. This prevents a crate-default
change from silently changing native libraries, trust behavior or packaging.

## Backend and public API

### Comparison

| Option | Weighted fit | Strengths | Material costs |
| --- | ---: | --- | --- |
| TypeScript + Node.js + Fastify | 4.4/5 | Fast product iteration, shared web types/tooling, schema-first validation, strong WebSocket ecosystem | Event-loop discipline and a second language/runtime |
| Rust + Axum | 4.0/5 | One native language, strong correctness and low resource use | Slower iteration for UI-heavy domain/API work and fewer shared frontend tools |
| Go + `net/http`/Chi | 3.8/5 | Simple deployment, concurrency and operations | Third language and weaker contract sharing with both native and browser code |
| TypeScript + NestJS | 3.6/5 | Strong conventions and dependency injection | More framework/reflection machinery than the local appliance needs |

Use Node.js 24 LTS, strict TypeScript and Fastify. Node's release policy says
production applications should use Active or Maintenance LTS releases; Node 24
is LTS at the research date. See the official [release schedule](https://nodejs.org/en/about/previous-releases).

Fastify aligns with the existing contract approach: it recommends JSON Schema
for request validation and response serialization and compiles those schemas.
See [Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).

The project installs Fastify 5.12.2 or newer within the pinned major because
earlier versions are affected by its 2026 schema-validation advisory. Fastify's
default validator/serializer stack is Draft 7-oriented, while this repository
uses Draft 2020-12, so the backend injects one explicitly configured Ajv 2020
instance in strict, non-mutating mode (`removeAdditional`, `useDefaults` and
`coerceTypes` disabled). Runtime requests, tools and golden vectors use that
same configuration. Responses are validated before `JSON.stringify`; compiled
serialization is permitted only after a conformance suite proves it cannot
hide invalid or omitted fields.

Rules for this boundary:

- Fastify is the HTTPS, authentication, REST, WebSocket-signaling and static-
  asset host. It never owns PCM, Opus or receiver sockets.
- JSON Schema in `packages/protocol` is authoritative for public JSON. Generate
  TypeScript and Rust representations; do not hand-maintain parallel shapes.
- REST handles snapshots, commands, history and show building. WebSocket sends
  bounded deltas, health and collaboration events. GraphQL adds no useful
  capability for the first product and is not selected.
- CPU-heavy image, import/export and report jobs run in confined workers with
  explicit queues and resource budgets.
- Fastify/Node major upgrades are deliberate release work, not floating
  production installs.

Rust and Go remain credible replacements if backend evidence shows sustained
event-loop or packaging problems. That would not change the public contracts.

## Persistence

SQLite remains the correct authority store for a single local appliance. It
avoids operating a separate database service and its WAL mode allows readers
and a writer to proceed concurrently on the same host. SQLite explicitly says
WAL is not for network filesystems and has one writer at a time; both fit this
deployment. See [SQLite WAL](https://sqlite.org/wal.html) and
[appropriate uses](https://sqlite.org/whentouse.html).

Implementation profile:

- one database owner and one writer queue per database;
- `journal_mode=WAL`, `synchronous=FULL`, foreign keys and explicit versions as
  ADR 0010 requires;
- raw reviewed migrations and prepared SQL behind repository interfaces;
- no ORM in the first implementation;
- backend access through pinned
  [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) in a dedicated
  storage worker;
- node ledger access through
  [`rusqlite`](https://github.com/rusqlite/rusqlite) with bundled SQLite and
  backup support;
- native extension loading disabled;
- a startup assertion of the actual SQLite version and compile options; and
- SQLite 3.51.3 or newer, not an arbitrary system library.

The version floor is a correctness requirement. SQLite documents a rare
WAL-reset data race fixed in 3.51.3, affecting concurrent connections that
write/checkpoint. The selected bundled libraries must contain that fix and
power-cut/concurrency evidence must still pass.

Node's built-in `node:sqlite` is not selected yet because Node 24.21 documents
it as a release candidate rather than stable. It can replace the native addon
after stability, feature, bundled-version and migration evidence. The official
[Node SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
also confirms online-backup support, which will be included in that later
comparison.

PostgreSQL is deferred until there is a proven multi-writer, multi-host or
fleet-scale need. It is not hidden inside the first appliance.

## Manager and Live web applications

### Comparison

| Option | Weighted fit | Strengths | Material costs |
| --- | ---: | --- | --- |
| React + TypeScript + Vite | 4.4/5 | Mature ecosystem, reusable component model, hiring/tooling depth, direct static deployment | Requires discipline to keep high-rate telemetry out of component reconciliation |
| Vue + TypeScript + Vite | 4.2/5 | Excellent reactivity and approachable single-file components | Smaller shared team/ecosystem assumption for this project |
| Svelte + TypeScript + Vite | 4.0/5 | Compact components and efficient compiled updates | Smaller long-lived enterprise/tooling surface |
| Next.js/SSR React | 3.2/5 | Full-stack routing/rendering conventions | Server rendering and cloud-oriented machinery add no value to a LAN appliance |

Use React, strict TypeScript and Vite for two independent static applications.
React provides typed components, while Vite supplies a lean development server
and optimized static bundles; see the official [React TypeScript guide](https://react.dev/learn/typescript)
and [Vite rationale](https://vite.dev/guide/why).

The high-rate path is deliberately not “put every meter value in React state”:

- a typed transport client writes the latest telemetry into bounded external
  stores;
- channel tiles subscribe only to coarse state changes;
- meters, RF traces and timelines render through Canvas/WebGL with one
  request-animation-frame scheduler and visible-region culling;
- workers perform decimation or history preparation when profiling requires
  it; and
- the DOM remains the accessibility and command surface.

Manager and Live have separate HTML entry points, dependency graphs and build
artifacts. They may share protocol clients, headless accessible primitives,
design tokens and bounded visualization packages. No all-in-one component kit,
CSS framework or global state library is selected before the first interaction
prototype; those are reversible component choices, not architecture.

Live may be installable as a PWA for app-shell caching and launch convenience.
Its service worker must not cache API responses, credentials, WebRTC media or
show mutations, and a PWA does not change the foreground-only audio contract.
Electron, Tauri and a native mobile app remain trigger-based fallbacks after a
documented browser lifecycle/output gate fails.

## Internal IPC and contracts

There are two paths because PCM and control have different requirements.

### PCM path

Use fixed-size, preallocated single-producer/single-consumer rings in shared
memory. Separate page-aligned regions hold immutable descriptors, producer-
writable counters, consumer-writable counters and PCM slots so each process
receives only the write permissions it needs. The descriptor contains a magic
value, ABI version, byte order, epoch, sample format,
channel count, frames per slot, capacity, monotonic sequence counters and
overrun/underrun counters. Slots contain fixed-layout PCM and capture timing.
There are no pointers, strings, variable-length records or ownership transfer
inside the mapping.

The supervisor creates mappings and passes inheritable/duplicated handles where
possible. Named objects are random, per-installation/per-session and ACL/mode
restricted. Windows provides file-mapping objects for named shared memory; see
[Creating Named Shared Memory](https://learn.microsoft.com/en-us/windows/win32/memory/creating-named-shared-memory).
macOS exposes POSIX `shm_open`; see Apple's [`shm_open(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/shm_open.2.html).

### Control path

Use byte-mode named pipes on Windows and Unix-domain sockets on macOS. Frames
are exactly a `u32` network-order length followed by a bounded payload. The
codec-neutral semantic payload carries its protocol version, message kind,
request/event ID, authority epoch where relevant, and message body.
Apply a small hard maximum before allocation, deadlines, bounded queues,
peer-identity checks and close-on-protocol-error behavior.

On Windows, set an explicit DACL scoped to the installed show account and use
the logon SID; Microsoft's [named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
documentation notes that default descriptors can grant read access to Everyone
and anonymous users. On macOS, the socket directory and object are owner-only.

Phase 0T compares bounded JSON against Protobuf on representative commands and
telemetry before selecting the control codec. Protobuf is the reference
candidate for evolvable native control records, not PCM; its tagged format can
skip unknown fields, but serialization is not a stable canonical byte
representation. Signatures and hashes continue to use RFC 8785 canonical JSON.
The outer framing and limits do not depend on the codec. See the official
[Protocol Buffers encoding guide](https://protobuf.dev/programming-guides/encoding/).

Alternatives rejected for this path:

- gRPC: HTTP/2 and service machinery are unnecessary on a local process edge;
- Protobuf/FlatBuffers for PCM: any record serialization is unnecessary copying;
- one in-process monolith: violates the established crash and privilege
  boundaries; and
- TCP loopback for all IPC: expands network attack surface and still does not
  solve zero-copy PCM handoff.

## Repository and build system

Use one repository with two ordinary workspaces:

```text
apps/
  manager/                 React/Vite application
  live/                    React/Vite application
services/
  backend/                 Node/Fastify process and storage worker
  audio-node/              Rust workspace members/binaries
integrations/
  sennheiser-ewdx/         Rust adapter plus protocol fixtures
  shure/                   Rust adapter plus protocol fixtures
packages/
  protocol/                JSON Schema, .proto, generators and vectors
  ui/                      Shared headless primitives/tokens/visualizations
crates/
  audio-host/              Project-owned host abstraction and CPAL adapter
  audio-engine/            Real-time graph
  media-worker/            Opus and WebRTC
  replay-worker/           Replay I/O
  node-supervisor/         Lifecycle, IPC and confinement
  runtime-protocol/        Native generated contracts and IPC framing
infra/
  appliance/windows/       WiX authoring and platform policy
  appliance/macos/         package/launchd authoring and platform policy
```

Cargo workspaces share a lockfile and output directory and support workspace-
wide checks; see the official [Cargo workspace reference](https://doc.rust-lang.org/cargo/reference/workspaces.html).
npm workspaces already provide local linking and workspace-scoped scripts; see
the [npm workspace documentation](https://docs.npmjs.com/cli/v11/using-npm/workspaces/).

Stay with npm rather than adding pnpm immediately because this repository
already has `package-lock.json`, the expected package count is modest, and no
measured install/storage problem exists. Do not add Nx, Turborepo, Bazel or a
cross-language meta-build until the build graph demonstrates a need. Root
scripts may orchestrate stable component checks without hiding their native
commands.

Pin the Rust toolchain and exact Node 24 patch in the release manifest. Rust 1.98.1 is the stable point
release at the research date according to the official
[Rust release announcement](https://blog.rust-lang.org/releases/latest/). Pin
direct dependencies and commit both lockfiles. Renovation is a reviewed change
with licence, vulnerability,
binary, latency and hardware evidence appropriate to the dependency.

## Testing and observability

Selected layers:

- Rust: `cargo fmt`, Clippy with warnings denied, unit/integration tests,
  property tests for parsers/state machines, fuzz targets for network and file
  inputs, concurrency model tests for rings, criterion-style microbenchmarks,
  sanitizers where supported and the existing evidence manifests for HIL/soak.
- TypeScript/backend: strict typecheck, ESLint, Vitest unit/integration tests,
  migration/recovery tests and the existing Node contract verifier.
- Browser: Playwright component/workflow/visual/accessibility tests across
  Chromium, WebKit and Firefox. Playwright officially supports all three on
  Windows, macOS and Linux; see [Playwright installation](https://playwright.dev/docs/intro).
- Contracts: generate Rust/TypeScript outputs in CI and fail on a dirty diff;
  cross-language golden vectors cover unknown fields, bounds and canonical
  signatures.
- Hardware: a separate signed evidence workflow on named DVS, USB/Thunderbolt,
  EW-DX, Shure, browser/output and network tuples. CI compilation never becomes
  a hardware support claim.

Use structured JSON logs with monotonic and wall timestamps, stable event IDs
and redaction at source. Rust workers use the `tracing` ecosystem; Fastify uses
its Pino-compatible logger. Expose bounded local health/metrics endpoints only
on the management interface. OpenTelemetry export is optional and off by
default; the show cannot require a collector or cloud account.

## Installation and process lifecycle

### Reference operating-system and CPU profile

Phase 0 builds and measures Windows 11 x86-64 and Apple-silicon macOS first.
Every release freezes an exact in-support OS build, driver and machine model;
“Windows 11” or “latest macOS” alone is not a compatibility claim. Microsoft's
[Windows 11 lifecycle table](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)
shows that individual feature releases have separate retirement dates, which is
why the matrix records the build rather than only the product name.

The code and package layout must remain portable to macOS x86-64 and Windows
ARM64, but neither is supported until its own device/HIL profile passes. In
particular, Audinate currently states that
[DVS does not run on Windows ARM](https://support.getdante.com/hc/en-gb/articles/5390908592671-Can-I-use-Dante-Virtual-Soundcard-on-Windows-ARM-architecture),
while its current guidance explicitly covers
[Apple-silicon audio tuning](https://support.getdante.com/hc/en-gb/articles/5508273962783-How-can-I-tune-an-Apple-Silicon-computer-for-the-best-audio-performance).
This does not prohibit a later Windows ARM profile for a supported USB device;
it prevents an untestable DVS promise.

The audio runtime needs the logged-in show user's audio session. Windows
documents that services run in session 0 and cannot directly interact with the
user session, so the initial profile starts the node supervisor with a
user-logon task rather than pretending an interactive audio engine is a normal
service. See [Interactive Services](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)
and [logon-triggered tasks](https://learn.microsoft.com/en-us/windows/win32/taskschd/starting-an-executable-when-a-user-logs-on).

On macOS, use a LaunchAgent for the show user. Apple distinguishes LaunchAgents
running in a logged-in user's context from LaunchDaemons in the system context;
see [Service Management](https://developer.apple.com/documentation/servicemanagement)
and [Designing Daemons and Services](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html).

Packaging baseline:

- Windows: maintained-tool-authored signed MSI/bundle, explicit firewall rules,
  show-user logon task, repair/uninstall and no opaque auto-update. WiX builds
  standard Windows Installer packages and bundles; see its
  [current documentation](https://docs.firegiant.com/wix/). Current WiX releases
  use an Open Source Maintenance Fee/EULA model, so legal/commercial approval
  and the applicable fee are required before it enters the release toolchain.
- macOS: signed flat installer package containing signed/hardened binaries and a
  LaunchAgent, notarized with `notarytool` and stapled for offline installation.
  Apple documents these requirements in [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
  and notes that stapling avoids an online Gatekeeper dependency in
  [Packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).

MSIX may be revisited for managed enterprise distribution, but MSI is the first
spike because the appliance needs explicit machine integration, repair and
logon-task behavior without depending on packaging capability/version
differences. If WiX terms are not approved, compare a supported commercial MSI
authoring tool or a reviewed direct Windows Installer implementation against
the same signing, transactional rollback, ACL, logon-task and offline-repair
manifest rather than freezing an unsupported WiX release. Inno Setup is not an
MSI-semantic substitute and is removed from the baseline comparison.

The initial support contract therefore requires a dedicated show account to be
logged in before capture can become ready. “Machine booted” is not reported as
“audio ready.” Backend/system helpers may later run as services/daemons, but
their loss or session split must not violate node authority or audio ownership.
The initial product does not silently auto-log in this account; a documented
manual login is part of the pre-show procedure.

Installations use immutable versioned application slots. The candidate is
staged beside the active slot, signatures and compatibility are checked,
migrations are exercised against a snapshot, and startup/device/API health
gates pass before an atomic selector change. The prior slot and compatible data
snapshot remain available for rollback. Updates are refused during an active
performance, and power interruption at every transition is tested on both OSes.

## Choices deliberately deferred

These decisions are reversible or evidence-dependent and must not block Phase
0 scaffolding:

- exact React state/query, component primitive and CSS libraries;
- Canvas 2D versus WebGL for each visualization;
- a Rust async executor outside the callback (`tokio` is the likely worker
  baseline, but profiling owns the decision);
- image decoder/re-encoder implementation inside the ADR 0011 sandbox;
- replay on-disk audio encoding and segment size;
- error-reporting/SBOM/vulnerability vendors;
- updater framework and release CDN; core updates remain signed and offline-
  installable;
- a native background-listening client; and
- public-cloud, fleet, PostgreSQL, containers or Kubernetes deployment.

Each deferred item gets an ADR only when it becomes costly to reverse. None may
silently enter the real-time callback, browser background contract or public-
internet dependency.

## Falsification and replacement rules

The stack is changed only on concrete evidence:

1. **CPAL replacement:** a named supported device cannot sustain required
   channel/rate/block behavior, identity, timestamps or recovery while a direct
   native/JUCE/PortAudio proof can.
2. **`str0m` replacement:** a supported browser/network tuple fails negotiated
   media/data-channel correctness, latency, security response or bounded
   resource behavior and the fallback passes the same manifest.
3. **Node backend replacement:** the isolated storage/job design still misses
   API/event deadlines or cannot meet security/packaging gates under the
   declared full-load envelope.
4. **React/browser replacement:** the optimized external-store/render path
   misses operator or foreground lifecycle gates on supported clients and a
   native proof passes them.
5. **SQLite replacement:** single-writer/local-disk operation cannot meet
   durability, corruption, backup/restore, scale or schema-evolution gates.

Replacement preserves the project-owned interfaces and evidence catalogue. It
does not reopen unrelated architecture decisions.
