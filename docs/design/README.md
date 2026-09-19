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

The prototype is ahead of the written specs. It is on its third visual round;
the specs still describe the second.

- Round 1 was rejected as "futuristic AI slop" — glow, neon on blue-black.
- Round 2 removed the glow and warmed the neutrals, and was rejected as
  "cartoonish and far too info dense" — thick outlines, hard offset shadows,
  pills and plates everywhere, and a card carrying twelve things at once.
- Round 3, in the prototype now, subtracts rather than re-tints. Outlines become
  hairlines or nothing, shadows are gone, controls stop being pills, and the
  card carries five things: who, where, what it sounds like, the one thing that
  needs you, and whether anyone has it. A category that is clear says nothing at
  all. Everything else moved to the inspector.

The specs below are updated once the third round is confirmed, so they are not
rewritten a fourth time. Where a spec and the prototype disagree today, the
prototype is the current intent. The rejections themselves are recorded in
[research notes](research-notes.md), because they are the most useful design
findings in this directory.

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
