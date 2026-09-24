# ADR 0033: Per-channel monitor trim

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-25
- **Owners:** Project team
- **Supersedes:** None. Extends [ADR 0026](0026-webrtc-opus-listen-mvp.md) and
  [ADR 0031](0031-shared-host-monitor-output.md).

## Context

Every operator sets their own monitor level, but some inputs are simply hot or
quiet for the whole show (a distant boundary mic, a hot instrument feed). Each
operator had to correct that by hand on every channel change. A level set once
for the channel, under the operator's own level, was requested.

## Decision

For the local MVP only:

1. **Trim lives in the showfile.** Each channel has an optional `trimDb`
   (−24 to +24 dB, absent means 0), edited in Manager's **Channels** tab in
   0.5 dB steps and saved with the production. The backend rejects values
   outside the range through the showfile schema.
2. **Trim is first in the chain.** The listened level is
   `trim + operator level (+ dim)`, then mute. Trim changes only the monitor
   path. It never changes meters, alerts, level history, replay or the captured
   audio, so RF, silence and clipping judgements are unaffected.
3. **It applies on every listening path.** On this device Live adds the
   channel's trim to the browser's gain stage for the selected channel and
   follows it when the selection or the showfile changes. On a host output feed
   the listen gateway adds the trim of the patched input (the first channel
   patched to it) to the feed's gain and sends the worker the new mix whenever
   the showfile's trims change.
4. **The published state carries it.** `live-state` channels gain an optional
   `trimDb` (0 when unset). Live shows "Trim +6 dB" on a trimmed card, and a
   Monitor trim reading in the channel detail, so no one is surprised by a level.
5. **The worker's ceiling covers both.** The worker's linear gain clamp rises
   from +24 dB to +48 dB, a +24 dB trim under a +24 dB operator level. The
   operator's level itself stays −60 to +24 dB.

## Consequences

- A hot or quiet input is corrected once, for everyone, on every path.
- Risk: at the extremes trim and level add to +48 dB. Nothing limits the signal
  after the gain, so a loud input will clip and can be loud in headphones. Trim
  is a show-file setting, visible on the card, and the operator can still mute
  and dim (one touch) or lower their own level.
- Two inputs patched to one channel share the first channel's trim on host
  feeds.
- Trim is not applied to replay or verification listening, which do not exist
  in the MVP.

## Validation

- Unit tests: showfile trim range, `live-state` publishes trim, gateway command
  gain (trim under level, dim and mute), a host feed applying the showfile trim
  end to end, the browser gain stage adding and bounding trim, Live's badge and
  trim hand-off on selection, and Manager's rounding, clamping and save.
- Contract fixtures: a showfile with trim, and one out of range.
