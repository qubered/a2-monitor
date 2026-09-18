# A1/A2 and collaboration independent review

**Status:** Incorporated into the plan on 2026-09-18; implementation evidence
remains required

**Reviewed:** 2026-09-18

Three reviewers independently read only the repository: a theatre A1/A2/RF
operator, a domain/API architect, and a real-time audio/platform/security
engineer. They did not edit the plan or consult one another. Priorities below
refer to the proposed supervised rehearsal product; Phase 0 remains a technical
validation exercise.

## Combined verdict

- **Go for Phase 0A** after creating a versioned repository baseline.
- **Conditional go for a bounded Phase 0B** if the authority, durability,
  resource-isolation, browser-audio and overload questions become explicit
  experiment gates.
- **No-go for Phase 1 implementation or supervised rehearsal use** until the
  P0/P1 semantics below are resolved and the Phase 1 scope is recut.

The reviewers agreed that the real-time boundary, one-device model, capture
epochs, shared A1/A2 truth and distinction among chat, tasks and incidents are
strong. Their concern is that workflow and collaboration scope has grown faster
than runtime authority, physical-world verification, authorization, recovery
and appliance capacity contracts.

## P0 rehearsal blockers

### Cue authority is not operationally credible

Fine-grained On Stage, Up Next, expected-silence, alert and intervention-window
behavior depends on a current cue, but Phase 1 relies on manual/API movement
while show-control integrations are deferred. Define the cue authority and
operator, standby/go/hold/back/skip/resync semantics, repeated cue occurrences
and a visible unknown/stale mode that suppresses cue-derived conclusions.
Either bring one read-only show-control adapter into Phase 1 or deliberately use
coarser scenes advanced by a named operator.

### Product assignment truth can outrun the physical swap

An atomic assignment transaction does not retune, pair, sync, repatch Dante or
change a console. Add a physical workflow such as `prepared -> change in
progress -> installed/unverified -> RF/audio verified -> A1 confirmed`, a fast
promotion for a fully preverified spare, and post-hoc recording with actual
effective time. Identify which steps are product identity, receiver, Dante and
console actions.

### Runtime command authority needs fencing

The backend API and direct browser-to-node lease can both appear able to mutate
cue/runtime assignments during a partition. Select a sequencer per runtime
aggregate and define an authority epoch/fencing token, preview issuer, commit
destination, lease invalidation, takeover, reconnect freeze and one shared
idempotent command/result ledger.

### Identity-changing offline history cannot use a lossy journal

A bounded node journal may roll over while its current overlay contains swaps
the backend cannot reconstruct. Separate telemetry retention from a durable
control ledger kept through performance close and successful reconciliation.
Use checkpoints plus an event tail and stop accepting offline mutations before
durable capacity is exhausted.

### Foreground-only mobile operation needs a physical operating profile

An A2 will pocket/lock the device, use the camera or intercom, and work hands-on.
The product cannot call a foreground-only page an authoritative urgent path.
Intercom/radio remains authoritative in version one. Select and test a supported
screen-awake/mounted/body-worn/MDM profile across a full show. Reliable
background alerting or listening remains a native-client trigger.

## P1 contract and workflow findings

1. Split Phase 1 into an operational core, basic text collaboration and later
   rich media/direct-message/transcription work. The current 10–14 week bundle
   is not credible for a four-to-six-person team.
2. Model cue occurrences and monotonic runtime sequence separately from cue
   definitions; define skip/back/repeat and scheduled-transaction ordering.
3. Define aggregate-specific concurrency tokens and durable idempotency
   records instead of overloading show/performance revision.
4. Adopt explicit bitemporal assignment semantics and ordering across capture
   epoch/frame, monotonic time, UTC, late events and corrections.
5. Make Source current bindings read-only projections, not a second mutable
   identity authority.
6. Publish complete task and incident transition tables. Give A1 two simple
   actions: **Request check** creates a task; **Report fault** creates an
   incident. Status buttons may also post a system message; quick chat text must
   not silently change lifecycle.
7. Narrow offline operation to evidence/check/emergency commands unless node
   incident lifecycle authority and reconciliation are specified separately.
8. Split subscription domains into durable performance events,
   per-conversation message sequence, node control sequence and ephemeral
   meters/presence/typing, each with snapshot and resume rules.
9. Add object-level collaboration authorization, midstream revocation and
   browser-cache purge rules; scopes alone are insufficient.
10. Model each priority-page recipient and distinguish accepted, dispatched,
    received/displayed where provable, acknowledged, expired and failed.
11. Add a generic quarantined attachment resource with processing states,
    rendition hashes, quotas, orphan cleanup and retention inheritance.
12. Define the durable acceptance/RPO boundary for messages, pages, tasks and
    attachments, and split backend process, database, disk, migration and asset
    failures in the failure matrix.
13. Isolate collaboration load with CPU/memory/thread/socket/disk reservations,
    admission limits and the overload order: capture, live media/control,
    replay, state, chat, then attachment/transcription work.
14. Prove that acquiring a microphone for a voice note and playing a page tone
    cannot change output route, latency, gain or WebRTC monitoring continuity;
    otherwise feature-gate them by client profile.
15. Specify replay reader/prefetch/mix ownership so seeks and disk work cannot
    enter or backpressure the audio engine.
16. Add an atomic multi-role cast-plan transaction with per-component
    disposition for swing cascades.
17. Model quick changes as ordered intervention plans with route/zone, due
    cue/window, owner, prepared asset, checks, hard deadline and fallback.
18. Add a guided one-handed mic-check mode, separate physical-fit/A1-heard
    verification and selective check invalidation after swaps.
19. Make handoff an accepted shift checkpoint over performance events, not a
    chat read cursor, and include a verbal-brief reminder.
20. Generate a versioned printable/offline cast-pack-receiver-input, placement,
    spare and quick-change pack plus a blank emergency change log.

## P2/P3 refinements

- Reduce default A2 card density to identity, next action/window, strongest
  exception, owner and listen/claim; put RF and swap detail in the inspector.
- Clarify Phase 1 versus Phase 2 replay scale and reader/export guarantees.
- Cache authorized placement-detail variants, not thumbnails alone, and provide
  a text fallback.
- Support serialized, lot/batch and consumable microphone inventory modes.
- Separate incident coordinator from parallel child-task workers.
- Use stable workspace template IDs and call A1/A2 access a presentation
  entitlement, never operational authority.
- Replace overloaded “acknowledge” with incident-seen, page-acknowledged,
  alert-acknowledged, message-read and impact-confirmed terminology.
- Add Windows/macOS host-hardening and browser-version drift policies.
- Set numeric collaboration/attachment/page/subscription capacity limits.
- Pin CI actions immutably before relying on CI as validation evidence.

## Strong decisions retained

- A1 and A2 are presentations of one performance truth, not separate products
  or security roles.
- Performer, role, microphone element, transmitter, receiver path and audio
  input remain independent, time-bounded identities.
- Chat, task, incident, reaction, read state, ownership and resolution are not
  interchangeable.
- A1 attention protection and A2 physical/intervention context match theatre
  operating pressure.
- Capture, WebRTC and browser claims are framed as measurable hypotheses.
- Real-time callback isolation, exact-device behavior, stale-state handling and
  the conventional fallback are appropriately conservative.
- Sensitive performer images, voice, messages and replay are recognized as
  protected local data.

## Decisions made in response

1. Phase 1A includes a read-only QLab observer, manual coarse-scene fallback and
   no-cue mode; it does not depend on manual line-by-line tracking.
2. Version one uses a dedicated screen-awake foreground device and intercom as
   the urgent path; a background promise triggers native-client evaluation.
3. Phase 1 is split into 1A operational core, 1B bounded text/pages and optional
   1C rich attachments/direct messages/transcription.

No finding in this review blocks Phase 0A capture/time experiments. The findings
below are now addressed as requirements, decisions and architecture gates; none
is implementation evidence because the code does not exist yet.

## Resolution ledger

| Review theme | Plan response |
| --- | --- |
| Cue authority/drift/occurrences | ADR 0005 selects external observer, manual coarse or no-cue mode; QLab 5 is the first read-only observer; stale/unknown unarms derived behavior. |
| Foreground A2 reachability | ADR 0006 defines a dedicated screen-awake profile and makes intercom/radio authoritative; background promise triggers native evaluation. |
| Physical swap versus database truth | Cast/mic workflow adds prepared, changing, installed-unverified, RF/audio-verified and A1-confirmed stages, fast spare promotion and post-hoc effective time. |
| Split runtime command authority | ADR 0004 makes the active node the sole cue/overlay sequencer with authority epoch, one command ledger and fenced takeover. |
| Lossy offline history | Canonical runtime control/result ledger is non-evicting through reconciliation; offline mutation stops before reserve exhaustion. |
| Phase 1 overload | Roadmap is split into 1A operational core, 1B bounded text/pages and optional 1C rich collaboration. |
| Swing cascades | Atomic multi-role cast-plan preview/commit with per-component disposition and no-gap/no-duplicate validation. |
| Quick changes | Intervention-plan entity adds route, window/deadline, owner, ordered steps, prepared assets, blocker and fallback. |
| Task/incident/chat confusion | Collaboration contract defines Request check versus Report fault, full transition tables and separate seen/claim/read/page semantics. |
| Mic check execution | Guided track/zone call-response mode, one-handed controls, physical-fit/A1-heard split and selective invalidation. |
| Offline incident ambiguity | Task/incident lifecycle is backend-only; node records checks/evidence markers plus emergency cue/assignment events. |
| Show-pressure validation | Timed dress-rehearsal drills and operator-error/time/clarification measures added to tests. |
| Independent fallback | Versioned printable show pack and emergency change log added. |
| Handoff cursor | Accepted shift checkpoint over durable performance events replaces chat-read cursor. |
| Placement images | Detail variants are versioned with author/age and text fallback; browser persistence is restricted. |
| Replay scope contradiction | Phase 1A is 10 minutes/64 inputs/two readers; Phase 2 owns 30 minutes/128 inputs/full declared readers. |
| Dense A2 cards | Default cards now show next action, strongest exception, owner and listen/claim; detail moves to inspector. |
| Unsafe reconciliation wording | Physical verification is required before a new epoch/revision can supersede offline swaps. |
| Inventory serialization | Asset classes can be serialized, batch/lot-counted or untracked consumables. |
| Incident coordinator/workers | One coordinator is separate from parallel child-task assignees. |
| Revision ambiguity | Collaboration/protocol contracts define show, authority, overlay, cue, task, incident, conversation and message tokens separately. |
| Bitemporal identity/source dual writes | Domain model adds valid/recorded time and makes Source current relationships read-only projections. |
| Stream durability contradiction | Durable performance, conversation and node-control streams are separate from ephemeral meters/presence/typing. |
| Evidence/privacy retention | Evidence pins immutable message/identity/attachment versions; retention/redaction and URL rules are explicit. |
| Object authorization/revocation | Collaboration contract adds per-object relationship policy, midstream subscription closure, URL invalidation and cache purge. |
| Page delivery ambiguity | Per-recipient accepted/dispatched/received/displayed/acknowledged/expired/failed states and limits are specified. |
| Attachment transaction model | Generic quarantined attachment entity, renditions, hashes, quotas, orphan TTL and ready-only references added. |
| Workspace security ambiguity | A1/A2 templates use presentation entitlements; underlying object/command authorization is unchanged. |
| Schema evolution | Protocol specifies unknown enum, raw event, upcaster/migration and lossless down-conversion behavior. |
| Collaboration resource isolation | ADR 0007 defines priority, quotas, reservations, attachment sandbox and split-host/disable fallback. |
| Voice/notification audio risk | Both are client-profile gated; visual paging is baseline and unsafe profiles disable recording/sound. |
| Lease boundary | Unprivileged gateway, proof of possession, persisted anti-replay, clock/restart and stale-epoch behavior added to ADR 0004. |
| Backend durable acceptance | Collaboration contract defines database transaction/outbox acceptance and failure-specific recovery rows. |
| Replay read isolation | Replay worker owns disk/prefetch/mix; media worker selects prebuffered replay; audio engine performs no replay I/O. |
| Host/browser hardening | Validation matrix adds OS scheduling/power/update and browser version-drift profiles. |
| Numeric collaboration envelope | Initial hard limits for clients, work, messages, uploads, voice, processing, storage and rates are documented. |
