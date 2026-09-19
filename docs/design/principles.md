# Design principles

**Status:** Proposed

## The operator we design for

An A2 in a wing, in the dark, half-dressed in blacks, one ear on comms, holding
an iPad in one hand and a spare pack in the other, with ninety seconds before
the number ends. They are not sitting down. They are not looking at the screen
continuously. They will glance for one second and need an answer.

Everything below follows from that person.

## 1. Glanceable before it is complete

A surface is designed for the one-second glance first and the two-minute
investigation second. The card answers *is anything wrong, and is it mine*. The
inspector answers *why*. If the card tries to answer both it fails at the first.

Density is earned, not assumed. WaveTool's grid is admirably complete and
genuinely hard to read at a glance; we deliberately trade some completeness for
legibility and push the remainder one tap away.

## 2. Honest about what is known

The product's credibility is the difference between a measurement and a guess.
The interface must never let them look alike.

- **Observed** — measured now. Solid fill, solid rule, mono numerals.
- **Inferred** — derived or suspected. Dashed rule, and the word *likely*.
- **Stale** — last known, age unknown or too old. Desaturated, hatched, with a
  visible age counter.
- **Unknown** — never rendered as zero, never as green, never as an empty bar.

Cue-derived state that has lost authority becomes unknown, not last-known
([operator workflows](../product/operator-workflows.md)). The interface shows
that it stopped knowing rather than quietly continuing.

## 3. Machine type and human type are different type

If a machine measured it, it is set in mono. If a person wrote it, it is set in
the hand. This is a hard rule and it is the single most legible thing in the
language: an operator can tell at a glance whether `-18 dBFS` came from a meter
or `tape lifting again, 3rd time` came from a colleague.

## 4. Colour is never the only signal

Every state carries a glyph and a word as well as a colour. The room is dark,
the screen is often at low brightness under blue worklight, and some operators
are colour-blind. Remove all colour from any screen and it must still be
operable.

## 5. One fault must never hide another

A card shows its strongest exception prominently *and* a badge count for every
other show-critical category — audio, RF, battery, identity, cue, client,
system. This is a product requirement
([A1/A2 views](../product/a1-a2-views-and-collaboration.md)), and it is the
reason the card has a badge rail rather than a single status colour.

## 6. Nothing decorative moves during a show

Motion is reserved for data and for direct response to a touch. No ambient
animation, no breathing gradients, no shimmer, no confetti. Whimsy lives at the
edges of the product and is switched off by show lock.

## 7. Safety is a control, not a setting

Listen starts muted. Mute and dim are always visible and always one touch away,
never inside a menu ([listening safety](../quality/listening-safety.md)). The
output level control shows its actual value, not a slider position.

## 8. The tool is advisory and says so

Alerts explain why they fired and what was missing. No confident diagnosis is
presented before the labelled evidence base exists. Language is "silence on
input 27, expected silent in this scene — unarmed", not "microphone failure".

## Whimsy policy

Personality is what makes an instrument feel made by people who have done the
job. It belongs in two places and nowhere else.

**Allowed — the edges.** Empty states, first-run and enrolment, loading and
reconnect, error and offline pages, the printable show pack, release notes,
settings, and the hand-lettered layer described above. These are the moments
when nothing is at stake and a human voice is welcome.

**Allowed — the chrome, everywhere.** The tactile materiality is not decoration;
it is the feel of the instrument. Thick drawn outlines, hard offset shadows with
no blur, controls that physically press down, printed tape and label strips,
stamped channel numbers, a faint tooth on every surface. Every surface gets this.
It is what stops the product reading as another dark SaaS dashboard.

The governing rule is **printed, not illuminated**: nothing in this product
emits light. No glow, no halo, no bloom, no gradient, no emissive fill — not even
on the source you are currently listening to. Colour is ink laid on painted
board. A saturated hue with a soft outer shadow on blue-black is a film prop; the
same hue matte, on warm charcoal, with a hard edge, is a flight case in a wing.

**Forbidden — live surfaces under performance conditions.** No mascot, no
illustration, no jokes, no exclamation marks on any surface showing a live
meter. Show lock removes the remaining edges.

### Ghost

The product's one illustrated character is a **ghost light** — the single bare
bulb left burning on an empty stage overnight, so the theatre is never fully
dark. It is the most human superstition in the business and it is exactly what a
monitoring tool does: it watches while nobody is there.

Ghost appears on empty states, the idle/standby screen, offline and error pages,
and the loading sequence. Four states: *burning* (idle), *watching* (working),
*squinting* (degraded), *out* (offline). Ghost never appears next to a meter and
never comments on a fault.

## Refusals — what this product will not look like

This list exists because the default output of any design process in 2026 is
the same dark dashboard, and that dashboard is indistinguishable from software
nobody chose to make.

- No gradients. Not in backgrounds, text, buttons, meters or charts. Anywhere.
- No glow, halo, bloom or coloured drop shadow. Nothing emits light.
- No blue-black canvas. The neutrals are warm, because blue-black is the default
  of every framework dark mode and reads as generated on sight.
- No saturated colour used as a large fill on a dark field. That is what makes a
  dark interface look like a heads-up display.
- No glassmorphism, no `backdrop-filter` blur, no frosted panels.
- No soft multi-layer drop shadows on cards. Our shadow is a hard offset with
  zero blur, or there is no shadow.
- No Inter. No generic geometric sans as the whole type system.
- No emoji used as a status icon, ever.
- No sparkle, wand, or brain iconography.
- No centred hero headline with a two-line subhead on an operational surface.
- No stock illustration of people. Headshots are the production's real cast, or
  a monogram — never an illustrated avatar.
- No pastel "friendly" palette laid over a safety-critical readout.
- No status expressed by colour alone.
- No animated skeleton shimmer. Loading states say what they are waiting for.
- No microcopy that performs enthusiasm. "Oops!", "Let's get started!",
  "You're all set!" and "Nice work!" are banned strings.
- No card that is a rounded rectangle with a subtle border and a number in it,
  unless that is genuinely all the information there is.

## Voice

Short. Specific. Present tense. Never enthusiastic, never apologetic, never
cute on a live surface.

- Good: "RF quality dropped on 27 at 21:04. Level is normal. Cause not observed."
- Bad: "Uh oh! We noticed something might be wrong with channel 27."
- Good: "Nothing to check yet. Activate a show to begin."
- Bad: "No data available."

Numbers carry units. Times carry a reference point. Uncertainty is stated in
words, not implied by a pale colour.
