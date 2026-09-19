# A2 Monitor — design language

- **Version:** 1.0.0
- **Status:** Proposed. Nothing here has been in front of an A2, an A1 or a real
  rack; none of it should be treated as validated until it has.
- **Last updated:** 2026-09-19

This is the whole design language in one document. It is normative: where it and
anything else disagree, this document is the intent, and the implementation is
wrong. The reasoning, the sources and the rounds that were rejected on the way
here live in [research notes](research-notes.md); the clickable reference build
is [`prototype/index.html`](prototype/index.html).

**Contents**

1. [Foundations](#1-foundations) · 2. [Principles](#2-principles) ·
3. [Colour](#3-colour) · 4. [Typography](#4-typography) ·
5. [Shape and elevation](#5-shape-and-elevation) · 6. [Motion](#6-motion) ·
7. [Iconography](#7-iconography) · 8. [Touch and input](#8-touch-and-input) ·
9. [The honesty grammar](#9-the-honesty-grammar) ·
10. [Components](#10-components) · 11. [Surfaces](#11-surfaces) ·
12. [Empty, loading and degraded](#12-empty-loading-and-degraded) ·
13. [Accessibility](#13-accessibility) · 14. [Changelog](#14-changelog)

---

## 1. Foundations

### 1.1 Built on RVLT

A2 Monitor is built on the **RVLT design language**, not on a separate system
that resembles it. Tokens, type roles, shapes, shadows and component behaviour
come from `rvlt-designlanguage` DESIGN.md §15.1 / Appendix A (v1.1.0) as
published. This document records the domain mapping on top of it and nothing
else. Where RVLT and this document disagree, RVLT wins and this document is
wrong.

Source: [RVLT design language](https://rvlt-labs.github.io/rvlt-designlanguage/),
[component preview](https://rvlt-labs.github.io/rvlt-designlanguage/preview);
accessed 2026-09-19.

### 1.2 The operator

An A2 in a wing, in the dark, half-dressed in blacks, one ear on comms, holding
an iPad in one hand and a spare pack in the other, ninety seconds before the
number ends. They are not sitting down. They will glance for one second and need
an answer.

An A1 at the desk, mixing, who will look at this for two seconds and then look
back at the console.

Everything below follows from those two people.

### 1.3 Two product decisions this rests on

Recorded as [ADR 0019](../decisions/0019-cue-optional-and-show-time-scope.md).

- **Live defaults to every channel.** Cue tracking is an opt-in layer. Silence
  alerting is a per-channel setting, never a cue-derived conclusion. No core
  function may become unavailable or untrustworthy because a production does not
  run a cue list.
- **The product owns show time.** During a performance the work happens here and
  an operator should not be hopping between programs. Coordination, scanning,
  deployment and firmware stay in the vendor tools.

---

## 2. Principles

**2.1 Glanceable before complete.** A surface is designed for the one-second
glance first and the two-minute investigation second. The card answers *is
anything wrong, and is it mine*. The detail answers *why*. A card that tries to
answer both fails at the first.

**2.2 Honest about what is known.** The product's credibility is the difference
between a measurement and a guess, and the interface must never let them look
alike. See [§9](#9-the-honesty-grammar).

**2.3 Machine type and human type are different type.** If a machine measured
it, it is mono. If a person wrote it, it is the hand. Hard rule.

**2.4 Never colour alone.** Every state carries a glyph and a word as well as a
colour. Remove all colour from any screen and it must still be operable.

**2.5 One fault never hides another.** The status strip carries every dimension
that can independently fail, in fixed positions, so a second critical fault is
visible behind the first.

**2.6 Nothing decorative moves.** There is exactly one piece of ambient motion in
the product — the pulse on an unclaimed fault report — and it marks work that has
been handed over and not picked up. Everything else moves only in response to a
touch or a change in data.

**2.7 Safety is a control, not a setting.** Listen starts muted. Mute and dim are
always visible and one touch away, never in a menu.

**2.8 The tool is advisory.** Alerts say what happened, not what it means. No
diagnosis is claimed before a labelled evidence base exists.

### 2.9 Refusals

This list exists because the default output of any design process is the same
dark dashboard, and that dashboard is indistinguishable from software nobody
chose to make.

- No gradients, anywhere, for any purpose.
- No glow, halo, bloom or coloured drop shadow.
- No glassmorphism or backdrop blur.
- No emoji as a status icon.
- No sparkle, wand or brain iconography.
- No stock illustration of people. Headshots are the production's real cast.
- No status expressed by colour alone.
- No animated skeleton shimmer. Loading states name what they are waiting for.
- No microcopy that performs enthusiasm. "Oops!", "Let's get started!" and
  "You're all set!" are banned strings.

### 2.10 Voice

Short. Specific. Present tense. Never enthusiastic, never apologetic.

- Good: "RF quality dropped on 27 at 21:04. Level is normal. Cause not observed."
- Bad: "Uh oh! We noticed something might be wrong with channel 27."

Numbers carry units. Times carry a reference point. Uncertainty is stated in
words, not implied by a pale colour.

---

## 3. Colour

### 3.1 Surfaces

RVLT ships a dark default and an opt-in light "Paper" theme. **A2 Monitor
defaults to Paper.** Dark is a straight theme switch, not a separate design, and
both are first class.

```
Paper   --paper #F4EEE1  --paper-2 #EDE4D2  --card #FFFDF8  --elev #FFFDF8
        --ink   #1D1A15  --ink-2   #4B4539  --muted #7D7565 --faint #A89E89
        --line  #E4DAC3  --line-2  #D8CCB0  --card-outline: var(--ink)

Dark    --paper #141210  --paper-2 #1A1613  --card #211C17  --elev #2A241D
        --ink   #F5EFE2  --ink-2   #CDC4B2  --muted #9E9483 --faint #6E665A
        --line  #332C24  --line-2  #473E32  --card-outline: var(--line-2)
```

On Paper the card outline is a 2px near-black rule and the shadow is a hard
`0 3px 0 var(--line-2)` with no blur, rising to `0 7px 0` on hover. That
outline-plus-offset is the whole material language: printed, tactile, pressable.
In dark, cards additionally take RVLT's `--lit` inner highlight, because the
outline is quieter there.

### 3.2 Theme resolution

Themes resolve in **three** states, not two: an explicit choice stamps
`data-theme` on the root, and the default "system" setting stamps nothing,
leaving only `prefers-color-scheme`.

- The Paper set is declared on bare `:root`.
- The dark set is declared **twice** — once behind
  `@media (prefers-color-scheme: dark)` guarded as
  `:root:not([data-theme="light"])`, and once behind `:root[data-theme="dark"]`
  so an in-app toggle wins in either direction.
- No component may define a colour that only resolves in one theme. The
  translucent alert veil and its text shadows are where this bites: they need
  `--veil` and `--veil-ink` tokens per theme, or the alert renders white on white
  in dark.

### 3.3 Domain mapping

The audio domain gets no new palette. It gets RVLT's existing roles.

| Meaning | Role | Paper | Dark |
| --- | --- | --- | --- |
| Live — what you are hearing | `--red` | `#C12229` | `#E0363D` |
| Critical fault | `--t-out` on `--out-soft` | `#9C1B21` | `#F26F73` |
| Needs intervention | `--warn` on `--warn-soft` | `#C98A14` | `#EBA53A` |
| Verified, healthy | `--ok` on `--ok-soft` | `#2EA65C` | `#4FD888` |
| Stale, unknown, disarmed | `--rep` on `--rep-soft` | `#8A8270` | `#B6AC9A` |
| Replay | `--purple` on `--purple-soft` | `#7A5CD0` | `#9B82E6` |

Red is reserved exactly as RVLT reserves it — active, live, alerts — and here
that means **the channel you are hearing**, and nothing else. A card with a red
outline is the one in your ears.

Groups use RVLT's eight-colour avatar ramp. Group colour is identity; it never
carries a state and never appears on a meter, a badge or a border.

---

## 4. Typography

RVLT's four roles, unchanged.

| Role | Family | Job here |
| --- | --- | --- |
| Display | **Archivo** 700/800, `-.02em` | Names, headings, the big figure |
| Body | **Hanken Grotesk** 400–700 | Everything read as language |
| Mono | **JetBrains Mono**, tabular | Anything a machine measured |
| Hand | **Kalam** 700 | Anything a person wrote |

The mono/hand split is load-bearing and is the one place this product leans on a
type rule harder than RVLT needs to: an operator must be able to tell at a glance
whether `−18.2 dBFS` came from a meter or `tape lifting again` came from a
colleague.

Figures are tabular everywhere. A readout that shifts horizontally as it changes
is unreadable in motion. Minimum interface text is 13px; minimum input text is
16px, so iOS does not zoom on focus.

---

## 5. Shape and elevation

```
--r 14px   --r-lg 20px   pill 99px
--sh-card 0 3px 0 var(--line-2)     --sh-hover 0 7px 0 var(--line-2)
```

Buttons are pills that travel: `translateY(-1px)` on hover,`translateY(2px)`
with the shadow collapsing to `0 1px 0` on press. Cards lift 3px on hover and
press 2px down. Inputs are 44px tall, 16px text, 2px `--line-2`, red focus ring.
All of this is RVLT §15.2 verbatim.

There are no blurred shadows and no gradients in this product.

---

## 6. Motion

| Use | Duration | Curve |
| --- | --- | --- |
| Control press | 120ms | `cubic-bezier(.2,.8,.3,1)` |
| State change | 160ms | `cubic-bezier(.2,.8,.3,1)` |
| Panel, sheet, player | 220ms | `cubic-bezier(.16,1,.3,1)` |

Meters and traces are **not** animated. They redraw at their data rate;
transitioning a live value makes it lie about when it changed.

`prefers-reduced-motion: reduce` removes every transition and animation. State
remains legible because it is carried by colour, glyph and word, not by movement.

The single exception to §2.6 is the report pulse ([§10.7](#107-reported-state)).

---

## 7. Iconography

Lucide, 2px stroke, at 16 / 20 / 24px. Verdict glyphs are drawn, not typed, so
they hold their weight at 12px. No icon appears without a label on a first-use
surface; icon-only controls are permitted only in the transport, where they are
learned within one performance, and each carries an accessible name.

---

## 8. Touch and input

Touch is the primary input, not a responsive afterthought. The A2 is holding the
device in one hand, in the dark, possibly gloved, with a spare pack in the other.

### 8.1 The contract

1. Every control is operable by touch with no pointer, no hover and no keyboard.
   Hover may add convenience; it may never be the only route to anything.
2. No control is smaller than **44×44**. Primary live actions are **56**. Verdict
   controls in mic check are **72** tall. Fault buttons in the report sheet are
   **72** tall.
3. At least 8px between adjacent targets, 12px where a mis-tap changes audio or
   identity.
4. Input text is 16px minimum.
5. Nothing depends on a precise drag. Every slider is also settable by a tap on
   its track.
6. No right-click, no double-click, no modifier-only action.
7. Destructive or audio-changing actions need a deliberate gesture — a long-press
   with visible progress, or a two-step confirm — never merely a bigger target.

### 8.2 Card targets

A card has exactly two targets:

- **The card itself** performs that surface's action: *listen* on the A2 grid,
  *report a fault* on the A1 view. The whole card, including the photograph.
- **The `⤢` button inside the photograph** opens the detail. It is the only thing
  on a card that does, and it carries a 44px hit area around a 32px visual.

Implementation: the card action is a full-bleed `<button>` behind the content,
and the content sets `pointer-events:none` so a press anywhere that is not the
expand button falls through. Both are real buttons with accessible names; neither
is nested in the other. **The alert overlay must re-enable pointer events for
itself** — forgetting this makes acknowledgement unpressable.

### 8.3 Keyboard

Everything reachable by touch is reachable by key. Arrow keys move channel focus;
`Space` listens, `Enter` latches, `Esc` clears; `1`–`8` press-to-listen groups;
`M` mute, `D` dim, `R` return to live, `/` search. Focus rings are 2px `--red`
offset 2px and are never suppressed.

---

## 9. The honesty grammar

Four states, kept visually distinct everywhere they appear.

| State | Treatment |
| --- | --- |
| **Observed** | Measured now. Solid fill, solid rule, mono numerals. |
| **Inferred** | Derived or suspected. Dashed rule, and the word *likely*. |
| **Stale** | Last known, too old. `--rep`, hatched, with a visible age. |
| **Unknown** | Never a zero, never green, never an empty bar. A dash, and the word. |

Cue-derived state that has lost authority becomes unknown, not last-known. The
interface shows that it stopped knowing rather than quietly continuing.

**RF level and link quality are never merged** into a single health figure.
Interference degrades quality without an equivalent fall in RSSI, so a merged
"RF health" bar is prohibited in every component.

---

## 10. Components

### 10.1 Channel card

The centrepiece, and it is a photograph. An A2 thinks in people: they are looking
for Eleanor, not for input 27, and a face is recognised faster than any label.

```
┌────────────────────────────────┐  2px outline · 0 3px 0 shadow
│ ┌────────────────────────────┐ │
│ │ 27                     ⤢   │ │ ← number; expand button
│ │        headshot 16:10      │ │
│ │ ●LISTENING                 │ │
│ │▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁▂▃▅▇█▆▄▂▁▂▃▄│ │ ← 10s trace on the bottom edge
│ └────────────────────────────┘ │
│ Eleanor Vance                  │
│ Marguerite Hale                │
│ ┌─────┬─────┬─────┬─────┐      │
│ │  ✕  │  ✓  │  ✓  │  ⚠  │      │ ← status strip
│ │ RF  │AUDIO│ BATT│CHECK│      │
│ └─────┴─────┴─────┴─────┘      │
└────────────────────────────────┘
```

- **Headshot.** The production's real approved headshot through Manager's managed
  image pipeline, 16:10 crop. Never an illustrated avatar, never stock. A source
  with no headshot shows the empty frame and reads as incomplete, because it is.
- **Channel number**, quiet mono over the photograph, top left.
- **Fault flags**, top right: a category that is clear says nothing; one in fault
  says its name.
- **Trace**, 10-second rolling window over a `--scrim`, following WaveTool's
  convention. `--ok` when present, `--ink-2` when silent, hatched when stale.
- **Caption**: character name in display 800, then performer in `--muted`.
  Character first — the A1 calls the role and the cue sheet says the role.

The card carries **no sentence** and no acknowledged-alert row. The status strip
already names what is wrong, and a row repeating it cost more height than it
earned.

### 10.2 Status strip

The thing an operator reads first after the face. One cell per dimension that can
independently fail, **always in the same order and position**, so the row is read
as a shape rather than parsed as text.

| Verdict | Glyph | Colour | Meaning |
| --- | --- | --- | --- |
| Good | `✓` tick | `--ok` on `--ok-soft` | Measured, within tolerance |
| Fault | `✕` cross | `--t-out` on `--out-soft` | Measured, wrong now |
| Caution | `⚠` triangle | `--warn` on `--warn-soft` | Needs someone, not failing yet |
| Unknown | `–` dash | `--rep` on `--rep-soft` | Stale, disarmed, or never measured |
| Not applicable | `∕` slash | `--rep` 50% | Dimension does not exist here |

Default dimensions: **RF · Audio · Battery · Check**. The set is per-deployment,
not hard-coded: an in-ears rig adds a cell, a wired-only rig drops RF and battery
to *not applicable* rather than showing false greens.

- Never colour alone: every cell carries a glyph, a label, and an accessible
  description of the form "RF link: fault".
- **Unknown is never green and never zero.** A channel disarmed for silence
  ([ADR 0019](../decisions/0019-cue-optional-and-show-time-scope.md)) reads as
  unknown on Audio, not as healthy.
- A faulted or cautioned cell tints its whole background, so the strip reads from
  across a wing without the glyph being legible.
- This strip is the mechanism for [§2.5](#2-principles): a channel can be
  `✕ RF` and `⚠ Check` at once, and both are visible without opening anything.

### 10.3 Alert overlay

An alert nobody has acknowledged **veils the whole card**, the way WaveTool draws
its fault overlay on a channel strip.

**A veil, not a replacement.** The tint covers the card, but the face, the number,
the meter, the name and the status strip all still read underneath — that is what
an operator needs to start troubleshooting. The mark is pinned to the
photograph's box rather than centred on the card, where it would be written
across the performer's name.

**It names the problem and nothing else.** One icon, two words — *Low RF*, *No
audio*, *Low battery* — and `PRESS TO ACKNOWLEDGE`. No explanation, no timestamp,
no diagnosis, no action list. The operator troubleshoots; the product's job is to
say which channel and which kind, fast, from across a wing.

Behaviour:

1. **Pressing the card acknowledges it, and nothing else.** There is no
   Acknowledge button. The first press clears the alert and returns the card to
   normal, so a **second press listens** — the same press that listens to any
   other channel. One gesture, one consequence.
2. **The overlay expires; the alert does not** — except at critical, which does
   not expire at all. A critical alert (audio loss, RF loss) holds the card until
   somebody acknowledges it: a show-stopping fault that nobody has seen is
   exactly the thing that must keep arguing. Everything below critical clears
   itself after **five minutes** by default, so an unattended screen does not end
   the night as a wall of red. A countdown along the bottom edge shows expiry
   coming; a critical overlay has no countdown, and its absence is the signal
   that this one is not going away on its own. Both are production policy.
3. **Expiry is not acknowledgement.** A timed-out alert still counts in the
   header's outstanding total. An alert nobody saw must never look like one
   somebody saw.
4. **Acknowledging is not fixing.** The failed dimension stays failed in the
   status strip. The alert, its time and whether it was seen live in the channel
   detail and on the replay timeline, not on the card.
5. **A fault that clears takes its alert with it**, acknowledged or not. Nobody
   should be asked to dismiss something that is no longer true. The event remains
   in the channel history and on the replay timeline.

### 10.4 The player

The bottom bar is a player for the selected channel and behaves like one:
artwork, name, transport, a scrub with a time code, and a volume. An operator
knows how to use it before anyone explains it.

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
└──────────────────────────────────────────────────────────────────────┘
```

**The timeline.** Four measurements over one shared window — audio, RF level,
link quality, battery — stacked so they are read together, with **one playhead
crossing all four** so every value is read at the same instant. Everything after
the playhead is dimmed: it is later than what you are hearing. Battery is a slow
line over hours, and that shallow fall is the shape that answers whether a pack
reaches the interval. Window is configurable at 10 / 30 / 60 minutes and the axis
relabels with it.

**Scrubbing is how you listen back.** Dragging the scrub back is the replay
feature. There is no separate mode to enter: the channel you are hearing stays
the channel, and you move it in time. At the right edge you are live; anything
left is replay, the bar tints `--purple`, and the right time code becomes **BACK
TO LIVE** — one press, from anywhere. Event marks sit on the rail at the time
they happened, so an operator can aim rather than hunt.

**Save replay** is a permissioned action with its own button, never automatic and
never a side effect.

The operator sets the window. Pressing Save opens in and out handles on the scrub
rail, **pre-set to 30 seconds either side of the playhead**, so accepting the
default is one further press and adjusting is a drag. Because a drag on touch is
imprecise and this is an export, each handle also has −5s / +5s steppers and the
resulting duration is shown as a number: nobody should discover the clip was the
wrong length after it was written.

Before writing anything the sheet states which channel, from when, how long, and
what is included — and says plainly that **Mark** does not export audio, because
the two get confused and only one has a privacy consequence. Export is separately
permissioned from listening and from marking.

**Transport row**, always visible: what you are hearing · previous · clear ·
**mute** · **dim** · output level with its numeric value · groups · expand.

### 10.5 Detail

Opened by the `⤢` button. This is where the depth lives, which is what lets the
grid stay sparse, and it is the surface that makes [§1.3](#13-two-product-decisions-this-rests-on)'s
show-time claim true.

- **Antennas and diversity** — level per antenna with the squelch threshold
  marked on each bar, which antenna is carrying, link quality as its own figure.
- **Frequency** — frequency, group, channel, TX power, encryption.
- **Audio** — captured level, receiver gain, trim, TX mute, input.
- **Transmitter** — model, asset, firmware, lock, battery type.
- **Battery** — remaining, charge, temperature, cycles, when changed.
- **Receiver** — model, slot, address, firmware, telemetry freshness.
- **Show assignment** — performer, role, element, placement, spare, last check.

**Capability-driven.** A field a receiver does not report renders as unknown, not
as a plausible default. A wired input drops the RF, transmitter and battery
groups rather than showing false values. This needs a per-model capability map
for *display*, not only for control.

### 10.6 Report sheet

The A1's whole job, in one thumb. Specified with its surface in
[§11.2](#112-a1-mix-confidence).

### 10.7 Reported state

A channel with an unclaimed fault report **pulses its outline**, on the A1 grid
and on the A2 grid, and shows a `REPORTED` badge with a count when more than one
issue went. It stops on claim, when the card reads `BEING WORKED` with the
claimant.

This is the only ambient motion in the product and it earns the exception: it
marks work that has been handed over and not yet picked up, which is precisely
the state nobody should be able to sit in unnoticed. `prefers-reduced-motion`
removes the motion; the amber outline stays.

### 10.8 Smaller parts

- **Badges** — RVLT §3.3: pill, 700 weight, 11px, soft-tinted, with a dot.
- **Buttons** — RVLT §15.2. `--red` primary is reserved for the one live or
  destructive action in view.
- **Groups** — the transport's press-to-listen buttons come from two places.
  **Show groups** are authored in Manager with the show file: principals,
  ensemble, band, radio mics. They are stable across a run and identical for
  every operator. **Personal groups** are slots each operator fills themselves
  during the show — my zone, my quick changes, the three I am watching — and are
  not shared. Both appear in the same rail, with personal groups after show
  groups. Editing a show group is a Manager action and is blocked by show lock;
  editing a personal group is not.
- **Filter band** — one horizontal row under the header, 42px pill chips with
  live counts, pressed state `--ink` filled. **Default is All channels.**
  Cue-derived filters appear only when a cue source is connected.
- **Exceptions sheet** — a sheet, not a standing rail, opened from the header
  counters. Lists critical exceptions across the whole show including sources not
  in the current filter.
- **Operator notes** — Kalam on a `--warn` left rule. Anything a person wrote is
  the hand; anything a machine measured is mono ([§2.3](#2-principles)).

There is **no sidebar** in this product. A standing left rail spends permanent
width on navigation used in bursts; a standing right rail spends it on a list
that is empty most of the night. The width goes to faces.

---

## 11. Surfaces

### 11.1 A2 grid

The A2's home screen. Knowing, in one glance from across a wing, which of the
people you are responsible for needs you next — and getting from that glance to
audio in one press and to a diagnosis in two.

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER  show · node · you · [no cue source]   counters         │
├────────────────────────────────────────────────────────────────┤
│ SHOWING [All channels 64][Needs someone 4][Wireless][Wired]…   │
├────────────────────────────────────────────────────────────────┤
│ CHANNEL GRID — full width, photographs                         │
├────────────────────────────────────────────────────────────────┤
│ PLAYER — collapsed transport, or expanded with the timeline    │
└────────────────────────────────────────────────────────────────┘
```

Default is **all channels** ([§1.3](#13-two-product-decisions-this-rests-on)).
Sources with a critical exception pin to the top of the grid regardless of
filter, and also appear in the exceptions sheet: the sheet is show-wide truth,
the grid is current-context truth, and a critical fault belongs in both.

Press a card to listen. Source switching changes an established server-side bus
and never renegotiates media, so the interface must not show a connecting state
on a source change — a tap that appeared to reconnect would teach operators to
distrust the tap.

Emergency remap and swap are initiated from the detail, never from the card,
because they must never be one gesture away from a listen. The transaction shows
the replacement, the complete identity and external-action diff, a *physical
change in progress* state, RF and audio verification, the A1 confirmation
request, and the audited inverse. The old mapping stays historically correct.

### 11.2 A1 mix confidence

**The A1 does not listen here.** They are mixing, they hear the show on the
console through a monitor path they already trust, and they are not going to
audition a source on a tablet mid-number. The product has nothing to add to how
an A1 hears.

What it has to add is **the two seconds between noticing something and backstage
knowing about it** — today a verbal call with an identity translation at both
ends. So this surface carries no listen control, no transport, no player and no
output level. Pressing a channel reports a fault.

The report flow:

1. **Press the channel.** A sheet rises with the performer, the console number,
   and one question: *What are you hearing?*
2. **Press what is wrong — as many as apply.** Eight faults in the A1's own
   words (dropping out, crackling, distorted, too quiet, clothing noise, popping,
   hum or buzz, nothing at all) plus *something else, dictate a note*. Each a
   72px target with a tick when selected. Multi-select because faults arrive
   together: clothing noise *and* crackling is a different diagnosis from either
   alone, and forcing one choice throws away what tells an A2 where to start.
3. **Press Send.** The button counts what is going — *Send 2 issues*. The sheet
   then shows everything that went, who has it, and an **Undo** live for a few
   seconds, with *Mark urgent — it is on air now* as a follow-up rather than a
   prerequisite.

Two presses and no typing. The report carries the channel, the performer, the
faults in plain words, the time and the sender — no identity translation, no
readback.

**A report creates a task**, not an incident: requested work with a requester, an
assignee, a due time and completion evidence, which is what "go and look at 33"
actually is. It **auto-promotes to an incident** when the A1 marks it urgent, or
when telemetry already shows a fault on that channel — because a report that
agrees with the receiver is an observed problem, not a request. Promotion keeps
the request history rather than replacing it.

That distinction matters for the A1: a task they raised can be claimed, done and
closed without them being consulted again, whereas an incident will come back to
them for confirmation that the symptom is gone.

The bottom bar is not a player: it is the A1's open reports and who has them, so
"did anyone pick that up" is always answered on screen. Cards pulse until
claimed ([§10.7](#107-reported-state)).

Nothing on this surface steals focus. No modal opens unprompted, no sound plays,
and no notification interrupts a cue.

### 11.2.1 How the A2 hears about it

An incoming report shows as a **persistent banner on whatever surface the A2 is
on** — the grid, the detail, mid mic-check. Every report, not only urgent ones.

This is a deliberate exception to the plan's attention policy, which keeps
ordinary traffic out of the way. A fault report is not ordinary traffic: it is
assigned work from the one person in the building who can hear the programme, and
the cost of an A2 finishing a five-minute mic check before noticing it is higher
than the cost of the interruption. The banner is dismissible, never covers a
meter, and never plays a sound.

Comms remains the authoritative urgent path. The banner is how the app stops a
report sitting unseen; it is not a replacement for somebody saying it out loud.

### 11.3 Guided mic check

The only surface operated while physically working on another human being. Its
ergonomics override everything else.

The operator has one hand; the other is holding a transmitter, a belt, a wig cap
or a costume. They are often kneeling. The performer is talking to them. So: one
screen, one person, one decision at a time, verdict controls **72px tall in a
reachable half of the screen**, handedness a setting, and no scrolling to
complete a check.

Eight explicit dimensions, never one ambiguous checkbox: physical identity and
label · RF and link in the zone · captured audio heard · transmitter mute and
control · primary and spare pack · battery for the show window · placement and
costume acknowledged · operator sign-off. Each records **who** verified it and
**when**.

**Captured audio heard is the A1's verdict, and the A1 hears it on the console.**
This is the one dimension that must not be confirmed by the person who fitted the
microphone: the point of it is that what reaches the desk is what the A2 thinks
it is. The A1 checks it through PFL as they always have — the app adds nothing to
how they hear — and the product only records the verdict.

So this dimension has a third state the others do not: **waiting on A1**. The
A2's check screen shows it outstanding and moves on rather than blocking, and the
A1 gets a small pass/fail prompt on their own surface, which is the only place
the A1 view carries a verdict control. It does not carry a listen control, before
or during the show ([§11.2](#112-a1-mix-confidence)).

- Work is ordered by A2 track or zone, not channel number.
- Progress persists across a break, a reload, a device change and a backend
  restart.
- **Absent, already-costumed and blocked performers stay visible as explicit
  exceptions.** Skip requires choosing which, and that reason is recorded.
- A swap invalidates only the checks whose subject changed. Valid work is never
  erased.
- Listen is hold-to-hear, so audio cannot be left open while the operator walks
  away.
- Fail opens a one-tap reason list. Dictation is available; typing never required.

### 11.4 Replay and incidents

There are two replay mechanisms and they do different jobs.

**The player** ([§10.4](#104-the-player)) is replay in the moment: one channel,
scrubbed back, while the show runs. It is the common case and it is not a place
you go.

**This surface** is for working an incident, usually afterwards: several lanes at
once, markers, ownership, evidence and resolution. Reaching for it is a
deliberate act, and entering it is a mode change.

Replay is a **mode**, and the most dangerous state in the product: an operator
hearing the past while a show happens in the present.

- The viewport gains a `--purple` chrome edge. Every meter, trace and value
  renders in `--purple`. If it is violet, it already happened.
- A persistent bar states the offset and the epoch in mono.
- **BACK TO LIVE** is one press, always visible, never behind a confirm.
- Current critical alerts stay visible in a pinned live strip in their live
  colours, explicitly labelled `LIVE` — the one place the two time bases appear
  together, marked in both directions.

The timeline stacks audio, RF level, link quality and events on one x-axis, with
gaps in telemetry hatched rather than interpolated. Lane heights are touch
targets. Seeking is by tap, by 10-second steppers, or by drag; a drag is never
required. Changing source preserves historical time where media exists; where it
does not, the card says so rather than jumping to live.

The incident view filters the same timeline to one incident, merging system
observations, operator reports, cue changes, assignment and swap events, replay
markers, ownership and selected messages — not the whole conversation.
Resolution requires action, evidence and **confidence**, and confidence is three
explicit words — *observed*, *likely*, *unconfirmed* — not a slider.

---

## 12. Empty, loading and degraded

- **Empty** — a specific sentence: "No show is active. Open Manager to activate
  one." Never "No data available."
- **Loading** — name what is being waited for: "Waiting for the audio node." No
  shimmer skeletons.
- **Backend lost** — listening, replay, approved emergency swaps and check
  results continue against the leased node, and **fault reports go with them**.
  Reporting is the A1's entire job on this product, and an outage is exactly when
  something is most likely to be going wrong, so a report reaches the A2
  immediately over the node path rather than queueing. What does wait for the
  backend is the *lifecycle* around it — claiming, assignment, ownership and
  promotion to an incident — which reconciles when the backend returns. The A1
  sees that the report arrived and that ownership is pending, which is the honest
  description of what has happened. Chat and ordinary task assignment still grey
  out with an explicit offline banner, and unsent drafts are visibly unsent,
  never shown as sent.

  This extends the leased-node event set in
  [A1/A2 views](../product/a1-a2-views-and-collaboration.md), which already
  carries check results and local evidence markers needed for immediate show
  safety. It does not make the node a collaboration server: a fault report is a
  bounded, safety-relevant event of the same kind, not a message thread.
- **Receiver telemetry stale** — per-lane hatch and age. Audio stays live; only
  the affected lanes degrade.
- **Show lock** — identity, binding, alert-policy and scene edits disappear
  rather than disabling.

---

## 13. Accessibility

- All interactive elements are real buttons with accessible names.
- The whole product is operable with every semantic colour removed.
- Target sizes exceed WCAG 2.2 AA (24px) and meet AAA (44px).
- Live regions announce only what an operator must know — a critical fault
  appearing, listen latching, replay entering or leaving. A meter does not
  announce.
- All text meets AA against its own surface; meter numerals meet AAA where
  achievable, because they are read at a glance in the dark at low brightness.

---

## 14. Changelog

**1.0.0 — 2026-09-19.** First consolidated document. Supersedes the separate
principles, visual-language, touch-and-input, components and per-surface files,
which are removed; the rounds that were rejected on the way here are recorded in
[research notes](research-notes.md).
