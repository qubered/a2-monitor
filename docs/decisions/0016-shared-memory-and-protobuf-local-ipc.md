# ADR 0016: Split native IPC into shared-memory PCM and bounded Protobuf control

- **Status:** Accepted; ABI details remain Phase 0A validation work
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** None

## Context

ADR 0007 and ADR 0012 require capture, media, replay and receiver parsing to
remain separate failure and privilege domains. Moving multichannel 48 kHz PCM
through a general RPC or JSON path creates avoidable copies and allocations,
while sharing arbitrary object graphs creates unsafe ownership and corruption
risk.

## Decision

Use two local IPC mechanisms.

For PCM, use fixed-capacity SPSC rings in shared memory. Every mapping has a
fixed-width header with magic, ABI version, capture epoch, sample format,
channels, frames per slot, capacity, sequence counters and xrun counters.
Slots contain fixed-layout PCM plus monotonic capture timing. They contain no
pointers, strings, variable-length fields or ownership of external objects.

The supervisor creates each mapping and passes handles to exactly one producer
and one consumer. Prefer inherited or duplicated handles. If a named mapping
is required for bootstrap, use a random per-session name and explicit owner-
only ACL/mode. The process that owns a resource also owns cleanup after crash.

For commands, lifecycle, health and low-rate telemetry between native
processes, use byte-mode named pipes on Windows and Unix-domain sockets on
macOS. Encode an outer unsigned 32-bit network-order length followed by a
Protobuf envelope. Reject a frame length above the message-class maximum before
allocation. Every envelope carries a protocol version, message kind, event or
request ID and authority/capture epoch when applicable.

All queues are bounded and declare overflow behavior. Apply deadlines and
peer-identity checks. The server creates Windows pipe DACLs for only the show
account/logon SID; macOS socket directories and objects are owner-only. A
protocol violation closes the connection and emits a bounded diagnostic.

Protobuf is not the canonical signature format. Existing signed commands and
evidence continue to use RFC 8785 canonical JSON bytes. PCM is never encoded as
Protobuf.

## Consequences

### Positive

- PCM crosses a process boundary without per-block serialization or heap work.
- Control messages remain typed, bounded and evolvable across Rust workers.
- Operating-system local IPC avoids a new listening TCP surface.
- The ABI is small enough to model, fuzz and compare across process restarts.

### Negative

- Shared-memory atomics, cache layout, teardown and crash recovery need careful
  platform-specific implementation.
- The project owns framing and compatibility rather than adopting full gRPC.
- A corrupt or malicious consumer can damage its mapping, so validation and
  confinement remain necessary.
- Protobuf schemas add a second representation beside public JSON Schema.

## Alternatives considered

- **TCP/HTTP/gRPC for all IPC:** larger network/protocol surface and still
  copies high-rate PCM.
- **JSON over pipes:** useful for diagnostics but more parsing/allocation and
  weaker generated native contracts.
- **FlatBuffers/Cap'n Proto:** capable control formats, but Protobuf has adequate
  compatibility and tooling; none removes the need for a raw PCM ring.
- **One monolithic process:** violates the accepted crash/confinement model.
- **Memory-mapped arbitrary Rust structures:** rejected because language
  layout, pointers and ownership are not a stable cross-process ABI.

## Validation

- Model sequence/epoch/overflow transitions including wraparound and process
  death; run concurrency tests under randomized schedules.
- Benchmark copy count, callback time and end-to-end latency at 64 and 128
  channels on both operating systems.
- Fuzz frame lengths, unknown fields, truncation, reorder and reconnect.
- Prove unauthorized local users/sessions cannot open mappings, pipes or
  sockets.
- Version-skew test the current and previous compatible worker pair; reject an
  incompatible ABI before mapping PCM.
