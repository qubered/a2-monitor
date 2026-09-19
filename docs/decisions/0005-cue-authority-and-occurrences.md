# ADR 0005: Cue authority, occurrences, and degraded cue context

- **Status:** Accepted
- **Date:** 2026-09-18
- **Owners:** Project team
- **Supersedes:** None

## Context

On Stage, Up Next, expected-silence alerts and intervention windows depend on
cue truth. An A1 or A2 cannot be expected to advance a second line-by-line cue
stack while doing their primary job, and external cue systems expose standby,
preview and start concepts that are not interchangeable.

## Decision

Each performance selects exactly one cue-authority mode:

1. **External observer (preferred):** a read-only adapter ingests events from a
   named authoritative show-control system. QLab 5 OSC show-control broadcast
   is the Phase 1A reference adapter. The product sends no GO/control commands
   back to QLab.
2. **Manual coarse scenes:** a named Cue Tracker advances broad operational
   scenes. This mode does not promise line-by-line cue precision.
3. **No cue authority:** cue-dependent presentation and alert arming are off.

A `CueDefinition` is reusable plan data. Every accepted transition creates a
unique, monotonic `CueOccurrence` containing runtime sequence, origin, external
event ID where available, receive/effective time, prior occurrence, action and
quality. Repeating or returning to a definition creates another occurrence.
Scheduled changes target an occurrence condition, not a cue label alone, and
are revalidated immediately before execution.

The cue authority has mode and quality as separate state. External observation
progresses through `external-healthy`, `external-stale` and `resync-required`;
manual tracking is a deliberate named transfer, never an automatic fallback.
The complete handover/rebase and late-event fencing automaton is in
[cue and operator state machines](../architecture/cue-and-operator-state-machines.md).
On stale/unknown/resync-required:

- cue-derived alerts and automatic state transitions fail to unarmed/unknown;
- last context remains visibly historical, never current truth;
- all sources remain searchable and global critical system faults remain shown;
- an authorized operator can resync to a selected definition, creating a new
  occurrence and audit event.

Manual controls are `go`, `select/resync`, `hold`, `resume`, `back` and `skip`.
Back/skip always creates a new occurrence and recomputes expected state from an
absolute snapshot attached to the target definition, not by attempting to undo
arbitrary deltas.

For QLab, GO is distinct from cue start, audition GO and playhead movement.
Mappings use workspace and cue unique IDs; cue number/name are display data.
Preview/audition is ignored for live performance state unless an explicit
rehearsal policy says otherwise. Heartbeat/connection loss makes authority
stale.

The QLab observer is a supervised node-side, sandboxed non-real-time worker with
an allow-listed show-control network path, `/listen` renewal, heartbeat,
generation/cursor, normalization and bounded dedupe/reorder behavior. It cannot
send QLab control. Backend restart therefore does not move cue authority.

## Consequences

### Positive

- Cue drift fails visibly and cannot create confident false conclusions.
- Repeated cues and scheduled transactions have deterministic boundaries.
- QLab provides a useful first integration without being remotely controlled.

### Negative

- Productions must map operational cue definitions to external events.
- QLab is not universal; the adapter interface and manual mode remain required.
- Coarse manual mode provides less automation.

## Alternatives considered

- **Manual line-by-line tracking:** rejected as operationally unrealistic.
- **Treat QLab playhead as current cue:** rejected because it represents
  standby/position rather than proof of execution.
- **Infer scenes from receiver/audio behavior:** rejected as circular and
  unsafe for alert arming.

## Validation

- run new adapters in shadow mode against an independent rehearsal cue log
  before they may arm any cue-derived production behavior;
- GO/start/audition/playhead/panic/reset and reconnect fixtures;
- duplicate, dropped, reordered and repeated cue events;
- back, skip, hold, resync and scheduled-change revalidation;
- cue stale/unknown suppression of every dependent alert/view; and
- full dress-rehearsal comparison against the production's called cue record.
