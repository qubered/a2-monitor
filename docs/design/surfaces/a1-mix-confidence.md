# Surface: A1 mix-confidence view

**Status:** Proposed

The same design language, the same shared truth, a different job. The A1 is
mixing. This surface is designed to be *glanced at and left*, and its success
measure is how quickly it returns the operator to the console.

## What it is for

Confidence that backstage is investigating the right source, and a two-
interaction path from hearing a problem to handing it over with exact context.

It deliberately does not default to mic-kit inventory, placement galleries,
battery cycle counts, antenna detail, swap preparation or receiver configuration
([A1/A2 views](../../product/a1-a2-views-and-collaboration.md)).

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER  72px                                                   │
│ Winter Circus · Prev 3   CUE 41 "Ballroom"  next 42 in 1:20    │
│ node ✓ · device ✓ · clock ✓ · live ✓     ■1  ⌾2 requests  ✉3   │
├────────────────────────────────────────────┬───────────────────┤
│ SOURCE TILES — on stage, then up next      │ CRITICAL          │
│ ordered by cue and mix relevance           │ EXCEPTIONS        │
│                                            │ show-wide, incl.  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐     │ offstage          │
│ │ tile     │ │ tile     │ │ tile     │     │                   │
│ └──────────┘ └──────────┘ └──────────┘     │ ■ 27 RF loss      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐     │   J.Marsh · 0:40  │
│ │ tile     │ │ tile     │ │ tile     │     │   investigating   │
│ └──────────┘ └──────────┘ └──────────┘     │                   │
│                                            │ ▲ node clock      │
│ ── UP NEXT ─────────────────────────────   │   affects 64 in   │
│ ┌──────────┐ ┌──────────┐                  │                   │
├────────────────────────────────────────────┴───────────────────┤
│ TRANSPORT RAIL  120px  — identical to A2                       │
│ ◉ ELEANOR   ◀prev ⊘clear  MUTE DIM −18 ▮▮▮▮▯   ⟲REPLAY         │
└────────────────────────────────────────────────────────────────┘
```

## The A1 tile — 240×132

Lower density than the A2 card, same grammar. Drops everything an A1 does not
act on.

- Headshot 48px, character name, performer name.
- Console/audio input label on the tape strip — the A1's identifier is the
  console channel, not the receiver slot.
- Audio lane only. Captured AF and peak, mute and silence state.
- RF and battery reduced to a **summarised risk chip** — `RF ok`, `RF watch`,
  `batt 0:41` — never the trace, never the antenna detail.
- Identity indicators: stale, unverified, changed since activation.
- Incident owner and progress, if one is open.
- Actions: listen, hold-to-listen, mark, replay.

The A1 can temporarily expand full RF and assignment detail on one tile without
the workspace becoming a rack view. Expansion is per-tile, per-session, and
collapses on cue change.

## The two-interaction path

This is the surface's reason to exist and it is measured.

1. **Tap the tile** — you are listening, and a marker exists at the current
   source, cue and time. "FOH heard" evidence is created by the act of
   listening, not by a separate button.
2. **Request check** or **Report fault** — 56px primary actions on the tile's
   expanded state and in the inspector. `Request check` opens a task.
   `Report fault` opens an incident and pages a coordinator by production
   policy.

Then the A1 is back on the console. Follow-up arrives as owner and state on the
tile — never as a modal, never as a sound, never as anything that steals focus.

## Attention policy, enforced by the design

- Critical system or source incidents may display a persistent banner. Nothing
  else may.
- Assigned tasks and priority pages are targeted badges in the header, not
  interruptions.
- Ordinary chat never opens over a meter and never takes focus.
- Notification sound is off by default, per-user, and routed only through the
  verified personal client audio graph.

## Acceptance

- Hearing a problem to handing it over is two interactions, with no typing
  required.
- An A2 can act on what the A1 sent without a verbal identity translation.
- A critical exception on an offstage source is visible without leaving the mix
  view.
- Nothing on this surface can steal focus from the console during a cue.
