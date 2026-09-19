# ADR 0011: Untrusted media sandbox profiles

- **Status:** Accepted; qualification required before image ingestion
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** None

## Context

Headshots and placement images are valuable in Phase 1A, but image parsers are
an attack surface and decoding can exhaust memory/CPU. A process boundary without
an OS policy is not an adequate sandbox.

## Decision

One broker validates declared byte/type/dimension limits, creates an opaque job
directory and passes only already-open input/output handles to a disposable
decoder worker. The worker has no receiver credentials, database, secrets,
show-network access or arbitrary paths. It decodes, strips metadata and writes
bounded re-encoded variants; the broker verifies the result before publication.

- **Windows:** use a Less-Privileged AppContainer/AppContainer with no network
  capability and only broker-granted job-directory access, plus a non-breakaway
  Job Object for process-tree kill, memory, CPU-time and process-count limits.
- **macOS:** use a separately signed XPC service with App Sandbox, no client or
  server network entitlement, container/job-directory access only, and brokered
  file descriptors/security-scoped access no broader than the job.

Both profiles apply byte, decoded-pixel, width/height, frame, metadata, CPU-time,
wall-time, memory, output-byte and concurrency limits. Workers are killed after
one job. The raw quarantine is non-executable and outside web roots. Crash,
timeout or policy ambiguity rejects the asset; there is no unsandboxed fallback.
If either supported OS cannot enforce and adversarially prove its profile, image
ingestion is disabled there and operators use text/printed references.

`ManagedImageAsset` is the Phase 1A domain resource. `MessageAttachment` is a
separate Phase 1C resource. They share the low-level content-addressed blob and
quarantine pipeline but have different routes, permissions, retention, variants
and feature gates.

## Validation

- malformed, polyglot, decompression-bomb, huge-dimension, animated and metadata
  corpora; current decoder CVE regression corpus;
- prove no network, parent filesystem, credential, clipboard, process escape or
  child breakaway on both OS profiles;
- exhaust every limit under full capture/live/replay load; and
- verify cleanup, orphan collection and evidence pins across worker/broker crash.
