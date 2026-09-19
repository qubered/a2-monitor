# Cast, microphone, image, and cue workflows

**Status:** Proposed for the theatre/musical reference product

## Design rule

A visible “channel” is a view assembled from independent identities. Never
store actor, character, microphone, transmitter, receiver, and audio input as
one mutable record. Every assignment has an effective interval so a swap changes
the present without rewriting replay, incidents, or earlier cues.

The theatre default display is `Character — Performer`, with a compact
character label, performer headshot, current microphone path, and verification
state. Manager can choose performer-first or custom compact labels per layout.

## Core records

### Person

A human being: performer, understudy/swing, presenter, or crew member.

- stable ID, preferred/display/legal names where needed, pronouns, notes;
- one primary headshot plus optional approved images;
- privacy/consent and retention metadata; and
- no microphone or role fields stored directly on the person.

### Role

A character or operational role within the show template.

- stable ID, name, short label, colour and display order;
- scenes/cues and expected stage zones;
- microphone requirements and role notes; and
- optional role/costume reference image.

### Production and performance

A production is the reusable show template. A performance is a dated instance
such as a rehearsal, matinee, or evening show.

- production pins the activated show, cue, layout, rule and inventory revisions;
- performance contains cast and equipment overlays for that occurrence;
- performance status is planned, preflight, active, interval, completed, or
  cancelled; and
- changes during a performance are journaled events, never edits to history.

### Cast assignment

A time-bounded relationship among a performance, role, and person.

- assignment type: principal, alternate, understudy, swing, cover, or emergency;
- effective cue/time range and optional planned end;
- assigned dressing/crew responsibility and notes;
- verification state and approving operator; and
- replacement link explaining which assignment it superseded.

One person may cover several roles and one role may have planned alternatives,
but only the explicitly active assignment drives the current Live identity.

### Microphone asset

Physical microphone inventory remains separate by component:

- **element:** lavalier/headset/capsule, connector, serial/asset number, colour,
  condition and placement history;
- **transmitter:** pack/handheld/plug-on asset, vendor/model/serial, frequency
  capability, battery and receiver association;
- **accessory:** cable, connector/adaptor, pouch and other tracked part; and
- **kit:** an optional convenience grouping of element, transmitter and
  accessories without erasing their separate histories.

Asset status is available, prepared, assigned, spare, quarantined, repair, or
retired. An asset cannot be exclusively assigned to two people at the same
instant. Frequency-diversity and deliberate redundant paths are represented by
an explicit multi-path assignment rather than violating exclusivity silently.
Inventory mode is per asset class: individually serialized, batch/lot-counted,
or untracked consumable. A production is not forced to serialize tape, pouches,
generic cables or elements that its department manages as pooled stock.

### Microphone assignment

A time-bounded assignment connects a person/cast assignment to one or more
microphone assets and radio/audio paths.

- element, transmitter, receiver channel/path and captured audio input;
- primary, spare, redundant/frequency-diversity, or temporary purpose;
- placement/costume position and related image;
- fit, RF, audio, mute, battery and spare verification states;
- half-open valid interval using capture epoch/frame where known, mapped
  monotonic/UTC plus uncertainty otherwise, and separate recorded-at time; and
- operator, reason and transaction ID.

### Cue

A cue is an ordered show event that supplies operational context. Cue numbers
are strings (`12`, `12A`, `12.5`) and have a separate stable sortable rank so
renumbering labels does not break references.

- cue list/revision, cue ID, label, rank, scene and description;
- explicit authority mode: mapped external observer, named manual coarse-scene
  tracker, or no cue authority;
- expected On Stage, Up Next, offstage and expected-silent roles;
- expected zone, microphone-live/muted state and monitoring priority;
- mic check, entrance/exit, quick change, battery opportunity, interval, note,
  marker or generic cue type;
- alert-rule arming/disarming effects; and
- external workspace/cue stable-ID mapping where applicable.

Cue definitions carry absolute expected-state snapshots. Every accepted
transition creates a monotonic cue occurrence; back/skip/repeat creates another
occurrence rather than rewriting history. QLab 5 read-only OSC show-control
broadcast is the first reference adapter in Phase 1A. Cue-derived automation is
unarmed whenever authority is stale, unknown or awaiting resync. See
[ADR 0005](../decisions/0005-cue-authority-and-occurrences.md).

Cues provide context and alert arming. They do not silently send receiver
configuration commands or replace the sound console/show caller.

### Intervention plan

A quick change is an ordered plan, not a display tag. It records route/zone,
opening and hard-deadline cue occurrences, responsible A2/dresser, prepared
assets, ordered physical/check actions, dependencies, blocked reason, fallback
and actual completion evidence. The A2 workspace sorts the operator's next
interventions by deadline and route.

### Image asset

Images can represent performer headshots, roles/costumes, microphone placement,
physical assets, racks and incident evidence.

- stable ID, purpose, owner record, content hash, media type and pixel size;
- focal point/crop and accessibility alt text;
- created-by, consent/source, sensitivity and retention metadata;
- generated thumbnail/screen variants; and
- no public filesystem path or embedded data URI in domain/API records.

## Swap transactions

All show-time swaps use preview/commit with an idempotency key and expected
overlay revision/authority epoch. Preview validates asset availability,
reservation, compatibility, receiver/audio identity, cue occurrence,
permissions and resulting display.

Every physical assignment uses the normative automaton in
[temporal identity and physical swap](../architecture/temporal-identity-and-swap.md):

`reserved -> prepared -> change-in-progress -> installed-unverified -> verified -> complete`

with explicit expiry, failure, abandon, revert, fallback and A1-unavailable
paths. `RecordInstalledBoundary` is the sole identity-effective transition; it
atomically closes old intervals and opens new ones at the observed boundary.

The product distinguishes its identity assignment from operator-confirmed
external actions: fitted element/pack, transmitter/receiver association,
receiver channel, Dante route and console/input label. It never labels an
external action complete solely because a database commit succeeded.

A fully fitted/synced/checked reserved spare can use one-action promotion, which
atomically closes/opens identity intervals at the observed boundary and marks
only its still-valid prechecks complete. When physical safety requires acting
first, the operator may record the transaction afterward using actual effective
capture frame/time plus uncertainty and a later recorded-at timestamp. This is
an audited late entry, not a rewrite.

Prepared-check reuse is tuple- and time-bounded by component, performer,
costume/build, placement, receiver/input path, zone, dimension, method and policy
version. A1 confirmation is a policy receipt after physical effectiveness, with
an authorized unavailable/reason path; it is never fabricated as a physical
stage.

### Performer/understudy swap

1. Select the role and replacement from planned principals/covers.
2. Preview affected role identity, mic assignments, cues, notes and alerts.
3. Choose whether existing mic assets stay with the role or move with the
   performer; the choice is explicit.
4. Commit now or at a selected cue.
5. Mark new fit/RF/audio checks required according to policy.

A mid-show takeover preserves the original performer on all earlier replay and
incidents. A scheduled cast change before preflight creates the same event model
without emergency severity.

### Multi-role cast-plan swap

A swing cascade previews and commits one atomic cast plan covering every
affected role/person. Each microphone component may stay with performer, role,
costume build, prepared kit or be explicitly replaced. Preview validates no
uncovered or duplicate track, asset exclusivity, cue/scene expectations,
placement builds, console labels and rollback feasibility. Partial plan commit
is not allowed; physical actions and actual identity boundaries then progress
per assignment, so unchanged/uninstalled roles retain their former current
identity.

### Microphone swap

Supported granular operations are:

- element-only replacement;
- transmitter/pack replacement;
- complete kit replacement;
- primary/spare promotion;
- receiver-channel change;
- captured audio-input repatch; and
- add/remove a deliberate redundant radio path.

The preview shows every changed identity and whether observed audio/radio
association still matches. The transaction can require element/fit, RF, audio,
mute and battery checks.
The old asset moves to available, quarantined or repair with a reason; it never
simply disappears from the assignment.

A swap records intended and observed physical stages. Version one does not
silently retune, pair, sync, repatch Dante or change a console as a side effect.

### Conflict and undo

Concurrent commands with a stale overlay revision/authority epoch fail with a
fresh diff.
Undo is a new inverse transaction, not event deletion. Undo is blocked if later
transactions depend on the changed assignment and instead offers a new preview.

## Offline emergency operation

The activated node cache includes only the people, cast alternatives, mic
assets, spares, cues and policies approved for the current performance. A
show-time lease may authorize these limited transactions during a backend
outage:

- activate a pre-approved cover for a role;
- swap/promote an approved spare element, transmitter or kit;
- advance/select a cue; and
- add verification results and local evidence markers to the durable control
  ledger.

The node cannot create new people/assets, upload images, edit cue definitions,
change policy, use inventory outside the activated pool or mutate task/incident
lifecycle. Offline transactions are sequenced by the active node, immediately
affect current identity, and reconcile idempotently when the backend returns.
The node stops further offline mutations before durable ledger capacity is
exhausted while capture/listening continue. Conflicts require physical
verification and an operator decision; the backend never overwrites a physical
show-time swap silently.

## Images and privacy

- Accept JPEG, PNG and WebP initially; HEIC may be converted by a separately
  validated path rather than passed through to clients.
- Limit upload bytes, decoded pixels and dimensions before permanent storage.
- Decode and re-encode server-side, strip EXIF/GPS and unsafe metadata, reject
  malformed/polyglot content and generate bounded variants.
- Initial variants are small avatar, grid, detail and original-retained-if-policy
  permits; clients request variants rather than originals.
- Headshots and placement/costume photographs are sensitive personal/production
  data with role-based access, retention, export and deletion rules.
- Active-show headshot/grid variants may be cached for foreground continuity
  under the authenticated application cache and purged on logout/show removal.
  Placement-detail variants remain memory/network-only, are versioned by
  performer/costume/wig/scene with author/age, and have a text fallback.

## Acceptance scenarios

- Scheduled understudy replaces the principal before preflight.
- Emergency understudy takeover occurs at a cue while the show is active.
- A swing cascade changes several tracks atomically without uncovered or
  duplicate roles.
- A person changes role while keeping their fitted microphone.
- A role changes performer and inherits a prepared role-specific pack.
- Failed element is replaced while the transmitter/receiver path stays fixed.
- Failed transmitter is replaced and RF/audio checks become pending.
- A preverified spare uses fast promotion; an unplanned physical-first change is
  recorded post-hoc without falsifying its effective time.
- Primary pack promotes to spare during a backend outage and later reconciles.
- Two operators attempt conflicting swaps; one receives a safe revision diff.
- Replay before and after each swap shows the historically correct person,
  role, image, element, transmitter, receiver and input.
- Cue skip/back/go updates expected silence and alert arming deterministically.
- Cue observer loss unarms cue-derived behavior and manual resync creates a new
  occurrence.
- Malformed, oversized and metadata-bearing image uploads are rejected or
  sanitized without exposing the original.
