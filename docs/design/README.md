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

Four rounds so far. The specs describe the current one.

- Round 1 was rejected as "futuristic AI slop" — glow, neon on blue-black.
- Round 2 removed the glow and warmed the neutrals, and was rejected as
  "cartoonish and far too info dense" — thick outlines, hard offset shadows,
  pills and plates everywhere, and a card carrying twelve things at once.
- Round 3 subtracted rather than re-tinted. Outlines became hairlines or
  nothing, shadows went, controls stopped being pills, and the card dropped from
  twelve elements to five. A category that is clear says nothing at all.
- Round 4, current, is structural rather than cosmetic, and came from three
  direct instructions: **headshots matter**, **a sidebar is not the vibe**, and
  **the bottom bar should rise into the monitoring view for the channel you
  tapped, with its timeline**. So: the card is now a photograph; the left filter
  rail became a horizontal band and the right exceptions rail became a sheet;
  and the side inspector is gone, replaced by a monitor bar that raises out of
  the bottom of the window carrying the selected source's identity, lanes and
  its own scrubable timeline.

The rejections are recorded in [research notes](research-notes.md), because they
are the most useful design findings in this directory.

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
prototype of all four surfaces at both reference viewports. Open it directly in
a browser; it has no build step and no dependencies beyond web fonts.

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
