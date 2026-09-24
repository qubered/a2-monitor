# ADR 0030: Rooms and categories for the MVP

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-24
- **Owners:** Project team
- **Supersedes:** None; amends ADR 0029

## Context

Corporate events run several rooms at once — a ballroom keynote while a
breakout runs a workshop — and technicians look after one room, not the whole
patch ([reference productions](../product/reference-productions.md)). ADR 0029
gave the show one run of show, so a workshop starting in the breakout would
have made every ballroom channel idle, and every Live device showed every
channel in one flat grid.

## Decision

For the local MVP only:

1. **Rooms and categories are part of the show.** The showfile gains an
   optional ordered `rooms` list; each room has an ordered list of
   `categories` (stage, audience, lectern, band — whatever the event uses).
   A channel may name a `roomId` and a `categoryId` in that room. Saves mint
   missing room and category ids (Manager also mints them in the browser so a
   new room can be assigned before the first save), clear a channel's room or
   category when the show no longer has it or the category is not in that
   room, and reject duplicate ids or blank names. Rooms are edited in
   Manager's Rooms section and assigned per channel in Channels.
2. **Each room runs its own sessions.** A session may name a `roomId`; its
   channels must be in that room (saves drop the others). The backend holds
   one running session per room — sessions and channels in no room form one
   more run — so rooms turn over independently. `PUT /api/v1/live/session`
   starts a session in its own room, or ends one room's run with
   `{ sessionId: null, roomId }`. `session.json` stores the runs by room.
3. **The live state carries the organisation.** The single `session` summary
   from ADR 0029 is replaced before release by `rooms` (rooms and categories)
   and `runs` (one run of show per room that has sessions). Channels gain
   `roomId` and `categoryId`. Both new top-level fields are optional so older
   producers still validate.
4. **Live shows one room per device.** A room bar (All rooms, each room, and
   No room when some channels have none) picks what this device shows; the
   choice is remembered per device and falls back to All rooms when the show
   no longer has it. The grid is grouped under category headings (prefixed by
   the room when showing all rooms), in showfile order. Each visible room has
   its own now/next bar and turnover sheet. The header's alert count and the
   exceptions sheet stay show-wide, so a critical fault in another room is
   still counted; the grid itself stays on its room.

## Consequences

### Positive

- Rooms turn over independently; starting a breakout workshop never makes the
  ballroom idle.
- A technician's device shows only their room, grouped the way the room is
  laid out.

### Negative

- Categories are organisation only: they do not change alerting, listening or
  permissions.
- A channel belongs to at most one room. A shared spare that moves between
  rooms is re-assigned in Manager.
- Room choice is a device preference, not a permission (ADR 0026's trust
  boundary).

## Alternatives considered

- **Rooms as grouping only, with one show-wide run of show.** Rejected by the
  operator: concurrent rooms need independent turnovers.
- **Free-form tags instead of room and category.** Rejected for now: the
  corporate day is physically room-shaped, and a fixed two-level hierarchy
  gives predictable headings and a clear owner for each session.

## Replacement gate

Replace with the durable model's rooms, zones and assignments when the
control ledger and authorization exist.
