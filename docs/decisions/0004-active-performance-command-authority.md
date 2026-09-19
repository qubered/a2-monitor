# ADR 0004: Active-performance command authority and durable control ledger

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
- **Date:** 2026-09-18
- **Owners:** Project team
- **Superseded in part by:** [ADR 0008](0008-safe-authority-takeover.md)
  for takeover fencing and [ADR 0009](0009-live-control-lease-and-data-channel.md)
  for the browser/node lease protocol

## Context

Live needs low-latency control through a backend restart, but the backend and
audio node must not independently serialize cue and assignment changes. A
bounded telemetry/replay journal is also unsuitable for identity-changing
commands that must remain reconstructable after a long partition.

## Decision

Exactly one activated audio node is the command sequencer for the active
performance's runtime cue occurrence and assignment-overlay aggregates.

- Healthy clients normally send runtime commands to the backend, which
  authorizes and forwards them to that node. The backend does not commit a
  second copy independently.
- An established Live session may use the same node sequencer through its
  lease-bound WebRTC control data channel during a backend interruption.
- Every activation creates a persistent, monotonically increasing
  `authorityEpoch`. Every prepare, commit, lease, command result and emitted
  event carries it. A node rejects stale epochs.
- Preview and commit terminate at the same authority. A prepared transaction
  binds node, authority epoch, aggregate revision, observed-hardware manifest
  hash, payload hash and expiry.
- The node maintains one durable idempotency/result ledger for **canonical**
  commands received through either route. Reusing a key with another payload is
  an error. Bounded session state and ephemeral media controls are separate
  persistence classes; see the
  [runtime command contract](../architecture/runtime-command-contract.md).
- Browser control terminates in an unprivileged node client gateway, never the
  audio engine. The gateway authenticates the secure transport and lease proof
  of possession, canonicalizes/bounds schemas, persists nonce/sequence replay
  state and forwards only typed bounded IPC to the sequencer.
- A lease has an absolute validity window plus a maximum monotonic age for the
  current boot. Node restart invalidates the lease and session; a backend-issued
  replacement is required, so emergency mutations fail closed until reconnect.
  Backend revocation takes effect immediately when reachable and otherwise at
  lease expiry—the unavoidable partition trade-off is shown to administrators.
- Runtime aggregates use their own revisions: performance overlay, cue runtime,
  and assignment transaction. Immutable show revision is not a concurrency
  token for unrelated runtime work.
- Collaboration tasks, incidents, conversations, pages and messages remain
  backend-sequenced. They are unavailable offline. The node may record local
  evidence markers and checks but cannot create/claim/resolve backend incidents.

Control events and results use a non-evicting ledger separate from lossy
telemetry and replay observations. It is retained until performance close plus
successful, verified backend reconciliation and backup/checkpoint policy. The
node exposes remaining offline-mutation capacity and stops accepting new
offline mutations before it can lose canonical history; capture and monitoring
continue.

A replacement node cannot silently assume the old epoch. A higher epoch does
not fence an unreachable writer. Spare-appliance activation requires the
externally verified isolation, quarantine and tail-classification procedure in
[ADR 0008](0008-safe-authority-takeover.md). Version one has no automatic
multi-node failover or quorum.

## Consequences

### Positive

- Healthy and partitioned commands have one order and result ledger.
- A bounded replay journal can roll over without losing show identity changes.
- Stale leases and restored appliances cannot silently fork runtime truth.

### Negative

- Loss of the active node stops runtime mutation until a deliberate takeover.
- The control ledger needs power-fail-safe persistence and capacity monitoring.
- Backend collaboration does not continue through a backend outage.

## Alternatives considered

- **Backend authority with node offline authority:** rejected because takeover
  fencing would still be required and partitions could create two writers.
- **Last-write-wins reconciliation:** rejected because physical identity and
  historical replay cannot be repaired by timestamp preference.
- **Full consensus cluster:** deferred; it adds complexity without solving the
  single audio-device/node dependency in version one.

## Validation

- crash before/after each prepare, ledger write, commit and acknowledgement;
- identical/different-payload idempotency retries through both network paths;
- expired/stolen/stale-epoch leases, clock rollback and node restart;
- compromised-browser/XSS use, schema smuggling, nonce-state exhaustion and
  gateway-to-audio-engine privilege-boundary tests;
- partition with concurrent clients, capacity exhaustion and reconciliation;
- spare takeover proving that the old epoch can no longer commit; and
- power loss proving committed events/results remain reconstructable.
