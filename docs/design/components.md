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

### States

- **Listening** — `--red` outline, `0 3px 0 var(--red-700)` shadow, red badge.
- **Critical** — `--t-out` outline, plus the faulted cell in the strip.
- **Stale** — dashes in the affected cells with the age in the sentence.

## Alert overlay

An alert that nobody has acknowledged veils the channel's tile and name, the way
WaveTool draws its fault overlay on a channel strip.

```
┌────────────────────────────────┐
│ ┌────────────────────────────┐ │
│ │ 27      ((( ))))       ⤢   │ │ ← translucent veil: the photograph,
│ │          LOW RF            │ │   the meter and the channel number
│ │▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁▂▃▅▇█▆▄▂▁▂▃▄│ │   are all still visible through it
│ └────────────────────────────┘ │
│ Eleanor Vance  ┌────────────┐  │
│ Marguerite Hal │Acknowledge │  │
│ ──────────────────────────────  │ ← the overlay's own countdown
│ ┌─────┬─────┬─────┬─────┐      │
│ │  ✕  │  ✓  │  ✓  │  ⚠  │      │ ← the status strip is NOT veiled
│ │ RF  │AUDIO│ BATT│CHECK│      │
│ └─────┴─────┴─────┴─────┘      │
└────────────────────────────────┘
```

**It is a veil, not a replacement.** The operator can still see whose channel it
is, what the meter is doing, and where the fault sits in the status strip
underneath — which is what they need to start troubleshooting. The overlay is
deliberately scoped to stop short of the status strip.

**It names the problem and nothing else.** One icon, two words — *Low RF*, *No
audio*, *Low battery* — and an Acknowledge button. No explanation, no timestamp,
no diagnosis, no action list. The operator troubleshoots; the product's job is to
say which channel and which kind, fast, from across a wing.

Rules:

1. **The overlay is itself a listen target.** Pressing anywhere on it that is not
   the Acknowledge button listens to that channel. The first thing anyone does
   with "low RF on 27" is listen to 27, and an alert that blocked that would be
   worse than no alert.
2. **The overlay expires; the alert does not.** It holds the card for a
   configurable time — default five minutes, set per severity by production
   policy — and then clears itself, so an unattended screen does not end the
   night as a wall of red. A countdown along the bottom of the overlay shows this
   is going to happen rather than surprising anyone.
3. **Expiry is not acknowledgement.** An alert that timed out moves into the
   card's status area marked **Not acknowledged**, with a dashed border, and
   still counts in the header's outstanding total. An alert nobody saw must never
   look like one somebody saw.
4. **Acknowledging is not fixing.** An acknowledged alert moves into the same
   status area marked *Seen*, while the failed dimension stays failed in the
   status strip. A channel whose RF is still broken still reads `✕ RF`.

## The player

The bottom bar is a player for the selected channel, and it behaves like one.
Artwork, name, transport, a scrub bar with a time code, and a volume. An
operator already knows how to use it before anyone explains it.

```
┌──────────────────────────────────────────────────────────────────────┐
│ AUDIO    ▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁▂▃▅▇█▆▄▂▁▂▃▄▅▆▇█▆▄▃▂▁┃░░░░░░░░   −18.2 dBFS │
│ RF LEVEL ───────────────────────────────╲_____┃░░░░░░░░   −62 dBm    │
│ QUALITY  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▁▁▁▁▁▁▁▁▁┃░░░░░░░░   31 %       │
│ BATTERY  ╲____________________________________┃░░░░░░░░   2:14       │
│ −30:00            −20:00      10m[30m]60m     ┃  −10:00      LIVE    │
├──────────────────────────────────────────────────────────────────────┤
│ −10:51 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●─────┃──────────  BACK TO LIVE │
├──────────────────────────────────────────────────────────────────────┤
│ [art] Eleanor Vance   ⏮ ↺ ⏸ ↻ ⏭   [↓ Save from here]  M −18 ▮▮▮  ⌄   │
│       RX 4 · ant B · in 27                                           │
└──────────────────────────────────────────────────────────────────────┘
```

### The timeline

Four measurements over one shared window, stacked so they are read together
rather than compared across screens: **audio**, **RF level**, **link quality**
and **battery**. One playhead crosses all four, so every value is read at the
same instant. Everything after the playhead is dimmed — it is later than what
you are hearing.

RF level and link quality are separate lanes, never merged
([research](../research/wavetool-and-browser-audio.md)). Battery is a slow line
over hours and reads as a shallow fall, which is exactly the shape that tells an
operator whether a pack will make it to the interval.

The window is configurable — 10, 30 or 60 minutes — and the axis relabels with
it. The default is 30 minutes, matching the replay depth in
[the roadmap](../product/roadmap.md).

### Scrubbing is how you listen back

Dragging the scrub bar back is the replay feature. There is no separate mode to
enter and no other screen to go to: the channel you are hearing stays the
channel you are hearing, and you move it in time.

- Position at the right edge is **live**. Anything left of it is replay.
- In replay the bar tints `--purple`, the playhead and progress turn violet, and
  the right-hand time code becomes **BACK TO LIVE** — one press, from anywhere.
- The time code on the left shows how far behind live you are, not a clock, and
  never as a bare number.
- Event marks sit on the scrub rail at the time they happened, so an operator
  can aim at the thing they are looking for rather than hunting for it.

### Save replay

A permissioned action with its own button, deliberately never automatic and
never a side effect of anything else.

Pressing it states, before it writes anything, exactly what is about to leave
the appliance: which channel, from when, how long, and what is included. The
confirmation also says that **Mark** does not export audio, because the two get
confused and only one of them has a privacy consequence.

Export is separately permissioned from listening and from marking
([operator workflows](../product/operator-workflows.md)). A user who can hear a
channel cannot necessarily take a copy of it away.

## Detail

Opened by pressing a channel's photograph. This is where the depth lives, which
is what lets the grid stay sparse.

A2 Monitor is intended to be the one screen a show needs, so everything an
operator would otherwise open Wireless Workbench or Wireless Systems Manager to
see is here, at the channel level:

- **Antennas and diversity** — level per antenna with the squelch threshold
  marked on each bar, which antenna is currently carrying, and link quality as
  its own figure. Level and quality are never merged, because interference pulls
  quality down without moving level.
- **Frequency** — frequency, group, channel, TX power, encryption state.
- **Audio** — captured level, receiver gain, trim, transmitter mute state, input.
- **Transmitter** — model, asset, firmware, lock state, battery type.
- **Battery** — remaining time, charge, temperature, cycles, when it was changed.
- **Receiver** — model, slot, address, firmware, telemetry freshness.
- **Show assignment** — performer, role, element, placement, spare, last check.

The set is capability-driven: a receiver that does not report a field shows it as
unknown rather than as a plausible default, and a wired input drops the RF,
transmitter and battery groups rather than showing false values.

**This is read-only.** Displaying what a receiver reports is not the same as
managing it. Frequency coordination, scanning, deployment and firmware
management stay in the vendor tools, and are listed as non-goals in the
[product vision](../product/vision.md). See the note in the
[README](README.md) — the vision's wording needs revisiting, because "the one
screen a show needs" and "not replacing WSM" are in tension even if read-only
display resolves most of it.

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
