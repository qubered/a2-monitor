# Cue and operator session state machines

**Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).

## Cue authority

QLab observation runs in a supervised, sandboxed, non-real-time worker on the
audio node, never in the capture callback or backend. The worker has an allow-
list for the configured show-control interface/host/UDP port only. It renews
QLab `/listen`, records a heartbeat, normalizes workspace/cue unique IDs and
publishes bounded adapter events to the node sequencer. It stores a restart
cursor/dedupe window in the node ledger. Duplicate external IDs are ignored;
events older than the reorder window are evidence but cannot advance authority.
The adapter cannot send GO or any QLab control command.

The authority state machine is:

| State | Accepted operation | Result |
| --- | --- | --- |
| `disabled` | `EnableCueAuthority` with selected external/manual mode and absolute starting definition | new authority generation; selected healthy state |
| `external-healthy` | normalized external occurrence | new occurrence; remain healthy |
| `external-healthy` | heartbeat loss, gap, restart ambiguity | `external-stale` and unarm cue-derived behavior |
| `external-stale` | connection returns | `resync-required`; events buffered as untrusted |
| `external-stale`/`resync-required` | `BeginCueRebase` + `CommitCueRebase` to selected external ID | new rebase occurrence; fence older cursor; `external-healthy` |
| `external-stale`/`resync-required` | `TransferCueAuthority` to named Cue Tracker and selected definition | new transfer occurrence; `manual-healthy` |
| `manual-healthy` | go/back/skip/hold/resume | new manual occurrence/quality transition |
| `manual-healthy` | deliberate transfer back with external rebase | new transfer occurrence; `external-healthy` |
| any non-disabled state | `DisableCueAuthority` | `disabled`; cue-derived behavior unarmed |

There is no automatic external-to-manual promotion or switch-back. Late events
from a fenced adapter generation are retained as evidence and cannot alter the
cursor. Every transition carries adapter generation, prior/new mode, actor,
reason, selected absolute cue snapshot and expected revision.

External authority cannot arm cue-derived production behavior merely because the
adapter connects. The exact production mapping must pass the closed
`cue.qlab-shadow.v1` evidence test: at least three full runs with zero missed or
false authoritative occurrences, zero duplicate advances, zero fenced-late
advances and correct stale unarming across reconnect, audition and panic/reset
faults. Any mapping/QLab workspace change invalidates that qualification.

`hold` freezes scheduled-condition evaluation but does not delete the current
occurrence. `resume` creates a quality event and continues from that occurrence.
`back` and `skip` each create a new occurrence from the target definition's
absolute snapshot. `resync` and authority transfer also create occurrences.
Canceling a scheduled operation records a cancellation; revisiting a cue label
does not resurrect it. Conditions are limited in v0 to occurrence ID, definition
ID plus nth occurrence after a sequence, or cue-rank crossing within the active
authority generation; all are revalidated at execution.

## Guided mic-check session

A mic check has a named controller, optional caller, ordered track set, policy,
revision and one cursor per track. Track states are `not-ready`, `ready`,
`checking`, `waiting`, `blocked`, `skipped`, `needs-recheck`, `complete` and
`failed`. Fit, association, RF, battery, audio, mute and A1 receipt are separate
dimensions with actor, method, evidence/time and validity tuple.

Every command carries the expected session revision and target-track cursor.
Another operator may record a dimension concurrently only if both revisions
still match; otherwise they receive a diff. Sessions survive client reload and
can be reassigned explicitly. A1 confirmation is asynchronous and never
fabricated by the A2 controller. Close requires all policy-required dimensions
complete or a named authorized waiver per dimension.

## Shift handoff

The handoff aggregate is `draft -> outgoing-attested -> incoming-accepted`.
`disputed` requires `ResolveHandoffDispute` and re-acceptance. Late imports mark
it `stale`, requiring `ReattestHandoff`. `authorized-forced` is terminal only for
an absent/incapacitated outgoing operator and records authorizer/reason. If the
incoming operator is absent/late, the handoff remains open and explicitly records
a `coverage-gap`; an authorized temporary operator must accept coverage before
the outgoing operator releases responsibility.

Every current item explicitly transfers, remains with outgoing, is released to
the queue, or is reassigned. The same transaction covers future track/zone
responsibility, intervention plans, prepared-spare custody and physical asset/
key custody. A handoff cannot be accepted while any required coverage/custody
row has no responsible person, except an authorized forced gap with a deadline
and conventional-radio escalation.

The outgoing attestation freezes a composite watermark: latest canonical node
ledger sequence/epoch plus latest imported backend event sequence. Late node
imports or reopened incidents after that watermark mark the handoff stale and
require a new delta attestation/acceptance. Task `Release` and `Reassign`, and
incident `HandoffCoordinator` and `ReleaseCoordinator`, are first-class commands
with expected revisions. Their backend events cause ordered system messages;
chat text cannot change lifecycle state.

## Printed fallback

Preflight requires the current printed pack to be physically present at the A2
position. Each page shows production, performance, show revision, generated
time, pack revision and page count. The emergency log captures actual cue/time,
performer/role, old/new element/transmitter/receiver/input, physical boundary,
fit/RF/audio/mute/battery/A1 checks, uncertainty, reason and operator initials.
Low-light, gloves, wet hands, handwriting space and later audited re-entry are
timed rehearsal tests.

When cue state is stale, My Track retains route, ordered physical actions,
fallbacks and responsible people, but removes trusted countdown/scheduling and
shows: “Cue timing untrusted—confirm the current moment with the show caller.”
