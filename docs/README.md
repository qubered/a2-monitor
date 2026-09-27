# Documentation

There's no required reading list before you build something — see
[AGENTS.md](../AGENTS.md). What's left here is reference material for the
parts of the system that are actually running:

- [Development runbook](runbooks/development.md)
- [Protocol contracts](../packages/protocol/README.md)
- [Receiver integrations](../integrations)

`decisions`, `quality`, `architecture`, `product`, `research`, `api`,
`integrations`, and `design` under this directory are the old planning-ceremony
layer (ADRs, phase-evidence contracts, a speculative architecture spec, and a
1000+ line design-language doc for an app that didn't exist yet when it was
written). That process was dropped — see AGENTS.md and CONTRIBUTING.md — and
these directories are queued for deletion; treat anything in them as
historical, not authoritative, in the meantime.

## Keeping documentation healthy

- Only document things that exist and are running.
- Update a doc in the same PR as the behavior it describes, or don't write it.
- Prefer short, direct Markdown over a new spec document.
