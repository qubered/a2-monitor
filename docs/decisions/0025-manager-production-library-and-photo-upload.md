# ADR 0025: Manager production library and inline photo upload

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-21
- **Owners:** Project team
- **Extends:** ADR 0022 (local MVP showfile)

## Context

Operators asked Manager to hold more than one show at a time and to switch
between them, and to attach a headshot to a channel instead of only naming it.
ADR 0022 scoped the local MVP to exactly one editable showfile and explicitly
gates replacing that model on immutable revisions, validation, activation,
authorization, audit history, migration, backup and multi-user concurrency —
none of which exist yet. This decision is not that replacement. It is a
same-scope extension: still one Mac, one operator, one file on disk, no
authorization or audit trail.

## Decision

The backend keeps its single closed showfile contract unchanged and adds a
sibling collection: named productions, each an independent instance of that
same showfile, plus one "active" pointer. `GET /api/v1/showfile` and
`PUT /api/v1/showfile` keep working exactly as before, now reading and writing
whichever production is active. New endpoints
(`GET/POST /api/v1/productions`, `POST /api/v1/productions/:id/activate`,
`DELETE /api/v1/productions/:id`) list, create, switch and remove productions.
Persistence keeps the same atomic write-temp-file-then-rename pattern as ADR
0022, now covering the whole `{ activeId, productions }` map in one file.
Creating or activating a production is a plain unauthenticated local action,
same trust level as editing the showfile itself.

Each channel gains an optional mic type, an optional image reference, and a
`monitor` object naming which of battery, RF and audio that channel's future
alerting should cover. Manager's photo control reads a locally selected image
file with `FileReader.readAsDataURL`, rejects it client-side above roughly
200 KB, and stores the resulting `data:image/...;base64,...` string directly
in the channel record — no separate asset store or upload endpoint. The
backend accepts either that data URL shape or a plain `http(s)://` URL,
rejects anything else (closing the obvious `javascript:` injection path), and
bounds the field to 300,000 characters so one oversized image cannot make the
showfile impractically large.

## Consequences

- One Manager instance can prepare next week's show while this week's stays
  active, and switch between them without losing either.
- A channel's photo travels inside the showfile JSON like every other field:
  same save button, same revision, same atomic write. It also means every
  channel photo is duplicated in full on every save of that production, which
  is fine at MVP scale (a handful of small images) and not a pattern to carry
  into the production store.
- Nothing here adds users, roles, or an audit trail. Any Manager instance can
  create, switch or delete a production; "who did this and when" is not
  answerable beyond the existing single `updatedAtUtc` per production.
- A deleted production's images and channel data are gone; there is no trash
  or undo.

## Replacement gate

Unchanged from ADR 0022: replace this file-backed model, productions and all,
with the production show store once immutable revisions, validation,
activation, authorization, audit history, migration, backup and multi-user
concurrency are implemented and tested. Channel photos move to a real asset
store in that same replacement, not before.
