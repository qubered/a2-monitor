# Components

**Status:** Proposed

Anatomy of the shared parts. Sizes are given at the iPad reference (1180×820)
and are identical at desktop unless stated; desktop changes column count, not
component size.

## Channel card

The centrepiece. It answers *is anything wrong, and is it mine* in one second.

WaveTool draws the headshot as the tile and paints the audio trace over the
face, with the name on a group-coloured plate beneath. That photo-forward idea
is right — an A2 thinks in people, not channel numbers — and we keep it. What we
change: the trace does not sit on the face (it competes with the one thing you
recognise fastest), audio and RF get separate lanes, and every state that
WaveTool encodes in colour also gets a glyph.

### Standard card — 300×212

```
┌━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┐ ← 7px marked edge in
│ ▎[24]  ✓RF  ▲BATT  ·  ·  ·  ·       stale 4s │   --listening-ink, matte,
│ ┌──────┐  ELEANOR VANCE                      │   no glow. Only when listening.
│ │      │  Marguerite Hale                    │   category, dimmed when clear
│ │ face │  ┌────────────────────┐             │
│ │      │  │ RX 4 · B · IN 27   │ ← tape      │
│ └──────┘  └────────────────────┘             │
│                                              │
│  AF  ▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁▂▃▅  -18.2 dBFS         │ ← audio lane, 10s window
│  RF  ▄▄▄▅▅▄▄▃▃▄▄▄▄▅▅▅▄▄▄  -62 dBm  Q ▮▮▮▯▯   │ ← RF lane + discrete quality
│                                              │
│  ▲ Battery 0:41 — no change before interval  │ ← strongest exception, one line
│  ✓✓✓✓·✓✓·                        [ JM ]      │ ← check badges · incident owner
└──────────────────────────────────────────────┘
   ^ group plate colour runs behind the name row
```

Elements, top to bottom:

- **Marked edge.** A solid 7px bar in `--listening-ink` across the top, flush
  over the outline, with the outline taking the same ink. Matte tape, not a lit
  edge — nothing in this product glows. Exactly one card per surface.
- **Channel number.** Stamped: mono-sm in a boxed plate with a 6px group-colour
  tab fused to its left edge, like a rubber stamp beside a coloured binder tab.
  Group is identity, so it never touches a semantic colour.
- **Badge rail.** Seven fixed positions — audio, RF, battery, identity, cue,
  client, system — each a glyph at 20px. Clear categories render at `--ink-2`
  25% so the rail keeps its shape and the eye learns fixed positions. A category
  with a fault renders in its semantic colour with a count if greater than one.
  The rail exists so that selecting one primary exception cannot hide a second
  independent critical fault, which is a stated product requirement
  ([A1/A2 views](../product/a1-a2-views-and-collaboration.md)).
- **Staleness stamp.** `stale 4s` in mono-sm `--stale`, top right, with the
  hatch overlay applied to whichever lanes are affected — not the whole card,
  because audio can be fresh while receiver telemetry is old.
- **Headshot.** 56×56, `--r-sm`, 2px `--rule`. Real production headshot, or a
  monogram on the person's assigned group colour at 22%. Never an illustration.
- **Character name** in ui-lg 600 `--ink`; **performer name** in ui-sm `--ink-2`
  beneath. Character first: the A1 calls the role, the cue sheet says the role.
- **Tape label.** Physical identity — receiver, antenna, input — in mono-sm on a
  tape strip, rotated `-0.4deg`. The thing you read out loud on comms.
- **Audio lane.** 10-second rolling trace, 28px tall, `--verified` when present,
  `--ink-2` when the scene expects silence, hatched when stale. Numeric peak in
  mono to the right, tabular.
- **RF lane.** 10-second RSSI trace in `--intervention` hue at 60%, 20px tall,
  with RSSI in mono and a **separate** five-segment link-quality indicator.
  Never merged into one health bar.
- **Exception line.** The single strongest exception, as glyph + sentence. If
  the cause is inferred rather than observed, the line is prefixed *likely* and
  the card's outline becomes dashed on that lane.
- **Check badges.** Eight positions matching the mic-check dimensions in
  [operator workflows](../product/operator-workflows.md): identity, RF, audio,
  mute/control, spare, battery, placement, operator sign-off. Passed is
  `--verified` tick, failed is `--critical`, not-yet-checked is a dot,
  invalidated by a swap is a dot with a small slash.
- **Incident owner.** Initials chip when claimed, with the claimant's colour.

### Zoom levels

Pinch cycles three levels. They change what is dropped, never where things are.

| Level | Size | Drops |
| --- | --- | --- |
| Compact | 168×108 | Tape label, RF lane, exception line, check badges |
| Standard | 300×212 | — |
| Expanded | 300×300 | Adds placement thumbnail, next intervention window, last verified time, operator note in the hand |

### States

- **Rest** — `--raised`, 3px `--rule`, `--sh`.
- **Listening** — marked edge, outline `--listening-ink`.
- **Latched** — marked edge plus a folded corner in the same ink, the way you
  dog-ear the page you are working on. Distinguishable from momentary at a
  glance, because getting this wrong is a safety issue.
- **Critical** — 2px `--critical` outline. No red wash over the card: WaveTool's
  red overlay obscures the headshot, which is the fastest identifier on the
  tile. The outline, the badge and the exception line carry it.
- **Expected silent** — audio lane in `--ink-2` with the label *expected silent*,
  explicitly not an alarm state.
- **Stale** — hatch on the affected lanes, age counter, values in `--stale`.
- **Unknown / unarmed** — value replaced by `—` and the word *unknown*. Never a
  zero, never an empty bar.
- **Muted at transmitter** — the tape label gains a `MUTE` chip in `--critical`,
  and the audio lane shows a flat line, labelled, not hatched. A muted pack is a
  known fact, not a missing measurement.

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

## Transport rail

Fixed to the bottom, 120px tall, full width, on every Live surface. Present at
desktop in the same place.

Left to right: listen state (what you are hearing, in the lit-edge treatment) ·
previous source · clear-all (long-press) · **MUTE** and **DIM** (56px, always
visible, never in a menu) · output level with its numeric value in mono · group
buttons 1–8 as press-to-listen pills with their group colour · replay entry.

Mute and dim are here because [listening safety](../quality/listening-safety.md)
requires an always-available local action, and because the rail is the thumb
zone. Listen always starts muted; the rail shows that state as a resting
condition, not an error.

## Exceptions rail

A right-hand rail, 340px at desktop, an edge-swipe sheet on iPad. Lists critical
exceptions across the entire show — including sources not in the current filter
and not on stage — plus system and audio-path faults affecting more than one
input. Sorted by severity then age. Each row is a 56px target that selects the
source and offers listen and claim inline.

## Inspector

Right drawer at desktop (460px), full-height sheet on iPad with a swipe-down
dismiss and a 56px close control.

Sections, in order: identity and assignment · RF detail including diversity and
interference, level and quality charted separately · captured audio versus
receiver audio meters · battery with history and next safe change window · check
badges with who and when · telemetry history · placement images · asset and
assignment history · cue expectations · incident evidence · actions.

Actions are a fixed row at the bottom of the inspector, in the thumb zone:
listen · replay from here · message · run check · prepare or promote spare ·
swap. Swap opens the transaction described in
[operator workflows](../product/operator-workflows.md) and shows the full
identity diff before anything is committed.

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
