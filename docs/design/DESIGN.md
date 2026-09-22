# Pulse — design language

- **Version:** 2.1.1
- **Status:** Proposed. Nothing here has been in front of an A2, an A1 or a real
  rack; none of it should be treated as validated until it has.
- **Last updated:** 2026-09-22

This is the whole design language in one document. It is normative: where it and
anything else disagree, this document is the intent, and the implementation is
wrong. The reasoning, the sources and the rounds that were rejected on the way
here live in [research notes](research-notes.md) — that file predates this
version and still describes the earlier, RVLT-inherited system; treat it as
history, not as a source of current truth. The interactive prototype that used
to serve as the clickable reference build is [archived](archive/README.md),
not updated to match this version — the shipped Live and Manager apps are the
current reference build.

**Contents**

**1.** [Foundations](#1-foundations) · **2.** [Principles](#2-principles) ·
**3.** [Colour](#3-colour) · **4.** [Typography](#4-typography) ·
**5.** [Shape and elevation](#5-shape-and-elevation) · **6.** [Motion](#6-motion) ·
**7.** [Iconography](#7-iconography) · **8.** [Touch and input](#8-touch-and-input) ·
**9.** [The honesty grammar](#9-the-honesty-grammar) ·
**10.** [Components](#10-components) · **11.** [Surfaces](#11-surfaces) ·
**12.** [Empty, loading and degraded](#12-empty-loading-and-degraded) ·
**13.** [Accessibility](#13-accessibility) · **14.** [Changelog](#14-changelog)

---

## 1. Foundations

### 1.1 A system of its own

Pulse ships as part of the RVLT product family, alongside RVLT Flow and Beacon
by RVLT, and shares their instinct for plain, unpretentious software. But it is
not built on a shared token system with them, and this document is not a list
of deviations from someone else's design language. Pulse's tokens, type,
shape and motion exist because of what this product is: an instrument panel
read in the dark, backstage, for a few seconds at a time, by someone who is not
looking at a screen for a living. Where an earlier version of this document
inherited a design language from elsewhere, it has been replaced wholesale.
Nothing below should be read as "the same as before, but green."

### 1.2 Dark. Only.

Pulse is a dark-mode app, full stop. It is read in a wing, a booth, a tech
table, lights down, and a light surface has no job there. There is no light
or "Paper" theme, no `data-theme` switch, no theme picker in the UI, and no
`prefers-color-scheme` branching in the tokens — one surface, declared once,
with nothing to resolve. An earlier draft of this system shipped a light
alternate and defaulted to it; both the default and the alternate are gone.
If daytime desk use ever turns out to need something different, that is a
second, explicitly-scoped product decision, not a theme toggle bolted onto
this one.

### 1.3 One rule for who wrote a number

If a machine measured it, it is monospaced. If a person typed it, it reads like
a sentence, not like a receipt. That is the entire distinction this product
needs between an RF reading and an operator's note, and it is carried by
weight and slope, not by importing a handwriting font that has to be banned
from half the surfaces it would obviously ruin. See [§4.3](#43-machine-and-human-type).

### 1.4 The operator

An A2 in a wing, in the dark, half-dressed in blacks, one ear on comms, holding
an iPad in one hand and a spare pack in the other, ninety seconds before the
number ends. They are not sitting down. They will glance for one second and need
an answer.

An A1 at the desk, mixing, who will look at this for two seconds and then look
back at the console.

Everything below follows from those two people.

### 1.5 Two product decisions this rests on

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
glance first and the two-minute investigation second. The card answers _is
anything wrong, and is it mine_. The detail answers _why_. A card that tries to
answer both fails at the first.

**2.2 Honest about what is known.** The product's credibility is the difference
between a measurement and a guess, and the interface must never let them look
alike. See [§9](#9-the-honesty-grammar).

**2.3 Machine type and human type are different type.** If a machine measured
it, it is mono. If a person wrote it, it reads like the rest of the interface,
just angled. Hard rule. See [§4.3](#43-machine-and-human-type).

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

**2.9 The brand is the good state.** Pulse's signal green is not a decoration
borrowed for the logo — it is the same colour the product uses for _verified,
healthy_ everywhere else ([§3.3](#33-accent-roles)). The mark on the icon and
the tick on a channel card are the same claim: this is working.

### 2.10 Refusals

This list exists because it is easy to make an operational tool that looks like
every other ops dashboard — a gradient-lit hero header, a glassy card, a status
dot that only means something if you already know the palette. These refusals
keep Pulse looking like an instrument built for this job, not a generic admin
console that happens to be dark.

- No gradients, anywhere, for any purpose.
- No glow, halo, bloom or coloured drop shadow. Elevation comes from a soft
  neutral shadow and a lighter surface, never a colour-tinted one.
- No glassmorphism or backdrop blur.
- No emoji as a status icon.
- No sparkle, wand or brain iconography.
- No stock illustration of people. Headshots are the production's real cast.
- No status expressed by colour alone.
- No animated skeleton shimmer. Loading states name what they are waiting for.
- No microcopy that performs enthusiasm. "Oops!", "Let's get started!" and
  "You're all set!" are banned strings.

### 2.11 Voice

Short. Specific. Present tense. Never enthusiastic, never apologetic.

- Good: "RF quality dropped on 27 at 21:04. Level is normal. Cause not observed."
- Bad: "Uh oh! We noticed something might be wrong with channel 27."

Numbers carry units. Times carry a reference point. Uncertainty is stated in
words, not implied by a pale colour.

---

## 3. Colour

### 3.1 Surfaces

There is one surface: dark. No opt-in alternate, no theme resolution.

```
--paper #141210  --paper-2 #1a1613  --card #211c17  --elev #2a241d
--ink   #f5efe2  --ink-2   #cdc4b2  --muted #9e9483 --faint #6e665a
--line  #332c24  --line-2  #473e32
```

Cards are a hairline `--line` rule plus a soft neutral shadow, never a thick
outline and never a hard pixel-offset shadow — see
[§5](#5-shape-and-elevation) for why.

### 3.2 Never inline a value

A MUST: **a component never names a raw hex, px or radius — it references a
token.** This still matters with exactly one theme: it is what lets the whole
product be retuned from one file, keeps a component from silently drifting off
the palette, and is the only reason `--veil`/`--veil-ink` exist as their own
tokens rather than a value typed straight into the alert overlay. A surface
this system needs that has no token yet — a pressed control, a recessed well
behind a trace — gets a token (`--elev-2`, `--well`) rather than an inlined
colour at the component.

### 3.3 Accent roles

Three accents, each doing one job, none of them decorative:

| Role                     | Token      | Value     | Job                                                     |
| ------------------------ | ---------- | --------- | ------------------------------------------------------- |
| Signal (brand + healthy) | `--ok`     | `#4fd888` | The product's own colour. Verified, healthy, listening. |
| Warn                     | `--warn`   | `#eba53a` | Needs someone, not failing yet.                         |
| Replay                   | `--purple` | `#9b82e6` | You are hearing the past, not the present.              |

Signal green is not a fourth, separate "brand colour" layered on top of the
semantic system — it _is_ the semantic system's healthy state
([§2.9](#2-principles)). A card with every tick green is, by
construction, on-brand.

### 3.4 Domain mapping

| Meaning                     | Role                          | Value     |
| --------------------------- | ----------------------------- | --------- |
| Live — what you are hearing | `--red`                       | `#e0363d` |
| Critical fault              | `--t-out` on `--out-soft`     | `#f26f73` |
| Needs intervention          | `--warn` on `--warn-soft`     | `#eba53a` |
| Verified, healthy           | `--ok` on `--ok-soft`         | `#4fd888` |
| Stale, unknown, disarmed    | `--rep` on `--rep-soft`       | `#b6ac9a` |
| Replay                      | `--purple` on `--purple-soft` | `#9b82e6` |

Red is reserved, strictly: active, live, alerts, and here that means **the
channel you are hearing**, and nothing else. It never appears in the wordmark,
the icon, a chart, or any chrome that is not saying one of those two things. A
card with a red outline is the one in your ears.

Groups use an eight-colour avatar ramp, carried over unchanged from before.
Group colour is identity; it never carries a state and never appears on a
meter, a badge or a border.

---

## 4. Typography

Two families, not four. **IBM Plex Sans carries display, body and the
wordmark** — one typeface, read at different weights, sizes and tracking,
rather than reaching for a separate "brand" typeface to make the logotype feel
distinct. **IBM Plex Mono is every machine measurement.** Plex was chosen
because it is a real technical typeface with its own history (IBM's own,
built for print and code and screens together), not because it was trending
in a font picker — an earlier draft of this system used Space Grotesk and
Fredoka, both of which had drifted into being the default look of any
AI-assisted mockup, and neither said anything specific about this product.

| Role      | Family                            | Weights         | Job here                                                                              |
| --------- | --------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| Display   | **IBM Plex Sans**                 | 600 / 700       | Page titles, panel headers, the one bright figure                                     |
| Body      | **IBM Plex Sans**                 | 400 / 500       | Everything read as language; all UI text, labels, controls                            |
| Data mono | **IBM Plex Mono**, `tabular-nums` | 400 / 500 / 600 | Anything a machine measured — levels, frequencies, times, asset IDs. Data cells only. |
| Wordmark  | **IBM Plex Sans**                 | 700             | The product lockup only, at −.02em tracking. Never a separate typeface.               |

### 4.1 App type ramp (LOCKED — do not invent UI sizes)

| Role                   | Size / line / tracking | Family · weight            | Use                                 |
| ---------------------- | ---------------------- | -------------------------- | ----------------------------------- |
| App page title         | 24 / 1.2 / −.02em      | display 700                | the one `h1` on a screen            |
| Section / panel header | 18 / 1.25 / −.01em     | display 600                | card and section headers            |
| Card / widget title    | 15 / 1.3               | display 600 _or_ body 600  | channel name on a card              |
| Reading body           | 16 / 1.5               | body 400                   | descriptions, help, long text       |
| UI text / label        | 14 / 1.4               | body 500                   | controls, nav, form labels, buttons |
| Table cell             | 13.5 / 1.4             | body 400, mono for figures | rows, detail values                 |
| Caption / meta         | 12 / 1.35              | body 500                   | secondary meta, timestamps          |
| Badge / micro          | 11 (floor)             | body 700                   | status pills, counts, tags          |

- **11px is an absolute floor.** Nothing in this product is smaller, including
  status-strip labels and axis ticks.
- Buttons are UI text, 14px, weight 600. Mono matches the cell it sits in.
- Weights: display 600–700 for titles; body 400 read / 500 UI / 600 emphasis /
  700 badge. No others — Plex Sans's lighter (100–300) and heavier cuts are
  unused.
- Keep the high-contrast jump: a 24px display title over 13.5px quiet rows. Do
  not flatten everything to one size.

### 4.2 Casing

**Sentence case everywhere. `text-transform: uppercase` is banned.** Shouting a
label in caps doesn't make it more legible under stage light — it just adds a
second visual weight to fight with the display type. That includes the places
an operational tool reaches for it by reflex: status-strip labels, badges,
section overlines, filter-band labels, the alert overlay, transport labels and
column headers. An overline is 11px / 600, sentence case, `--muted` — never
10px, never uppercase.

### 4.3 Machine and human type

If a machine measured it, it is mono. If a person wrote it, it is body type,
italic. This is load-bearing: an operator must be able to tell at a glance
whether `−18.2 dBFS` came from a meter or `tape lifting again` came from a
colleague, without a legend.

An operator's own note is `--font-body` italic, 400, `--ink-2` — quieter than
a measurement, but still comfortably readable at a glance, never a display
typeface standing in for handwriting. It is never used for a value, a unit, a
time, or anything that must be read precisely — and never inside an alert, a
critical notice or a destructive confirmation, where an italic aside would
read as hedging on something that isn't optional.

Figures are tabular everywhere. A readout that shifts horizontally as it
changes is unreadable in motion. Reading body stays ≥16px; functional UI text
steps down per the ramp, which is allowed and is not a violation of the
body-size rule.

## 5. Shape and elevation

Pulse's material is soft, not pressable. A card sits slightly above the page
because of light and shadow, not because it looks like a button waiting to be
pushed down 2px. This is the one place this version breaks hardest from what
came before, which borrowed a printed, outlined, hard-shadow language that
answered to a different product's brand, not to a screen read at arm's length
in the dark.

```
--r 12px   --r-lg 18px   pill 999px
```

**Cards.** A 1px hairline `--line` border, plus a two-layer soft shadow: a
tight, low-opacity contact shadow and a broader, softer ambient one. Nothing
sharp, nothing offset, nothing that reads as a drop-shadow filter slapped on
in one pass.

```
--shadow-1: 0 1px 2px rgb(0 0 0 / 28%)                            /* resting */
--shadow-2: 0 2px 6px rgb(0 0 0 / 22%), 0 8px 24px rgb(0 0 0 / 24%)  /* card, hover */
--shadow-3: 0 8px 16px rgb(0 0 0 / 26%), 0 24px 48px rgb(0 0 0 / 30%) /* dialog, sheet */
```

Shadow alone reads poorly on a near-black page — a dark shadow is nearly
invisible against dark, and a light glow reads as a bug, not depth
([§2.10](#210-refusals) bans coloured glow outright). So elevation is carried
by **two signals together**: the shadow above, _and_ a one-step-lighter surface
colour (`--paper` → `--card` → `--elev`) with a faint inset top highlight —

```
--card-lit: inset 0 1px 0 rgb(255 253 248 / 12%)
```

— which reads as a sliver of light catching the top edge of a raised surface.

**Hover and press.** A card lifts from `--shadow-2` to `--shadow-3` and rises
1px on hover; it settles back on press, shadow included — a soft compression,
not a hard pixel-snap. Buttons darken or lighten their fill by one step and
lose their shadow on press; they never translate.

**Borders carry state, not weight.** A resting card's border is `--line`, 1px,
quiet. Selection and focus are a **2px accent ring, offset 2px from the edge**
— never a thicker version of the same neutral border, because a thicker
neutral border and a normal one are too easy to confuse at a glance. Which
accent depends on context: `--red` for the channel in your ears and for
keyboard focus generally, `--ink-2` for "this is the one I have open."

**Controls stay pills.** Buttons, filter chips and badges keep the fully
rounded `999px` shape — a soft, closed form that reads as "press me" without a
hard edge, and the one place a rounded geometry is allowed to leak into UI
chrome. Cards and panels use the smaller `12`/`18px` radii; nothing in the
product uses a sharp corner.

All of this replaces the old `0 3px 0` hard-offset shadow and the 2px ink
outline on every card, control and photo frame outright. Nothing in the
product should still read as "printed and pressable" once this ships.

---

## 6. Motion

| Use                  | Duration | Curve                      |
| -------------------- | -------- | -------------------------- |
| Control press        | 120ms    | `cubic-bezier(.2,.8,.3,1)` |
| State change         | 160ms    | `cubic-bezier(.2,.8,.3,1)` |
| Panel, sheet, player | 220ms    | `cubic-bezier(.16,1,.3,1)` |

Meters and traces are **not** animated. They redraw at their data rate;
transitioning a live value makes it lie about when it changed.

`prefers-reduced-motion: reduce` removes every transition and animation. State
remains legible because it is carried by colour, glyph and word, not by movement.

Pulse allows itself **at most two signature loops** — restraint here is a
choice, not a limitation. This product spends both: the live dot's
`pulse 1.7s`, and the report pulse on an unclaimed fault report
([§10.7](#107-reported-state)). There is no third, and adding one means removing
one.

---

## 7. Iconography

Interface icons are Lucide, 2px stroke, at 16 / 20 / 24px. Verdict glyphs are
drawn, not typed, so they hold their weight at 12px. No icon appears without a
label on a first-use surface; icon-only controls are permitted only in the
transport, where they are learned within one performance, and each carries an
accessible name.

The **brand mark** is a separate thing from interface iconography: five
vertical bars in a mountain profile — a level meter and an RF signal-strength
indicator at once, which is what this product actually watches. It appears at
full size (icon, favicon, the header lockup) and is never repurposed as an
interface glyph; a channel's own meter trace ([§10.1](#101-channel-card)) is
drawn fresh per component, not a scaled copy of the logo.

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

- **The card itself** performs that surface's action: _listen_ on the A2 grid,
  _report a fault_ on the A1 view. The whole card, including the photograph.
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
`M` mute, `D` dim, `R` return to live, `/` search. Focus rings are the 2px accent
ring from [§5](#5-shape-and-elevation) and are never suppressed.

---

## 9. The honesty grammar

Four states, kept visually distinct everywhere they appear.

| State        | Treatment                                                            |
| ------------ | -------------------------------------------------------------------- |
| **Observed** | Measured now. Solid fill, solid rule, mono numerals.                 |
| **Inferred** | Derived or suspected. Dashed rule, and the word _likely_.            |
| **Stale**    | Last known, too old. `--rep`, hatched, with a visible age.           |
| **Unknown**  | Never a zero, never green, never an empty bar. A dash, and the word. |

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
┌────────────────────────────────┐  1px hairline · soft shadow, no outline
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
- **Trace**, 10-second rolling window over a `--scrim`, in `--ok` when present,
  `--ink-2` when silent, hatched when stale.
- **Caption**: character name in display 600, then performer in `--muted`.
  Character first — the A1 calls the role and the cue sheet says the role.

The card carries **no sentence** and no acknowledged-alert row. The status strip
already names what is wrong, and a row repeating it cost more height than it
earned.

### 10.2 Status strip

The thing an operator reads first after the face. One cell per dimension that can
independently fail, **always in the same order and position**, so the row is read
as a shape rather than parsed as text.

| Verdict        | Glyph        | Colour                    | Meaning                            |
| -------------- | ------------ | ------------------------- | ---------------------------------- |
| Good           | `✓` tick     | `--ok` on `--ok-soft`     | Measured, within tolerance         |
| Fault          | `✕` cross    | `--t-out` on `--out-soft` | Measured, wrong now                |
| Caution        | `⚠` triangle | `--warn` on `--warn-soft` | Needs someone, not failing yet     |
| Unknown        | `–` dash     | `--rep` on `--rep-soft`   | Stale, disarmed, or never measured |
| Not applicable | `∕` slash    | `--rep` 50%               | Dimension does not exist here      |

Default dimensions: **RF · Audio · Battery · Check**. The set is per-deployment,
not hard-coded: an in-ears rig adds a cell, a wired-only rig drops RF and battery
to _not applicable_ rather than showing false greens.

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

An alert nobody has acknowledged **veils the whole card**.

**A veil, not a replacement.** The tint covers the card, but the face, the number,
the meter, the name and the status strip all still read underneath — that is what
an operator needs to start troubleshooting. The mark is pinned to the
photograph's box rather than centred on the card, where it would be written
across the performer's name.

**It names the problem and nothing else.** One icon, two words — _Low RF_, _No
audio_, _Low battery_ — and `Press to acknowledge`. No explanation, no timestamp,
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
│ −30:00            −20:00      10m[30m]60m     ┃  −10:00      Live    │
├──────────────────────────────────────────────────────────────────────┤
│ −10:51 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●─────┃──────────  Back to live │
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
left is replay, the bar tints `--purple`, and the right time code becomes **Back
to live** — one press, from anywhere. Event marks sit on the rail at the time
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
grid stay sparse, and it is the surface that makes [§1.5](#15-two-product-decisions-this-rests-on)'s
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
for _display_, not only for control.

### 10.6 Report sheet

The A1's whole job, in one thumb. Specified with its surface in
[§11.2](#112-a1-mix-confidence).

### 10.7 Reported state

A channel with an unclaimed fault report **pulses its outline**, on the A1 grid
and on the A2 grid, and shows a `Reported` badge with a count when more than one
issue went. It stops on claim, when the card reads `Being worked` with the
claimant.

This is the only ambient motion in the product and it earns the exception: it
marks work that has been handed over and not yet picked up, which is precisely
the state nobody should be able to sit in unnoticed. `prefers-reduced-motion`
removes the motion; the amber outline stays.

### 10.8 Smaller parts

- **Badges** — pill, 700 weight, 11px, soft-tinted, with a dot.
- **Buttons** — `--red` primary is reserved for the one live or destructive
  action in view; see [§5](#5-shape-and-elevation) for shape and press behaviour.
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
- **Operator notes** — italic body type on a `--warn` left rule
  ([§4.3](#43-machine-and-human-type)). Anything a person wrote reads like a
  sentence; anything a machine measured is mono.

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

Default is **all channels** ([§1.5](#15-two-product-decisions-this-rests-on)).
Sources with a critical exception pin to the top of the grid regardless of
filter, and also appear in the exceptions sheet: the sheet is show-wide truth,
the grid is current-context truth, and a critical fault belongs in both.

Press a card to listen. Source switching changes an established server-side bus
and never renegotiates media, so the interface must not show a connecting state
on a source change — a tap that appeared to reconnect would teach operators to
distrust the tap.

Emergency remap and swap are initiated from the detail, never from the card,
because they must never be one gesture away from a listen. The transaction shows
the replacement, the complete identity and external-action diff, a _physical
change in progress_ state, RF and audio verification, the A1 confirmation
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
   and one question: _What are you hearing?_
2. **Press what is wrong — as many as apply.** Eight faults in the A1's own
   words (dropping out, crackling, distorted, too quiet, clothing noise, popping,
   hum or buzz, nothing at all) plus _something else, dictate a note_. Each a
   72px target with a tick when selected. Multi-select because faults arrive
   together: clothing noise _and_ crackling is a different diagnosis from either
   alone, and forcing one choice throws away what tells an A2 where to start.
3. **Press Send.** The button counts what is going — _Send 2 issues_. The sheet
   then shows everything that went, who has it, and an **Undo** live for a few
   seconds, with _Mark urgent — it is on air now_ as a follow-up rather than a
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
- **Back to live** is one press, always visible, never behind a confirm.
- Current critical alerts stay visible in a pinned live strip in their live
  colours, explicitly labelled `Live` — the one place the two time bases appear
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
explicit words — _observed_, _likely_, _unconfirmed_ — not a slider.

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
  backend is the _lifecycle_ around it — claiming, assignment, ownership and
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

**2.1.1 — 2026-09-22.** Space Grotesk and Fredoka are retired. Both had
become the default look of an AI-generated mockup rather than a considered
choice for this product — real fonts, just badly overused ones. Replaced
with IBM Plex Sans across display, body and the wordmark
([§4](#4-typography)), pairing with the IBM Plex Mono already in use rather
than adding a third family. The wordmark no longer gets its own typeface; it
is Plex Sans 700 at tight tracking, distinguished by weight and size, not by
switching fonts. Implemented in `tokens.css` and both apps alongside this
entry.

**2.1.0 — 2026-09-22.** Light mode is gone. Pulse was dark-by-default with
Paper as an opt-in alternate ([§1.2](#12-dark-only), [§3.1](#31-surfaces));
now there is exactly one theme. Removed: the Paper token block, the
`prefers-color-scheme`/`data-theme` resolution logic, the in-app theme picker,
and the `pulse-theme` persisted setting. The accent-roles and domain-mapping
tables ([§3.3](#33-accent-roles), [§3.4](#34-domain-mapping)) drop their Paper
column — every value in this document is now simply the value, not "the dark
one of a pair." This is implemented in `tokens.css` and both apps, not just
documented here.

**2.0.0 — 2026-09-22.** Pulse becomes a standalone design language: this
document no longer inherits from or documents deviations against RVLT's
design language. Everything visual changed —

- **Colour.** Dark is now the default surface, Paper the opt-in alternate
  (previously the reverse). New hex values throughout, pulled from and now
  feeding back into the app's shipped tokens. Signal green becomes the
  brand's own accent, explicitly identical to the "verified, healthy"
  semantic ([§2.9](#2-principles), [§3.3](#33-accent-roles)).
- **Typography.** Archivo, Hanken Grotesk and Baloo 2 are replaced by Space
  Grotesk (display and body) and Fredoka (wordmark only); JetBrains Mono is
  replaced by IBM Plex Mono. Kalam and the dedicated handwriting treatment are
  retired — the machine/human type distinction is now carried by italics on
  the existing body face ([§4.3](#43-machine-and-human-type)), not a second
  imported font.
- **Shape and elevation.** The printed, hard-outlined, hard-offset-shadow
  material language is retired in favour of soft neutral shadows, hairline
  borders, and a lighter-surface-plus-inset-highlight technique for depth on
  dark surfaces ([§5](#5-shape-and-elevation)). This was the biggest
  structural change in this version; it shipped in `tokens.css` and both
  apps' component CSS in a follow-up pass the same day.
- **Iconography.** The product gets its own brand mark (five-bar signal
  meter) distinct from the Lucide interface icon set it already used
  ([§7](#7-iconography)).

Everything not called out above — principles, the honesty grammar, component
behaviour, surfaces, touch/input and accessibility — is carried over
unchanged: none of that was RVLT's, and none of it needed to change.

**1.0.0 — 2026-09-19.** First consolidated document, built on the RVLT design
language. Superseded the separate principles, visual-language, touch-and-input,
components and per-surface files, which were removed; the rounds that were
rejected on the way there are recorded in [research notes](research-notes.md).
