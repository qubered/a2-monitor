# Components

**Status:** Proposed

Anatomy of the shared parts. Everything here is built from the RVLT design
language's published components; see [visual language](visual-language.md).

## Channel card

The centrepiece. An obvious, pressable object: RVLT's card — 2px `--ink`
outline on Paper, `--r-lg` radius, hard `0 3px 0` offset shadow — that lifts 3px
on hover and presses 2px down on tap.

```
┌────────────────────────────────┐  2px ink outline · 0 3px 0 shadow
│ ┌────────────────────────────┐ │
│ │ 27                     ⤢   │ │ ← the photo is its own target
│ │        headshot            │ │
│ │ ●LISTENING                 │ │
│ │▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁▂▃▅▇█▆▄▂▁▂▃▄│ │ ← 10s audio trace on the bottom edge
│ └────────────────────────────┘ │
│ Eleanor Vance                  │ ← Archivo 800
│ Marguerite Hale                │
│ ┌─────┬─────┬─────┬─────┐      │
│ │  ✕  │  ✓  │  ✓  │  ⚠  │      │ ← one verdict per dimension
│ │ RF  │AUDIO│ BATT│CHECK│      │
│ └─────┴─────┴─────┴─────┘      │
│ RF quality collapsed 0:40 ago. │ ← one plain sentence, only when
│ Level normal.                  │   something needs doing
└────────────────────────────────┘
```

### Two targets, two jobs

- **Press anywhere on the card — you are listening to that channel.** The whole
  card is the listen target. This is the most frequent action in the product and
  it should cost nothing: no button to find, no button to aim at.
- **Press the photo — the channel's detailed display opens.** The photo carries
  a small `⤢` affordance so the second target is discoverable on touch, where
  there is no hover to reveal it.

Implementation note: the listen target is a full-bleed `<button>` behind the
content, and the content sets `pointer-events:none` so a press anywhere that is
not the photo falls through to it. Both targets are real buttons with accessible
names; neither is nested inside the other.

### Status strip

The card's centre of gravity, and the thing an operator reads first after the
face. One cell per dimension that can independently go wrong, **always in the
same order and the same place**, so the row is read as a shape rather than
parsed as text.

| Verdict | Glyph | Colour | Meaning |
| --- | --- | --- | --- |
| Good | `✓` tick | `--ok` on `--ok-soft` | Measured, and within tolerance |
| Fault | `✕` cross | `--t-out` on `--out-soft` | Measured, and wrong now |
| Caution | `⚠` triangle | `--warn` on `--warn-soft` | Needs someone, but not yet failing |
| Unknown | `–` dash | `--rep` on `--rep-soft` | Stale, unarmed, or never measured |
| Not applicable | `∕` slash | `--rep`, 50% | Dimension does not exist here — RF and battery on a wired input |

Default dimensions: **RF · Audio · Battery · Check**. The set is per-deployment,
not hard-coded: a production running in-ears or tracking element type adds a
cell, and a wired-only rig drops two to *not applicable* rather than showing
false greens.

Rules:

- **Never colour alone.** Every cell carries a glyph and a label, and an
  accessible description of the form "RF link: fault".
- **Unknown is never green and never zero.** A dimension that has not been
  measured, or whose telemetry has gone stale, shows the dash. Silently
  presenting last-known data as current is the one thing this product cannot do.
- **A faulted or cautioned cell tints its whole background**, so the strip reads
  from across a wing without the glyph being legible.
- The strip is the mechanism by which a second independent fault cannot hide
  behind the first, which is a stated product requirement
  ([A1/A2 views](../product/a1-a2-views-and-collaboration.md)). Eleanor can be
  `✕ RF` and `⚠ Check` at once and both are visible without opening anything.

The same strip appears in the expanded detail, so the grammar is identical
everywhere it is seen.

### Everything else on the card

- **Headshot.** Real approved production headshots through Manager's managed
  image pipeline, 16:10 crop. Never illustrated avatars, never stock. A source
  with no headshot shows the empty frame and reads as incomplete, because it is.
- **Channel number.** Boxed, mono, top left of the photo.
- **Listening tag.** RVLT's red badge with the pulsing dot. Red is reserved for
  live, so exactly one card in the product carries it.
- **Trace.** 10-second rolling window on the photo's bottom edge over a
  `--scrim`, following WaveTool's convention.
- **Name and role.** Archivo 800, then the performer or part in `--muted`.
- **One sentence.** Plain language, present tense, naming what happened and when.
  *Likely* prefixes an inferred cause. Nothing when there is nothing to say.

### States

- **Listening** — `--red` outline, `0 3px 0 var(--red-700)` shadow, red badge.
- **Critical** — `--t-out` outline, plus the faulted cell in the strip.
- **Stale** — dashes in the affected cells with the age in the sentence.

## Detail display

Opens from the photo. It is the bottom bar expanded, not a drawer or a modal:
the grid stays where it is and the faces stay visible.

Three columns: **who** (the same status strip, then role, receiver, pack,
element, battery, last check), **what happened** (audio, RF level and link
quality as separate aligned lanes over a scrubable 30-minute timeline, with
events marked on it), and **what you can do** (replay from here, mark this
moment, run a check, message about this, swap).

RF level and link quality are never merged into one lane
([research](../research/wavetool-and-browser-audio.md)).

Dragging the scrub back puts that source into replay; the mode rules in
[replay and incidents](surfaces/replay-and-incidents.md) then apply.

## Transport row

Always visible at the bottom, whether the detail is open or closed: what you are
hearing · previous · clear · **mute** · **dim** · output level with its numeric
value · group buttons as press-to-listen · the expand control.

Mute and dim are here because [listening safety](../quality/listening-safety.md)
requires an always-available local action, and because this is where the thumb
already is. Listen always starts muted, shown as a resting state, not an error.

## Filter band

One horizontal row under the header, scrolling left to right. RVLT pill chips,
42px, pressed state is `--ink` filled. Counts are live.

**The default is All channels.** Cue-derived filters — On Stage, Up Next, quick
change — appear only when a cue source is connected; see the note in the
[README](README.md).

## Exceptions sheet

A sheet, not a standing rail, opened from the header counters. Each row is an
RVLT card with a badge, one sentence, and inline actions. Lists critical
exceptions across the whole show including sources not in the current filter,
plus faults affecting more than one input.

## Badges, buttons, notes

- **Badges** are RVLT §3.3: pill, 700 weight, 11px, soft-tinted, with a dot.
- **Buttons** are RVLT §15.2: pills that travel 1px up on hover and 2px down on
  press. `--red` primary is reserved for the one live or destructive action in
  view.
- **Operator notes** are Kalam on a `--warn` left rule. Anything a person wrote
  is in the hand; anything a machine measured is in mono. That split is a hard
  rule, not a preference.
