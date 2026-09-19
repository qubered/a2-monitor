# ADR 0014: Use Rust for the native node and CPAL behind an evidence-gated host boundary

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
- **Date:** 2026-09-19
- **Owners:** Audio runtime owner; platform/security owner for ASIO provenance
- **Supersedes:** None

## Context

The node must capture 32–64 channels from exactly one Windows or macOS device,
run bounded DSP, supervise isolated workers and survive malformed network input
without putting a garbage collector or unsafe parser in the callback. The first
implementation must reach ASIO, WASAPI and Core Audio without making a single
third-party wrapper impossible to replace.

## Decision

Use stable Rust with the Rust 2024 edition for the audio engine, node
supervisor, media/replay workers and receiver adapters. Pin the repository
toolchain and lockfile. Project code is safe Rust by default; operating-system,
ASIO and codec FFI lives in small reviewed leaf crates with documented safety
invariants.

Define a project-owned `AudioHost` interface. Use CPAL as the Phase 0A reference
adapter for Core Audio, WASAPI and ASIO. CPAL types do not cross that boundary.
The interface exposes explicit host/device identity, supported configurations,
stream clock/timestamps, callback status, discontinuity/invalidation and
requested versus actual buffer size.

The node opens only the configured host/device tuple. It does not fall back to
the operating-system default, switch host APIs, change rate or repatch channels
without an explicit stopped-state transaction. Every successful open begins a
capture epoch.

Use ASIO for DVS and named professional Windows profiles. Evaluate low-period
WASAPI shared mode before exclusive mode for ordinary Windows devices. Use Core
Audio on macOS and add native Audio Workgroup integration for auxiliary
real-time threads when the Phase 0A profile requires it.

The initial distribution assumption is proprietary. No GPLv3 ASIO SDK/header is
used in a distributable build. ASIO/DVS release support is blocked until the
Steinberg proprietary path is approved and a licensed, checksummed SDK is
available through controlled build storage. Release/evidence builds set
`CPAL_ASIO_DIR` explicitly and fail rather than allowing CPAL to download an SDK.

The DSP core uses preallocated fixed-capacity buffers and queues. No general
audio-plugin host is included in phases 0–2. Upstream `libopus` is wrapped in a
single audited Rust FFI crate for live encoding.

## Consequences

### Positive

- One memory-safe native ecosystem covers the callback and isolated workers.
- CPAL provides a fast cross-platform proof without owning the product API.
- Direct native or C++ host adapters can replace one failing backend without a
  node rewrite.
- Receiver parsers and supervisor logic can share Rust protocol/test crates
  while remaining separate processes.

### Negative

- The team needs strong Rust and real-time audio expertise.
- ASIO adds C++ SDK, LLVM/Clang, redistribution and licence work.
- CPAL behavior is not accepted on reputation; the project must build missing
  native hooks or replace an adapter when evidence fails.
- Audited unsafe code remains necessary at operating-system and codec edges.

## Alternatives considered

- **C++/JUCE:** mature pro-audio support, but a larger framework, C++ safety
  burden and AGPL/commercial licensing decision.
- **C/C++ PortAudio:** credible small fallback, but more project-owned modern
  device identity and platform behavior.
- **Direct native APIs:** maximum control but duplicates the initial platform
  implementation. Retained as a targeted escape hatch.
- **miniaudio:** attractive small C distribution but no documented first-class
  ASIO backend.
- **Node, Go or managed code in the callback:** rejected because their runtime
  and allocation behavior do not improve this real-time boundary.

## Validation

- Run every Phase 0A evidence tuple on named Windows/macOS, DVS and hardware
  interfaces at 48 kHz/32–64 channels.
- Instrument callback allocations, locks, deadline misses, invalidation and
  actual buffer behavior.
- Compare one failing CPAL tuple against a minimal direct-native or fallback
  host proof before changing the product claim.
- Pass 12-hour soaks, device removal/reopen, clock change and no-silent-repatch
  tests.
- Complete the proprietary ASIO licence and hermetic SDK-input gate before the
  first ASIO/DVS evidence build, not merely before shipping it.
