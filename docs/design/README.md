# Show Slate — the A2 Monitor design language

**Status:** Proposed

This directory defines how A2 Monitor looks, feels and behaves. It is a design
language, not a component library: `packages/ui` implements it once real
workflows exist, and this directory is what that implementation is measured
against.

## Why "Show Slate"

The product lives backstage, in the dark, next to a rack. The nearest physical
object is not a dashboard — it is a slate: a dark panel that carries printed
labels, gaff tape, and things a human wrote on it in a hurry. That object is the
whole visual argument. Every ornament in this language traces back to something
real in a wing: tape, chalk, flight-case edges, label-maker strips, the ghost
light left burning on an empty stage.

Nothing here is decorative for its own sake. If a treatment cannot be traced to
a backstage object or a piece of operational meaning, it is deleted.

## Where this is up to

Five rounds. Rounds 1–4 were all rejected, and the useful part of this directory
is why.

1. **Rejected — "futuristic AI slop."** Glow, neon on blue-black.
2. **Rejected — "cartoonish and far too info dense."** Thick outlines, hard
   shadows, pills everywhere, a card carrying twelve things.
3. **Rejected.** Subtracted the chrome and the density; still not it.
4. **Rejected.** Photo-led cards, no sidebar, a monitor bar rising from the
   bottom. The structure was right; the whole register was still wrong.
5. **Current — a restart, not an iteration.** Built directly on the
   [RVLT design language](https://rvlt-labs.github.io/rvlt-designlanguage/) with
   its published tokens, on its light **Paper** surface. Big, obviously
   pressable channel cards: press one and you are listening to that channel.

The lesson, recorded plainly because it cost four rounds: the first four
attempted a *bespoke* language "inspired by" the references. The brief was to
use the existing one. Rounds 1–4 differ from each other in finish; round 5
differs in kind.

## Cue tracking is optional

A2 Monitor does **not** assume a cue list. The default view is every channel,
and cue-derived features — On Stage, Up Next, expected-silence arming, cue-aware
alert windows — are an opt-in layer that appears only when a cue source is
connected. Most productions will never have someone who meticulously tags every
stage movement, and a product that degrades without one is a product that fails
for most of its users.

This contradicts [operator workflows](../product/operator-workflows.md), which
currently says Live "defaults to exceptions and cue context, not an
undifferentiated 128-channel wall". That document has not been changed here,
because the change is a product decision rather than a design one and belongs in
its own pull request. **One of the two needs to move.**

## Scope note: one screen, and what that does not mean

A2 Monitor is intended as the single screen a show needs, replacing the reasons
an operator reaches for Wireless Workbench or Wireless Systems Manager during a
performance. The channel detail therefore carries the full picture: per-antenna
level and which one is carrying, squelch, frequency, group and channel, TX power
and lock, encryption, gain and trim, battery charge, temperature and cycles,
firmware and telemetry freshness.

That is **display**, not **management**. Frequency coordination, scanning,
deployment and firmware updates stay in the vendor tools.

[Product vision](../product/vision.md) currently lists "replacing the console,
Wireless Systems Manager, or Dante Controller" and "frequency coordination or
receiver firmware management" as explicit non-goals for version one. Read-only
display of everything a receiver reports is compatible with the second of those
and arguably not with the spirit of the first. **The vision's wording needs
revisiting**, and that is a product change rather than a design one, so it is
not made here.

## Read in this order

1. [Principles](principles.md) — what we optimise for, and what we refuse.
2. [Visual language](visual-language.md) — colour, type, space, shadow, motion.
3. [Touch and input](touch-and-input.md) — the touch-first contract. Read before
   designing any control.
4. [Components](components.md) — anatomy of the shared parts.
5. Surfaces:
   - [A2 Live channel grid and inspector](surfaces/a2-live-grid.md)
   - [A1 mix-confidence view](surfaces/a1-mix-confidence.md)
   - [Guided mic check](surfaces/guided-mic-check.md)
   - [Replay and incident timeline](surfaces/replay-and-incidents.md)
6. [Research notes](research-notes.md) — the sources behind the decisions.

## Prototype

[`prototype/index.html`](prototype/index.html) is a self-contained, clickable
prototype of all four surfaces. Open it directly in a browser; it has no build
step and no dependencies beyond web fonts.

It opens fit to the window, with fixed desktop, iPad landscape and iPad portrait
viewports available for checking layout, and a Paper/dark toggle that follows the
operating system on first load and remembers the choice after that.

It is a design artefact with fabricated data, not a product build. It makes no
claim about latency, receiver behaviour or anything else in
[open questions](../open-questions.md).

## Relationship to the plan

This language serves the workflows in
[operator workflows](../product/operator-workflows.md) and
[A1/A2 views and collaboration](../product/a1-a2-views-and-collaboration.md).
Where a design decision encodes a product rule — observed versus inferred,
distinct RF level and link quality, a second critical fault that must not hide
behind the first — the rule is cited at the point of use. Those citations are
the contract: a component that drops the rule is wrong even if it looks right.
