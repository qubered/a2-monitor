# Archived: pre-2.0.0 design reference

Everything in this folder — `prototype/index.html` and the `mockups/` it was
rendered from — predates
[DESIGN.md 2.0.0](../DESIGN.md#14-changelog) and is kept only as historical
record. It is not a current reference and nothing should be built to match
it.

Specifically, this prototype still has:

- RVLT-derived tokens and a "built on the RVLT design language" framing,
  which DESIGN.md dropped in 2.0.0 in favour of Pulse's own standalone
  system.
- Archivo, Baloo 2, Hanken Grotesk and Kalam, replaced in 2.1.1 by IBM Plex
  Sans and IBM Plex Mono.
- A Paper/dark theme toggle. Pulse is dark-mode only as of 2.1.0 — there is
  no light theme to toggle to.
- The old hard-outline, hard-offset-shadow "printed" card material, replaced
  in 2.0.0 by soft shadows and hairline borders.

None of that is being ported forward. Rebuilding this prototype against the
current tokens was considered and deliberately not done: the product now has
real, running Live and Manager apps, and screenshotting those is a more
honest visual reference than maintaining a second, hand-built mockup of the
same surfaces. `docs/design/DESIGN.md` plus the shipped apps are the current
design reference; nothing here is.

`scripts/render-mockups.mjs` still points at `prototype/index.html` in this
folder and still runs, for anyone who wants a picture of what the product
looked like before the rebrand. It is not run as part of any current
workflow.
