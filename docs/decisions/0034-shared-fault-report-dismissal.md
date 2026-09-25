# ADR 0034: Shared fault-report dismissal

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-25
- **Owners:** Project team
- **Supersedes:** None. Amends [ADR 0028](0028-mvp-shared-checks-and-fault-reports.md).

## Context

ADR 0028 made mic checks and A1 fault reports shared, backend-owned state.
The A2's "Dismiss" button on an unclaimed report's banner was left out of
that: it wrote a report id to `localStorage`, so dismissing hid the banner
only on the device that pressed it. Several A2s sharing one comms feed
(ADR 0031) each had to dismiss the same banner separately, and a fresh
device (or a cleared browser) saw it again.

## Decision

For the local MVP only, dismissal joins the shared report state:

1. `dismiss` is a `POST /api/v1/reports/:id/actions` action alongside
   `undo`, `urgent`, `claim`, `resolve`, `confirm-fixed` and `reopen`. It is
   only valid on an open (unclaimed) report; claiming, resolving or closing a
   report makes the question moot, since the banner already stops showing it.
2. `FaultReport` gains `dismissedBy` and `dismissedAtUtc`, both nullable,
   published in the ADR 0027 live state like every other field on the
   report.
3. Live filters the banner on `dismissedAtUtc === null` instead of a
   `localStorage` set, and calls the new action instead of writing to
   storage.

## Consequences

- Any A2 dismissing a banner clears it for every A2, matching the shared
  comms feed they already listen on together.
- Dismissal is attributed (`dismissedBy`), unlike the previous local-only
  behavior.
- As with the rest of ADR 0028, there is no authentication: anyone on the
  trusted LAN can dismiss as any name.

## Alternatives considered

- **Keep dismissal per device.** Rejected: it was the one piece of report
  state that disagreed between A2s looking at the same shared feed.
- **Scope dismissal to a host-output feed rather than globally.** Rejected
  for the MVP: reports are already global, not feed-scoped, and the
  listen gateway holds no viewer roster to key a per-feed dismissal on.

## Replacement gate

Same as ADR 0028: replace the unauthenticated route when authorization and
the leased node path exist.
