# Visual language

**Status:** Proposed

A2 Monitor is built on the **RVLT design language**, not on a parallel system
that resembles it. Tokens, type roles, shapes, shadows and component behaviour
come from `rvlt-designlanguage` DESIGN.md §15.1 / Appendix A (v1.1.0) as
published, and this document records only the domain mapping on top of it.

Where RVLT and this document disagree, RVLT wins and this document is wrong.

Source: [RVLT design language](https://rvlt-labs.github.io/rvlt-designlanguage/),
[component preview](https://rvlt-labs.github.io/rvlt-designlanguage/preview);
accessed 2026-09-19.

## Surface: Paper

RVLT ships a dark default and an opt-in light "Paper" theme. **A2 Monitor
defaults to Paper.** Dark remains available and is a straight theme switch, not
a separate design.

```
--paper #F4EEE1   --paper-2 #EDE4D2   --card #FFFDF8   --elev #FFFDF8
--ink   #1D1A15   --ink-2   #4B4539   --muted #7D7565  --faint #A89E89
--line  #E4DAC3   --line-2  #D8CCB0   --card-outline: var(--ink)
```

On Paper the card outline is `--ink` — a 2px near-black rule — and the shadow is
a hard `0 3px 0 var(--line-2)` with no blur, rising to `0 7px 0` on hover. That
outline-plus-offset is the whole material language: printed, tactile, pressable.

## Domain mapping

The audio domain does not get a new palette. It gets RVLT's existing roles.

| Meaning | RVLT role | Paper value |
| --- | --- | --- |
| Live — the channel you are listening to | `--red` | `#C12229` |
| Critical fault | `--t-out` on `--out-soft` | `#9C1B21` on `#FBE7E3` |
| Needs intervention | `--warn` on `--warn-soft` | `#C98A14` on `#FBF0D6` |
| Verified, healthy | `--ok` on `--ok-soft` | `#2EA65C` on `#E7F5EC` |
| Stale, unknown, expected-silent | `--rep` on `--rep-soft` | `#8A8270` on `#EFE9DC` |
| Replay | `--purple` on `--purple-soft` | `#7A5CD0` on `#ECE6FA` |

Red is reserved exactly as RVLT reserves it: active, live, and alerts. Here that
means **the channel you are hearing**, and nothing else. A card with a red
outline is the one in your ears.

Groups use RVLT's eight-colour avatar ramp (`--blue --green --amber --purple
--coral --teal --pink --lime`). Group colour is identity; it never carries a
state.

## Type

RVLT's four roles, unchanged.

| Role | Family | Job here |
| --- | --- | --- |
| Display | **Archivo** 700/800, `-.02em` | Names, headings, the big figure |
| Body | **Hanken Grotesk** 400–700 | Everything an operator reads as language |
| Mono | **JetBrains Mono**, tabular | Anything a machine measured |
| Hand | **Kalam** 700 | Anything a person wrote |

The mono/hand split is load-bearing and is the one place this product leans on a
type rule harder than RVLT needs to: an operator must be able to tell at a glance
whether `−18.2 dBFS` came from a meter or `tape lifting again` came from a
colleague.

## Shape and elevation

```
--r 14px   --r-lg 20px   pill 99px
--sh-card 0 3px 0 var(--line-2)     --sh-hover 0 7px 0 var(--line-2)
```

Buttons are pills that travel: `translateY(-1px)` on hover, `translateY(2px)`
with the shadow collapsing to `0 1px 0` on press. Cards lift 3px on hover and
press down 2px. Inputs are 44px tall, 16px text, 2px `--line-2`, red focus ring.
All of this is RVLT §15.2 verbatim.

## Data marks

Traces are a shape, not a chart: no axes, no gridlines, no legend, no tooltip,
drawn to the data rate and never transitioned. A ten-second rolling window sits
on the bottom edge of each card's photograph, over a `--scrim`, following
WaveTool's convention.

**RF level and link quality are always separate lanes.** Interference degrades
quality without an equivalent fall in RSSI
([research](../research/wavetool-and-browser-audio.md)), so a merged "RF health"
bar is prohibited.

## Photography

Channel cards are photo-led. The headshot frame is RVLT's `.photo` treatment — a
2px `--card-outline` rule, `--r` radius, hard offset shadow — at a 16:10 crop.
Real approved production headshots through Manager's managed image pipeline;
never illustrated avatars, never stock. A source with no headshot shows the empty
frame and reads as incomplete, because it is.

## What this product adds to RVLT

Only three things, and each earns its place:

1. **The mono/hand rule above**, stated as a hard rule rather than a stylistic
   preference.
2. **Observed / inferred / stale / unknown** rendered distinctly — solid for
   measured, dashed and prefixed *likely* for inferred, `--rep` with an age for
   stale, and never a zero or an empty bar for unknown.
3. **Never colour alone.** Every state carries a badge with a word in it, because
   the room is dark, the screen is dim, and some operators are colour-blind.
