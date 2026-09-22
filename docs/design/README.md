# Design

Two things live here, plus an archive.

- **[DESIGN.md](DESIGN.md)** — the design language, in one versioned document.
  Normative: where it and anything else disagree, this is the intent and the
  implementation is wrong.
- **[research-notes.md](research-notes.md)** — why. Sources, what is taken from
  WaveTool and what is deliberately changed, the five visual rounds that were
  rejected and what each one taught, and the open questions that need an operator
  in a room rather than more desk work. Predates DESIGN.md 2.0.0 and describes
  the earlier, RVLT-inherited system — read it as history.
- **[archive/](archive/)** — the pre-2.0.0 reference build and its rendered
  mockups. Superseded and not maintained; see
  [archive/README.md](archive/README.md) for why. The current visual
  reference is DESIGN.md plus the shipped Live and Manager apps themselves.

Two product decisions the design rests on are recorded as
[ADR 0019](../decisions/0019-cue-optional-and-show-time-scope.md): Live defaults
to every channel with cue tracking optional and silence alerting per channel, and
the product owns show time.

Nothing here has been in front of an A2, an A1 or a real rack.
