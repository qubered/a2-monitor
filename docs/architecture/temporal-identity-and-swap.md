# Temporal identity and physical-swap automaton

**Status:** Normative design baseline for protocol v0

## Bitemporal record

Every cast, microphone-component and signal-path assignment stores:

- stable `assignment_id`, `logical_slot_id`, `performance_id` and kind;
- half-open valid interval `[valid_from, valid_to)` on capture epoch/frame when
  available, otherwise monotonic/UTC plus explicit uncertainty;
- half-open recorded interval `[recorded_from, recorded_to)` in the authority
  ledger sequence;
- authority epoch, aggregate revision, transaction ID and actor;
- payload identities and verification references; and
- optional `supersedes_assignment_id` and correction reason.

`current physical truth` means the nonsuperseded row whose valid interval
contains the queried frame/time and whose recorded interval is open at the
latest canonical ledger position. `as known then` applies both the media time and
the requested ledger position. Replay defaults to latest-corrected physical
truth and offers an audited “as known during show” view. Uncertainty is shown;
it is never converted to false frame precision.

Corrections append a new row and close the prior row's recorded interval. They
may correct a valid boundary, but cannot change original event bytes. If two
candidate rows overlap the same exclusive asset/slot, the projection is invalid
and mutation stops; epoch, recorded order or wall clock is not a silent
tie-breaker. Cross-epoch ordering uses canonical reconciliation order after the
takeover quarantine decision, not raw timestamps.

## Physical-swap aggregate

Each physical assignment, not the whole cast plan, follows this automaton:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `reserved` | intended asset/role/path is exclusively reserved | `prepared`, `expired`, `abandoned` |
| `prepared` | required parts and applicable reusable checks are ready | `change-in-progress`, `expired`, `abandoned` |
| `change-in-progress` | operator has begun physical work; old identity remains current | `installed-unverified`, `failed`, `abandoned` |
| `installed-unverified` | **identity-effective boundary recorded atomically**; new identity is current | `verified`, `failed`, `reverted`, `fallback-active` |
| `verified` | required RF/audio/fit/mute/battery dimensions satisfied | `a1-receipt-pending`, `complete`, `failed`, `reverted` |
| `a1-receipt-pending` | policy asks A1 for mix-path receipt | `complete`, `complete-receipt-unavailable`, `failed` |
| terminal | `complete`, `complete-receipt-unavailable`, `failed`, `abandoned`, `expired`, `reverted`, `fallback-active` | compensating transaction only |

`RecordInstalledBoundary` is the sole identity-effective transition. In one
node transaction it closes all old exclusive intervals, opens the new intervals,
increments every affected assignment revision and records capture boundary plus
uncertainty. Database preparation, physical touch, RF visibility and A1 receipt
are not substitutes.

A multi-role cast plan atomically commits intentions and reservations so it can
detect duplicate/uncovered tracks. Physical changes then progress independently;
uninstalled roles remain on their old current identity. A dashboard shows plan
progress without pretending staggered installations were simultaneous.

### Exceptional paths

- **Fast spare promotion:** allowed from `prepared` directly through the same
  installed-boundary transaction, retaining only still-valid checks.
- **Physical-first emergency:** creates `installed-unverified` post-hoc with the
  operator's best boundary and uncertainty; recorded time remains later.
- **Failure before installation:** old identity remains current; release or
  quarantine reservations/assets explicitly.
- **Failure after installation:** new identity remains current but unverified
  until `reverted` or a `fallback-active` boundary records another physical
  truth. A red state never silently rolls identity back.
- **A1 unavailable:** an authorized operator records reason and conventional
  intercom attempt; policy determines whether `complete-receipt-unavailable` is
  allowed. Physical effectiveness does not wait for the UI.

## Verification reuse

A reusable check is a signed evidence record over this exact tuple:
component IDs, performer, costume/build, placement, receiver path, captured
input, zone, check dimension, method and policy version. Default maximum ages
before show-specific tightening are: sync/association 8 hours, RF path 2 hours,
battery 60 minutes, audio path 30 minutes, placement/fit 30 minutes, and mute
behavior 30 minutes. Any tuple change invalidates affected dimensions. No check
survives a failed/quarantined asset state or an authority/timeline ambiguity.
