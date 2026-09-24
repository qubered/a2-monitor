# ADR 0032: Reset a switched-off channel to its default state

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-25
- **Owners:** Project team
- **Supersedes:** None. Extends [ADR 0027](0027-mvp-live-monitoring-and-alerts.md).

## Context

Switching a transmitter off mid-show raises "Transmitter not detected" and,
after the silence timeout, "No audio". Both hold for as long as the channel is
off, and acknowledging never clears (ADR 0027). An A2 had no way to return a
deliberately switched-off channel to the quiet state it had before it was
first used, short of ending the run-of-show session or restarting the backend.

Clearing only the current alerts does not work: the same findings would raise
again a moment later.

## Decision

For the local MVP only:

1. **Reset is a backend action.** `POST /api/v1/channels/:channelId/reset`
   clears every active alert on that channel into the bounded alert history
   (with a cleared time), forgets findings still counting toward a raise or
   clear, and returns the updated `live-state`. An unknown channel returns
   `404 channel-not-found`. No new contract is needed.
2. **The channel returns to its unarmed default.** The backend clears what it
   has learned about the channel (audio heard, transmitter seen, silence
   timing), exactly as at backend start. RF-lost and No audio only arm after a
   transmitter or signal has been seen, so they stay quiet, and the card reads
   as a channel not yet used: RF caution while no transmitter is detected,
   Audio and Battery unknown. It is not marked not applicable.
3. **It re-arms by itself.** The channel arms again the moment a transmitter is
   detected or signal above the silence floor is observed, and every finding
   applies as before. Nothing is stored: a backend restart also starts channels
   unarmed.
4. **Live offers it in the channel detail.** "Clear alerts and reset" appears
   in the expanded channel view while the channel has an active alert or a
   fault verdict, and only while the backend is reachable. It is one press with
   no confirmation because the alerts remain in history and the channel
   re-arms on its own.

## Consequences

- A switched-off channel can be silenced by any operator without ending the
  session, and returns to full monitoring when it is switched back on.
- Risk: resetting a channel that has actually failed hides it until a
  transmitter or signal is seen. If the fault leaves both absent the channel
  stays quiet, exactly as an unused channel does. Alerts remain in history.
- The reset is not attributed to an operator and is not shown in the state
  document. Both are candidates if operators need them.

## Validation

- Unit tests: clearing one channel's alerts and pending findings without
  touching others; end to end through the route, a silent channel's No audio
  alert clears, stays clear while off, and returns after signal comes and goes;
  an unknown channel is refused; Live posts the reset from the channel detail
  and shows the returned state.
