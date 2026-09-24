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
   timing) and marks it stood down. A stood-down channel is judged like one the
   running session does not use: no RF-lost, no-audio or transmitter-mute
   findings, and its verdicts read not applicable rather than fault.
3. **It re-arms by itself.** A stood-down channel is armed again the moment a
   transmitter is detected or signal above the silence floor is observed. From
   then on every finding applies as before. Stand-down is in memory and does
   not survive a backend restart, which also starts channels unarmed.
4. **Live offers it in the channel detail.** "Clear alerts and reset" appears
   in the expanded channel view while the channel has an alert or a caution or
   fault verdict, and only while the backend is reachable. It is one press with
   no confirmation because the alerts remain in history and the channel
   re-arms on its own.

## Consequences

- A switched-off channel can be silenced by any operator without ending the
  session, and returns to full monitoring when it is switched back on.
- Risk: resetting a channel that has actually failed hides it until a
  transmitter or signal is seen. If the fault leaves both absent the channel
  stays quiet, exactly as an unused channel does. Alerts remain in history.
- The reset is not attributed to an operator and stand-down is not shown in
  the state document. Both are candidates if operators need them.

## Validation

- Unit tests: clearing one channel's alerts and pending findings without
  touching others; end to end through the route, a silent channel's No audio
  alert clears, stays clear while off, and returns after signal comes and goes;
  an unknown channel is refused; Live posts the reset from the channel detail
  and shows the returned state.
