# Design

Three things live here.

- **[DESIGN.md](DESIGN.md)** — the design language, in one versioned document.
  Normative: where it and anything else disagree, this is the intent and the
  implementation is wrong.
- **[research-notes.md](research-notes.md)** — why. Sources, what is taken from
  WaveTool and what is deliberately changed, the five visual rounds that were
  rejected and what each one taught, and the open questions that need an operator
  in a room rather than more desk work.
- **[mockups/](mockups/)** — rendered pictures of the reference build, one per
  state worth having a picture of, regenerated with
  `node scripts/render-mockups.mjs`.
- **[prototype/index.html](prototype/index.html)** — the reference build. Open it
  directly in a browser; no build step, no dependencies beyond web fonts. It
  opens fit to the window, with fixed desktop and iPad viewports for checking
  layout, and a Paper/dark toggle that follows the operating system on first load.
  Its data is fabricated and it makes no latency, receiver or performance claim.

Two product decisions the design rests on are recorded as
[ADR 0019](../decisions/0019-cue-optional-and-show-time-scope.md): Live defaults
to every channel with cue tracking optional and silence alerting per channel, and
the product owns show time.

Nothing here has been in front of an A2, an A1 or a real rack.
