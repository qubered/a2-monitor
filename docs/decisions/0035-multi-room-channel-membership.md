# ADR 0035: A channel may belong to multiple rooms

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-25
- **Owners:** Project team
- **Supersedes:** None. Amends [ADR 0030](0030-mvp-rooms-and-categories.md), which
  said a channel belongs to at most one room.

## Context

ADR 0030 gave each room its own run of show and made a channel belong to at
most one room, re-assigned in Manager when it moves. In practice some
channels are not owned by one room: a shared spare, house comms, or a
talkback channel an A2 wants visible in every room they cover. Requiring a
single room forced a choice that did not match the channel's actual use.

## Decision

For the local MVP only:

1. **A channel names a set of room memberships, not one room.** The showfile
   channel's `roomId`/`categoryId` scalars become `rooms`: an array of
   `{ roomId, categoryId }` pairs, at most 8. Each pair is validated exactly
   as before — an unknown room drops the pair, a category not in that room
   clears to `null` on that pair — just applied per pair instead of once.
   Manager's Channels tab presents this as add/remove room-and-category
   entries rather than one dropdown. A channel with no entries is in no room,
   as before. Saved showfiles with the old scalar fields are migrated to a
   single-entry (or empty) `rooms` array on load.
2. **Category is per membership, not per channel.** The same channel can be
   "Cast" in one room and "Crew" in another; there is no longer one
   channel-wide category.
3. **Alert re-arm state stays per-channel.** Starting a session in any one of
   a channel's rooms re-arms its silence and transmitter-loss alerting (ADR
   0029/0030), and the result is the same in every room's view — there is no
   separate re-arm state per (channel, room) pair. This keeps the tracker
   keyed by channel id, unchanged from ADR 0030.
4. **Session status combines across memberships.** A channel's `session`
   (`inUse`, `nextInUse`, `nextPresenter`) is resolved per room membership
   exactly as ADR 0030 defined for a single room, then combined: `inUse` is
   `true` if any member room's active session includes it, `false` if some
   member room has an active session that excludes it (and none include it),
   otherwise `null`. `nextInUse` combines the same way over each room's next
   session. `nextPresenter` (and the session performer override) comes from
   whichever room membership resolved `true`; with none, the channel's own
   performer, as before. A channel in only one room behaves exactly as it
   does today — this only matters once a channel has more than one.
5. **Live groups a multi-room channel under every room it is in.** Choosing
   "All rooms" shows the channel once per room/category heading it belongs
   to; choosing one room shows it there under that room's own category for
   that membership. The room switch, filters and turnover sheet all key off
   "is this channel in any of the rooms in scope" instead of one equality
   check.

## Consequences

### Positive

- A shared spare or cross-room comms channel can be assigned once per room
  that actually uses it, instead of picking one owner room.
- Session and category stay meaningful per room even when a channel serves
  more than one.

### Negative

- A channel visible in several rooms at once can show a different category
  and a different "in use" state depending on which room's heading it is
  under — expected, but a change from one fixed answer per channel.
- The combined `session` field is a simplification: if a channel is
  genuinely in two different sessions' active line-ups at once, only one
  membership's `nextPresenter` is shown. This has not come up in practice and
  is not expected to for the MVP's corporate-event shape.
- Turnover and "needs someone" filtering now consider every member room, so a
  channel idle in one room but in use in another no longer reads as idle
  anywhere.

## Alternatives considered

- **A separate (channel, room) re-arm and session state.** Rejected for the
  MVP: no product need has appeared for a channel to be simultaneously
  "in session" in one room and "idle" in another with independently tracked
  alert history; per-channel state is simpler and matches how alerts already
  work.
- **Keep one category per channel, independent of room.** Rejected: it broke
  the existing guarantee that a category always belongs to one of the
  channel's actual rooms, and the corporate-event shape (cast in the
  ballroom, crew in the breakout) wants the category to vary by room.

## Replacement gate

Same as ADR 0030: replace with the durable model's rooms, zones and
assignments when the control ledger and authorization exist.
