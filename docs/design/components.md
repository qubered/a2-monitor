# Components

**Status:** Proposed

Anatomy of the shared parts. Sizes are given at the iPad reference (1180×820)
and are identical at desktop unless stated; desktop changes column count, not
component size.

## Channel card

The centrepiece, and it is a photograph.

An A2 thinks in people. They are looking for Eleanor, not for input 27, and a
face is recognised faster than any label a screen can carry. WaveTool is right
about this and we keep it: the headshot is the tile, not an avatar beside the
text.

What we change is what sits on top of the face. WaveTool paints the audio trace
across the portrait; we run it as a strip along the bottom edge, inside the
photograph but clear of it. And the card stops there. Everything past the fifth
fact belongs in the monitor bar.

### Standard card — 196px wide, 5:4 crop

```
┌──────────────────────────────────────┐
│ ● 27                  ● RF ● Identity│ ← channel, group dot, and only the
│                                      │   categories actually in fault
│                                      │
│           [ headshot ]               │ ← 5:4 crop, fills the card
│                                      │
│                                      │
│▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁▂▃▅▇█▆▄▂▁▂▃▄▅▆▇█▆▄▃▂▁│ ← 10s audio trace, 22px, on the
├──────────────────────────────────────┤   photo's bottom edge over a scrim
│ Eleanor Vance                        │
│ Marguerite Hale                      │
│ ■ RF quality collapsed 0:40 ago.     │ ← one line, only when something
└━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┘   needs you
   ^ 3px bottom rule when listening
```

Five things: who, where (the channel number and group dot), what it sounds like,
the one thing that needs you, and — in the fault flags — whether a second thing
does too. Nothing else.

- **Headshot.** The production's real approved headshot through Manager's
  managed image pipeline. Never an illustrated avatar, never a stock photo. A
  source with no headshot yet shows the empty frame and reads as incomplete,
  because it is.
- **Channel number and group dot.** Quiet mono over the photograph, top left. The
  dot is group identity and never carries a semantic colour.
- **Fault flags.** Top right, over the photograph. A category that is clear says
  nothing at all; a category in fault says its name. This is how a second
  independent critical fault stays visible behind the first
  ([A1/A2 views](../product/a1-a2-views-and-collaboration.md)) without a
  permanent rail of dormant icons.
- **Staleness.** `42s old` joins the flags, and the trace strip is hatched.
- **Trace strip.** 10-second rolling window, matching WaveTool's convention, over
  a scrim so it reads against any photograph. Present audio in `--verified-ink`,
  expected silence in `--ink-2`, hatched when stale.
- **Caption.** Character name, then performer name. Character first: the A1 calls
  the role and the cue sheet says the role.
- **Exception line.** One line, two at most, only when there is one. `likely`
  prefixes an inferred cause.

### States

- **Listening** — a 3px rule in `--listening-ink` along the bottom edge.
- **Latched** — the same rule plus a latch glyph after the name. Distinguishable
  at a glance, because getting this wrong is a safety issue.
- **Critical** — the bottom rule in `--critical-ink`. No red wash: it would cover
  the face, which is the fastest identifier on the card.
- **Expected silent** — trace in `--ink-2`, captioned *silent*. Not an alarm.
- **Stale** — hatched strip, age in the flags, values in `--stale`.
- **Muted at transmitter** — flat line, captioned *muted at pack*, not hatched. A
  muted pack is a known fact, not a missing measurement.

### Zoom

Pinch cycles compact / standard / expanded. Compact drops the caption's second
line and the exception; expanded switches the crop to 4:5 and adds placement,
next intervention window and the operator's note.

## Monitor bar

The bottom bar is the detail view. There is no side drawer and no modal.

Collapsed it is transport only. **Selecting a channel raises it into that
source's monitoring panel** — identity, lanes, and its own timeline — without
moving the grid, covering the faces, or leaving the surface. It is the single
most-used surface in the product and it sits in the thumb zone.

```
        ▁▁▁▁  ← grip: tap or drag to raise and lower
┌─────────────────────────────────────────────────────────────────────┐
│ ┌──────┐ Eleanor Vance      Audio    ▁▂▅█▆▃▂▁▂▄▆█▇  −18.2 dBFS  │ ⟲ Replay from here │
│ │photo │ Marguerite Hale    RF level ────────────╲__  −62 dBm   │ ⚑ Mark this moment │
│ │      │ rx    RX 4 · B     Quality  ▌▌▌▌▌▌▌▌▌▌▁▁▁▁   31 %      │ ◍ Run check        │
│ └──────┘ pack  A2-114       Cue      40 │41 Ballroom■ ✎│42      │ ✉ Message about…   │
│          batt  2:14         ├────────────────────────◆ now      │ ⇄ Swap…            │
│          check 18:55 JM     −30m   −20m   −10m   −5m   now      │                    │
├─────────────────────────────────────────────────────────────────────┤
│ [photo] Eleanor Vance  ◀Prev  ⊘Clear  MUTE  DIM  −18 ▮▮▮▮▯  [groups]  ⟲ Replay │
└─────────────────────────────────────────────────────────────────────┘
```

Three columns: **who** (headshot, identity, pack, battery, last check), **what
happened** (the lanes and the source's own scrubable timeline), **what you can
do** (the actions, one per row, always in the same order).

The lanes are the honest ones: audio, RF level, and link quality as a separate
lane, never merged into a health bar, because interference degrades quality
without an equivalent fall in RSSI
([research](../research/wavetool-and-browser-audio.md)). Cue boundaries and
events sit on the same x-axis so correlation is a glance, not a calculation.

The scrub runs to *now* by default. Dragging back puts that source into replay;
the mode rule in
[replay and incidents](surfaces/replay-and-incidents.md) then applies to the
whole window.

### Transport row

Always visible, whether the panel is raised or not: what you are hearing ·
previous · clear-all (long-press) · **MUTE** and **DIM** · output level with its
numeric value · group buttons 1–8 as press-to-listen · replay.

Mute and dim are here because [listening safety](../quality/listening-safety.md)
requires an always-available local action, and because this is where the thumb
already is. Listen always starts muted; the transport shows that as a resting
condition, not an error.

## Meter and trace

A trace is a shape, not a chart: no axes, no gridlines, no legend, no tooltip.
Drawn to a canvas at the data rate, never transitioned. The inspector carries
the real chart.

Peak-hold marks sit as a 2px tick at the highest value in the window and decay
on their own schedule, which is data behaviour, not animation.

## Badge and chip

- **Badge** — 20px glyph, optional count, no background. Used in the card's
  badge rail and the header counters.
- **Status chip** — pill, 28px tall, 2px rule, glyph + label in micro caps.
  Colour matches the semantic. Always carries the word.
- **Tape chip** — the physical-identity treatment described above.
- **Hand note** — Caveat at 17px, `--ink-2`, with a 2px left rule in the
  author's colour. Never carries a value.

## Buttons

Pill, 2px `--rule`, `--sh`, travelling on press. Three weights:

- **Primary** — filled `--listening` on live surfaces, `--ink` text on dark.
  One per view.
- **Secondary** — `--raised` fill, `--ink` text.
- **Quiet** — transparent, 2px rule, `--ink-2` text.

Heights: 44px standard, 56px for live-critical actions, 72px for mic-check
verdicts. Full-width on iPad portrait.

**Danger** actions are not a red button. They are a secondary button that
requires a long-press, drawing a `--critical` fill from left to right over
1500ms, with the action named in the fill.

## Exceptions sheet

A sheet, on every viewport, opened from the header counter or by an edge swipe
from the right. Never a standing panel: a sidebar spends permanent width on
something that is empty most of the night. Lists critical
exceptions across the entire show — including sources not in the current filter
and not on stage — plus system and audio-path faults affecting more than one
input. Sorted by severity then age. Each row is a 56px target that selects the
source and offers listen and claim inline.

## Full record

The monitor bar answers *what is happening to this source now*. The full
record — diversity and interference detail, captured versus receiver meters,
battery history, every check badge with who and when, placement images, asset
and assignment history, cue expectations, incident evidence — is a separate
sheet reached from the monitor bar, not a permanent drawer.

Swap opens the transaction described in
[operator workflows](../product/operator-workflows.md) and shows the full
identity diff before anything is committed. It lives at the end of the monitor
bar's action column, behind a long-press, so it is never one gesture away from
a listen.

## Header

72px, fixed. Performance identity and rehearsal/show state · current cue and
next cue, with cue authority freshness shown explicitly · assigned zone or
track · counters for unchecked, battery actions, unclaimed incidents and urgent
pages, each a 44px target that filters the grid · node, audio device and
receiver freshness · personal listen state.

When cue authority is stale or unknown, the cue block does not display the last
known cue as though it were current. It displays the last known cue struck
through with *authority lost 2m ago*, and every cue-derived arming state in the
product becomes unknown.

## Empty, loading, offline

The three places Ghost is allowed on a Live surface's chrome, and the only place
whimsy touches the product's working screens.

- **Empty** — Ghost burning, and a specific sentence: "No show is active. Open
  Manager to activate one." Never "No data available."
- **Loading** — Ghost watching, and the thing being waited for, named:
  "Waiting for the audio node." No shimmer skeletons.
- **Offline** — Ghost out, the honest statement of what still works, and what
  does not: listening and replay continue on the leased node; chat, tasks and
  ownership are unavailable until the backend returns
  ([A1/A2 views](../product/a1-a2-views-and-collaboration.md)).
