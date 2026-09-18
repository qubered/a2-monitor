# Observability and operational evidence

**Status:** Proposed

Observability must explain whether the operator can trust current audio,
telemetry, control, and replay without creating work on the real-time path.

## Collection boundary

The audio callback updates preallocated counters and writes fixed-size timing
records to a bounded lock-free handoff. It never formats strings, performs I/O,
allocates, or waits. A lower-priority worker aggregates percentiles, rates, and
health. When the handoff fills, diagnostic detail is dropped and a loss counter
increments; capture is never delayed.

## Required signals

- audio callback duration, deadline, underrun/overrun, discontinuity and epoch;
- selected device, driver/API, sample rate, buffer, clock and channel identity;
- each bounded queue's capacity, high-water mark, drops and consumer lag;
- replay write/read latency, retained window, gaps, disk bandwidth and health;
- encoder duration, queue, RTP loss/jitter/concealment and browser feedback;
- backend/node authority epoch/revisions, control-ledger checkpoint/reserve,
  telemetry-journal gaps and reconciliation state;
- receiver worker/device freshness, reconnects, meter cadence and parser errors;
- auth, lease, certificate, update, backup and audit health; and
- CPU by process, memory, handles/threads, network, storage, temperature and
  power/UPS state where available.
- collaboration send/fan-out queues, page and attachment admission/rejection,
  quarantine/worker usage, database/asset/audit reservations and shedding level.

Every signal has unit, source, collection interval, cardinality limit, freshness
threshold, and retention class. IDs use bounded stable dimensions; source names,
addresses, and arbitrary vendor strings are not metric labels.

## Health model

Health is hierarchical and never one unexplained green light. Audio capture,
media, replay, receiver telemetry, backend, storage, network, certificates, and
updates each report healthy, degraded, unavailable, or unknown with cause,
freshness and safe operator action. Overall state is the most operationally
important active degradation, not a numeric average.

## Storage and offline operation

Recent metrics, structured logs, and audit events remain local and bounded.
Core health dashboards work without internet access. Retention prioritizes
durable audit/control events over sampled metrics and logs; disk pressure drops
debug detail before operational evidence. Audit records are append-only with a
hash chain or equivalent tamper-evidence mechanism selected by ADR.

## Correlation and diagnostics

All cross-process requests and events carry correlation/causation IDs, build,
node, show revision, session, capture epoch, and applicable sequence numbers.
Support bundles are explicit, size-bounded, previewable, and redact secrets,
tokens, private keys, personal data, production addresses, and replay audio.
Automated tests plant canary secrets and verify they do not appear in bundles.

## SLO and alert ownership

Performance and failure targets in the validation matrix become machine-
evaluated release checks. Each operational alert has an owner, runbook, severity,
deduplication behavior, and safe fallback. Product receiver/audio alerts and
appliance-health alerts remain distinguishable in Live.
