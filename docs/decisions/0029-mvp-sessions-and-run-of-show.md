# ADR 0029: Sessions and a shared run of show for the MVP

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-24
- **Owners:** Project team
- **Supersedes:** None

## Context

Corporate AV is the product's first deployment context (the fabricated data is
already a corporate all-hands) and the second reference production
([reference productions](../product/reference-productions.md)). Its day is an
agenda: sessions with different presenters, rapid turnovers, shared handhelds
and battery resets between sessions. ADR 0019 made cues optional because most
of these shows have no one maintaining a cue list; an agenda is the structure
they do have.

Without it, the MVP judged every channel all day. A handheld switched off
after the panel raised _RF lost_ (critical) until someone acknowledged it, its
mute raised _TX muted_, and the showfile could hold only one performer per
channel, so a presenter change meant editing the show in Manager mid-event.

## Decision

For the local MVP only:

1. **Sessions are part of the show.** The showfile gains an optional ordered
   `sessions` list. Each session has a stable id (minted on save like channel
   ids), a name, an optional scheduled start (`startMinute`, minutes after
   local midnight at the venue) and the channels it uses, each with an
   optional presenter that overrides the channel's performer for that session.
   Saves drop entries for channels the show no longer has and reject a
   duplicate session id or a channel listed twice. Sessions are edited in
   Manager.
2. **The backend owns which session is running.** `PUT /api/v1/live/session`
   with `{ sessionId, operator }` starts a session for every Live client, or
   ends the run with `sessionId: null`; an unknown session is `404
session-not-found`. The run (session, who, when) persists to
   `session.json` beside the production library. A run naming a session the
   active show no longer has resolves to no session.
3. **The live state carries the run.** An optional top-level `session` gives
   the running and next session ids, who started it and when, and a summary
   of every session. Each channel gains an optional `session` object —
   `inUse`, `nextInUse`, `nextPresenter` — and its `performer` is the running
   session's presenter when one is set. Both fields are optional so producers
   that predate sessions still validate.
4. **A channel the running session does not use is idle.** It raises no _RF
   lost_, _TX muted_ or _No audio_; a switched-off transmitter reads RF
   `not-applicable` and silence reads Audio `not-applicable`. Battery, RF
   level, link quality, interference and clipping still alert, because a pack
   that is dying or a mic that is live while nobody expects it is still worth
   knowing about. Starting a session re-arms silence and transmitter-loss
   alerting for every channel, the same first-signal arming ADR 0027 uses at
   backend start. With no session running, nothing is idle.
5. **Checks follow the presenter.** A mic check's subject uses the running
   session's presenter, so a presenter change at a turnover makes the earlier
   check stale rather than letting it carry over.
6. **Live shows the turnover.** A run-of-show bar shows now and next; its
   turnover sheet lists every channel the next session uses with the presenter
   change and what it waits on — transmitter off, a battery below the alert
   threshold or with less reported runtime than the next session is scheduled
   to last, or a battery nobody can measure — and then starts the session.
   The grid gains a "This session" filter; idle cards step back but keep
   their status strip and alert band.

## Consequences

### Positive

- Switched-off, muted and silent handhelds stop raising faults between their
  sessions without anybody turning monitoring off by hand.
- A presenter change is authored once in Manager and appears on every card,
  in the check subject and in the turnover list.
- Battery reset between sessions uses the scheduled session length, not only
  the percentage threshold.

### Negative

- There is no authentication: anyone on the trusted LAN can start or end a
  session as any name (ADR 0026's trust boundary).
- Session length is inferred from the next session's scheduled start; the last
  session and unscheduled sessions have no length, so only the threshold
  applies to them.
- One running session per room; ADR 0030 adds rooms and makes the run of
  show per room. The live-state `session` field described here was replaced
  by ADR 0030's `runs` before release.
- An operator who forgets to start the next session leaves the previous one's
  idle rules in force. The bar keeps "Now" and "Next" in view for that
  reason; nothing starts a session automatically from the clock.

## Alternatives considered

- **Start sessions automatically at their scheduled time.** Rejected: corporate
  agendas run late, and silently re-arming alerts on the clock would re-create
  the unattended-fault problem this solves.
- **Per-channel monitoring toggles only.** Rejected: already available, but
  changing them at every turnover is exactly the Manager edit mid-event this
  avoids, and it hides battery state too.

## Replacement gate

Replace `session.json` and the unauthenticated route when the durable control
ledger, authorization and rooms exist. The session contract is expected to
become the corporate profile of the ADR 0005 occurrence model.
