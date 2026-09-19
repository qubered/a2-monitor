# Independent plan review: round 3

**Status:** Open findings; reviewed plan unchanged

**Reviewed:** 2026-09-19

Three fresh context-free reviewers independently read committed baseline
`e3ee288`: theatre operations, API/domain/distributed state, and real-time audio/
platform/security. They did not consult one another or edit the repository.
Repository hygiene/link checks passed; there is still no product implementation
or hardware evidence.

## Combined verdict

| Stage | Consolidated verdict |
| --- | --- |
| Phase 0A capture/time implementation | **GO.** Add cross-platform build/test CI and a frozen measurement manifest with the first runnable scaffold. |
| Phase 0B isolated experiments | **GO after relevant Phase 0A evidence.** Experiments may falsify authority, lease, browser, WebRTC, replay and resource hypotheses. |
| Phase 0B integrated exit qualification | **NO-GO today.** True old-node isolation, lease wire semantics, local trust/bootstrap and objective test inputs are unresolved. |
| Phase 1A implementation | **NO-GO.** Runtime identity boundaries, cue recovery, persistence/protocol and several operator state machines are not yet implementable contracts. |
| Supervised rehearsal use | **NO-GO.** There is no runnable or validated system, and an authority fork could still corrupt show identity. |

The reviewers agree that the previous response substantially improved the
architecture. They do not agree that every row marked “resolved” is closed:
several are now good requirements but still hide a design choice or executable
state machine.

## P0 blockers

### Unreachable old-node takeover is not fenced by a higher epoch

[ADR 0004](../decisions/0004-active-performance-command-authority.md) allows an
isolated old node to honour an unexpired lease. A replacement/backend can create
a higher epoch, but the isolated node cannot observe it and may continue to
accept direct commands. Two nodes can therefore produce competing canonical cue
and assignment histories.

Required response:

- version-one takeover must require externally verifiable isolation of the old
  authority—power off, network quarantine, removal of its physical device/key
  path, or another mechanism every commit must consult;
- if isolation cannot be proved, show-time mutation remains stopped;
- a returning old node and its tail are quarantined/noncanonical pending an
  explicit reconciliation decision; and
- tests keep an old client issuing leased commands after replacement activation.

A monotonically increasing epoch remains useful after isolation, but cannot by
itself fence an unreachable writer.

### Physical installation has no normative identity-effective transition

[The swap workflow](../product/cast-mics-cues.md) lists physical stages but does
not say exactly when old assignment intervals close and new performer/mic/path
identity becomes effective. An atomic multi-role plan also risks making every
replacement appear current before staggered physical changes finish.

Required response: define a transaction automaton covering reserve/prepare,
begin change, installed/effective boundary, RF/audio verification, A1 receipt,
failure/abandon/revert/fallback, expiry, fast spare promotion and post-hoc entry.
The cast plan/reservations may be atomic; each physical assignment receives its
own actual effective boundary and transitional state.

## P1 architecture and product findings

### Cue authority recovery and adapter ownership

- External observer, stale/resync and manual fallback rules conflict: the API
  permits manual resync only in manual mode, while external stale recovery also
  requires an explicit resync.
- There is no authority-handover state machine to rebase external state, transfer
  to a named manual tracker, fence late external events, or deliberately return.
- The QLab observer has no assigned component/network path. If implemented in
  the backend, a backend restart defeats offline cue authority.

Place the QLab observer in a node-side sandboxed non-real-time worker and specify
interface/firewall, `/listen` renewal, heartbeat, cursor/restart, normalization,
dedupe/reorder and control-ledger behavior. Define explicit external-stale →
external-rebase or named-manual-transfer transitions; never auto-promote.

### Lease/gateway security is not yet a wire protocol

“Proof of possession,” nonce and client binding need exact claims and bytes:
issuer/audience, lease ID, client key registration, request signature/MAC,
canonical transcript, counter/window, persistence-before-ack, node boot binding,
clock/restart behavior, revocation propagation and partial-partition routing.
Prefer invalidating direct-control leases at node restart unless a trusted
monotonic mechanism is demonstrated.

### Command classes are incorrectly conflated in the control ledger

The non-evicting command ledger currently appears to include listen, gain/pan/
dim and replay scrub commands as well as identity mutations. Separate:

1. canonical non-evicting cue/assignment/check evidence;
2. bounded session-state/idempotency; and
3. ephemeral media controls.

Each needs independent persistence, rate, replay, expiry and shedding rules.
Canonical control-ledger persistence belongs above replay in the resource
priority order and needs explicit storage/I/O reservation.

### Command and cue semantics need executable matrices

- Add a command/aggregate matrix naming authority, aggregate ID, required
  precondition, revision increment, transaction scope, idempotency namespace,
  emitted stream and result retention for every mutation.
- Publish a complete cue automaton: hold/resume sequence behavior, occurrence
  creation, quality transitions, external dedupe/reorder, restart cursor and
  scheduled-condition behavior across skip/back/resync/cancel.
- Freeze `authorityEpoch` as an exact safe wire type with allocation and
  exhaustion semantics.

### Bitemporal identity still lacks query/correction algebra

Define valid/recorded interval schema, current-row predicate, supersession,
overlap correction, tie-breaking, cross-epoch logical ordering, uncertainty,
exclusivity, and whether replay shows latest-corrected identity or identity as
known at playback time.

### Ledger reconciliation/pruning is not crash-safe

Define hash-chained checkpoint chunks, transactional backend import/projection/
outbox, durable acknowledgement, backup barrier, node compaction marker,
performance/lease closure, retry after every crash point and stale-epoch tail
quarantine. Pruning cannot occur merely because the backend once received data.

### Handoff remains underspecified

Add a handoff aggregate with draft, outgoing-attested, incoming-accepted,
disputed and authorized-forced states; item transfer/retain choices; expected
revision; absent-outgoing behavior; late-event reopening and re-acknowledgement.
A composite node-sequence/backend-import watermark or exact late-arrival rule is
required. Complete task release/reassign and incident coordinator handoff/
release commands, including causal links to system messages.

### Physical swap verification needs failure and validity rules

Assignment effectiveness and verification receipts must be separate. Define
failed, abandoned, reverted and fallback paths. A1 confirmation is a policy-
driven receipt with an unavailable/explanation path, not a mandatory physical
stage. Specify check reuse/expiry by component, performer, costume, placement,
receiver path, zone and time window.

### Phase 1A contains deferred notification dependencies

Phase 1A creates tasks/incidents but pages are Phase 1B and rich image/dictation
controls are Phase 1C. Publish a phase capability matrix. Either add a minimal
structured foreground task-notification receipt to 1A or state that intercom is
mandatory and only the foreground task queue updates. Deferred controls must be
hidden in 1A.

### Phase 1A is still too broad

Split or independently gate:

1. monitoring, identity, guided mic check and single prepared-pack promotion;
2. cue/intervention and complex cast/swap operations; and
3. recovery, import/images, appliance hardening and dress-rehearsal evidence.

Re-estimate only after Phase 0B. Do not compress state-machine and recovery work
to preserve the current 12–16 week range.

### Client lifecycle needs server-observed evidence and numeric gates

A suspended browser cannot reliably update its own warning. Define node/backend
heartbeats and media-progress evidence, reconstructed blind interval, recovery
states, maximum recovery/RTP gap, output-route identity, gain/latency tolerance,
full-show duration and battery margin. Camera, microphone and notification
features remain disabled on profiles that cannot prove invariants.

### Direct local origin/trust bootstrap is unresolved

Phase 0B must prove a freshly provisioned named client can establish offline
HTTPS/WebSocket/WebRTC to the node: CA/MDM install, node discovery/name and SAN,
origin/CORS/private-network policy, gateway ports, ICE candidate/packet capture,
bounded UDP range, rotation and expiry during backend failure.

### Phase gates require frozen machine-readable test manifests

Before each run, pin hardware/software tuple, load generators, queue/storage
limits, duration/trials, fault schedule, channel-order/sample-loss integrity
oracle, numerical pass/fail thresholds and artifact checksums. Phase 0B proxy
collaboration load is sizing only; actual implementations must repeat combined
qualification before each later feature is enabled.

### Protocol and persistence choices still block Phase 1A

- Produce machine-readable OpenAPI/AsyncAPI/domain schemas, canonical
  serialization/hash rules, errors, bounds, compatibility fixtures and golden
  vectors before independent runtime implementations.
- Select persistence durability, WAL/flush/power assumptions, checksums/scrub,
  backup/restore and numeric RTO/RPO.
- Define expand/contract database migrations, forward/backward startup gates,
  rollback manifests and projection rebuild.
- Select and adversarially validate the Windows/macOS image-decoder sandbox
  before Phase 1A image ingestion.

### Runnable-code CI must arrive with the first scaffold

The current CI correctly protects document hygiene only. The first Phase 0 code
change must add pinned Windows/macOS builds, unit/contract tests, callback
allocation/lock guards, applicable sanitizers, dependency/license/secret scans
and signed test-result manifests.

## P2 workflow and contract hardening

- Define resumable guided mic-check sessions: caller/controller, per-track
  cursor, ready/wait/blocked/skip/recheck, per-dimension actor/evidence,
  concurrency and asynchronous A1 confirmation.
- Make a current printed pack physically present a preflight gate. Specify
  revision/generated/performance markings and emergency-log fields; test low
  light, gloves, handwriting and re-entry.
- During stale cue state, preserve My Track's ordered physical steps/route/
  fallback while marking timing untrusted and prompting confirmation with the
  show caller.
- Keep one primary A2 exception but show all show-critical category badges/count
  so a second independent critical fault cannot disappear.
- Define an idempotent attachment finalize saga across blob store and database,
  including checksum/version, crash orphans, ready publication, deletion and
  evidence pins.
- Separate managed Phase 1A image assets from Phase 1C conversation attachments,
  or explicitly define one shared pipeline with purpose-specific policy.
- Complete page recipient transitions/timestamps and numeric conversation,
  recipient, topic/filter, fan-out and audit limits.
- Separate replay-writer I/O reservation from reader queues/cache; bound and
  cancel seeks and admit readers only with measured headroom.
- Assign browser compatibility ownership, version ranges, MDM/update posture,
  requalification SLA, feature probes, pre-show block/warn and fallback client.
- Define an immutable access-controlled evidence store and signed result-manifest
  schema before Phase 0 evidence is used as a release gate.
- Add a stable aggregate/ID glossary for production, show revision,
  performance, activation, overlay, lease, event and export terminology.

## Previous-blocker assessment

Genuinely resolved at the architecture/product-constraint level:

- one-device/one-clock capture and explicit epochs;
- shared A1/A2 truth and attention split;
- foreground-only dedicated device with intercom as urgent fallback;
- task/incident/chat conceptual separation;
- Source current state as a projection;
- lossy telemetry separated from canonical control history;
- backend-only collaboration authority;
- replay reads outside the audio engine; and
- resource-shedding priority as a design direction.

Partially resolved rather than closed:

- takeover fencing;
- physical swap/identity boundary and prepared-check reuse;
- cue recovery/handover and QLab placement;
- aggregate revisions and cue automaton;
- bitemporal queries/corrections;
- handoff/composite ordering;
- durable reconciliation/pruning;
- lease proof of possession;
- persistence/attachment crash recovery;
- guided mic-check orchestration and printable fallback; and
- Phase 1A scope.

The previous resolution ledger should be revised from “resolved” to
“decision/gate added” for these partial items when the response work begins.

## Strengths

- Conservative real-time boundary and exact single-device behavior.
- Strong sample timeline, capture epochs and replay isolation.
- Correct separation of performer, role, element, transmitter, receiver path
  and audio input.
- Honest stale/unverified, foreground-browser and conventional-fallback policy.
- Narrow offline collaboration authority and explicit control-history intent.
- Useful A1 attention protection and A2 physical/intervention context.
- Good adversarial mindset: partitions, crashes, hostile media, power loss and
  timed theatre drills are release gates rather than afterthoughts.

## Next-review exit criteria

A fourth architecture review should not begin until at least these artifacts
exist:

1. safe takeover/isolation rule and stale-node quarantine;
2. physical-swap identity automaton;
3. cue authority handover plus node-side QLab adapter contract;
4. lease/gateway security ADR and command-class persistence split;
5. command/aggregate and cue transition matrices;
6. temporal query/correction semantics;
7. ledger reconciliation/pruning protocol;
8. normative handoff and mic-check session models;
9. Phase 1A capability/slice matrix; and
10. frozen Phase 0 test-manifest schema and first-code CI requirements.
