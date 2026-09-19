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

## Physical-change aggregate and component truth

Performer/role intent and physical component truth are separate projections. A
performer may remain assigned to a role while no element, transmitter, receiver
association or captured path is currently present. The product must show that
gap rather than retaining the removed component as “current.”

Each component relationship—element, transmitter, receiver path and captured
input—has its own valid interval. These commands are the only physical
boundaries:

- `RecordComponentDisconnected` closes the named component interval at its
  observed boundary;
- `RecordComponentInstalled` opens the replacement component interval at its
  observed boundary; and
- `RecordSignalPathState` records `no-current-path`, `partial`,
  `associated-unverified`, `captured-unverified` or `audible-verified` without
  inventing a component boundary.

One command may contain several component boundaries only when the operator and
capture evidence support the same effective frame/time. Ordinary pack changes
use separate disconnect and install events. A projection with no open component
interval returns explicit `none`, never the most recently closed row.

The overall intervention follows:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `reserved` | intended assets/paths are exclusively reserved | `prepared`, `expired`, `abandoned` |
| `prepared` | parts and reusable checks are ready | `change-in-progress`, `expired`, `abandoned` |
| `change-in-progress` | operator began work; component intervals still determine truth | `partial`, `installed-unverified`, `failed`, `abandoned` |
| `partial` | one or more disconnect/install boundaries occurred; path may be absent | `partial`, `installed-unverified`, `failed`, `abandoned`, `reverted`, `fallback-active` |
| `installed-unverified` | intended component set is present; RF/audio remain unverified | `verified`, `failed`, `reverted`, `fallback-active` |
| `verified` | required fit/association/RF/audio/mute/battery checks pass | `a1-receipt-pending`, `complete`, `failed`, `reverted` |
| `a1-receipt-pending` | policy asks A1 for mix-path receipt | `complete`, `complete-receipt-unavailable`, `failed` |
| terminal | `complete`, `complete-receipt-unavailable`, `failed`, `abandoned`, `expired`, `reverted`, `fallback-active` | compensating transaction only |

A multi-role cast plan atomically commits intentions and reservations to detect
duplicate/uncovered tracks. Every physical component then changes independently.
The dashboard shows role intent, each open component interval and observed path
state, so staggered work is never presented as simultaneous.

### Exceptional paths

- **Fast spare promotion:** one UI workflow guides the same disconnect/install/
  observe/check events; it never bypasses component boundaries. Still-valid
  checks are retained by tuple policy.
- **Physical-first emergency:** records each known component boundary post-hoc
  with the operator's best time/frame and uncertainty; recorded time remains
  later. Unknown gaps stay unknown.
- **Failure before any disconnection:** old component intervals remain current;
  release or quarantine reservations/assets explicitly.
- **Failure after disconnection:** the closed component stays closed and the path
  may remain `no-current-path` until a real reinstallation/fallback boundary.
- **Failure after installation:** new identity remains current but unverified
  until `reverted` or a `fallback-active` boundary records another physical
  truth. A red state never silently rolls identity back.
- **A1 unavailable:** an authorized operator records reason and conventional
  intercom attempt; policy determines whether `complete-receipt-unavailable` is
allowed. Physical effectiveness does not wait for the UI.

Replay resolves performer/role and every component/path independently at the
requested boundary. During a change it may correctly display “performer assigned;
transmitter: none; captured path: none” and associate the dropout with the
physical change transaction.

## Verification reuse

A reusable check is a signed evidence record over this exact tuple:
component IDs, performer, costume/build, placement, receiver path, captured
input, zone, check dimension, method and policy version. Default maximum ages
before show-specific tightening are: sync/association 8 hours, RF path 2 hours,
battery 60 minutes, audio path 30 minutes, placement/fit 30 minutes, and mute
behavior 30 minutes. Any tuple change invalidates affected dimensions. No check
survives a failed/quarantined asset state or an authority/timeline ambiguity.
