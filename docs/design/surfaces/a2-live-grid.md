# Surface: A2 Live channel grid and inspector

**Status:** Proposed

The A2's home screen during a performance. Serves the workspace defined in
[A1/A2 views and collaboration](../../product/a1-a2-views-and-collaboration.md).

## What it is for

Knowing, in one glance from across a wing, which of the people you are
responsible for needs you next — and getting from that glance to audio in one
tap and to a diagnosis in two.

It is explicitly *not* an undifferentiated 128-channel wall. It defaults to
exceptions and cue context and keeps the full grid one filter away
([operator workflows](../../product/operator-workflows.md)).

## Layout

No sidebar. A standing left rail spends permanent width on navigation that is
used in bursts, and a standing right rail spends it on a list that is empty most
of the night. Both become bands and sheets, and the width goes to faces.

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER  72px                                                   │
│ Winter Circus · Prev 3   CUE 41 Ballroom   NEXT 42 in 1:20     │
│ ZONE SL wing · J. Marsh              ◍3   ▲2   ■1   ✉4         │
├────────────────────────────────────────────────────────────────┤
│ FILTER BAND  60px — horizontal, scrolls, counts live           │
│ SHOWING [On stage 12][Up next 6][Quick change 2] │ [My track 9]│
├────────────────────────────────────────────────────────────────┤
│ CHANNEL GRID — full width, photographs                     ┃   │
│ ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌───────┐┃ E │
│ │ face   ││ face   ││ face   ││ face   ││ face   ││ face  │┃ X │
│ │▁▂▅█▆▃▂ ││▁▂▅█▆▃▂ ││▁▂▅█▆▃▂ ││▁▂▅█▆▃▂ ││▁▂▅█▆▃▂ ││▁▂▅█▆▃│┃ C │
│ │ Eleanor││ Dov    ││ Ines   ││ Tobias ││ Priya  ││ Marcus│┃ ← edge
│ │ ■ RF…  ││ ▲ batt ││        ││ silent ││ ▲ ident││ ? stale│┃  swipe
│ └────────┘└────────┘└────────┘└────────┘└────────┘└───────┘┃   │
├────────────────────────────────────────────────────────────────┤
│ MONITOR BAR — raised, 316px. The selected source in full.      │
│ [photo] Eleanor Vance │ Audio ▁▂▅█▆▃ │ ⟲ Replay from here      │
│         RX 4 · B      │ RF    ────╲_ │ ⚑ Mark this moment      │
│         pack A2-114   │ Qual  ▌▌▌▁▁▁ │ ◍ Run check             │
│         batt 2:14     │ Cue 41│■ ✎│42│ ✉ Message about this    │
│                       │ ├──────◆ now │ ⇄ Swap…                 │
│ ── transport ─────────────────────────────────────────────────  │
│ [photo] Eleanor ◀Prev ⊘Clear MUTE DIM −18 ▮▮▮▯ [groups] ⟲Replay │
└────────────────────────────────────────────────────────────────┘
```

Columns: 5–6 at iPad landscape, 7–8 at desktop, 3–4 at iPad portrait. Card size
never changes with viewport; only the count does.

Selecting a channel raises the monitor bar. The grid does not move, nothing
opens over it, and the faces stay visible — which matters, because an A2 often
inspects one source while watching the rest of the wing.

## Default state

On entering during an active performance the grid shows **On stage + Up next**,
ordered by intervention deadline, then cue relevance, then channel number. Not
by receiver number — the A2 thinks in people and deadlines.

Sources with a critical exception are pinned to the top of the grid regardless
of filter, with a 2px `--critical` outline, and they are *also* listed in the
exceptions rail. Duplication is deliberate: the rail is the show-wide truth, the
grid is the current-context truth, and a critical fault belongs in both.

## Filters

The filter band is a single horizontal row under the header, scrolling
left to right in the order you read. Chips are 44px targets with live counts.
Filters compose; the active set stays visibly pressed. A saved filter set is a
named chip.

Filter by: on stage · up next · quick change · my track · dressing track · stage
or RF zone · assigned operator · rack · warning · unchecked · spare status.
Search matches character, performer, channel, receiver, pack asset and note text.

## Interaction

- **Tap card** — switch listening to that source. The marked edge moves.
- **Long-press card (400ms)** — latch. Filling ring at the touch point.
- **Swipe left on card** — raise the monitor bar for that source.
- **Swipe right on card** — claim, or open the task sheet if already claimed.
- **Pinch** — cycle compact / standard / expanded.
- **Two-finger tap anywhere** — drop a replay marker at now.
- **Edge-swipe from right** — show-wide exceptions sheet.
- **Long-press group button** — latch that group's mix.
- **Long-press clear (1500ms)** — clear all listening, with a filling ring.

Source switching changes the established server-side bus and never renegotiates
media, so the interface must not show a connecting state on a source change
([operator workflows](../../product/operator-workflows.md)). A tap that appears
to reconnect would teach operators to distrust the tap.

## The monitor bar

Specified in [components](../components.md). Three behaviours are specific to
this surface:

- The transport row stays visible whether the panel is raised or lowered. Mute,
  dim and level are never covered by the thing you are investigating.
- Raising the panel does not change what you are listening to. Investigation and
  audition are separate actions.
- The grid does not reflow when the panel raises; it scrolls behind it. A card
  you were looking at is in the same place when the panel lowers.

## Emergency remap and swap

Initiated from the monitor bar's action column, never from the card, because it
must never be one gesture away from a listen. The transaction shows: the replacement
selection, the complete identity and external-action diff, a *physical change in
progress* state, RF and audio verification of the installed replacement, the A1
confirmation request, and the audited inverse. The old mapping stays
historically correct throughout.

A fully preverified spare gets the deliberate fast-promotion path as a single
56px primary action with a long-press confirm — fast, but never accidental.

## Degraded behaviour

- **Backend lost** — chat, tasks and ownership grey out with an explicit offline
  banner; listening, replay, cue movement, approved emergency swaps and check
  results continue against the leased node. Unsent drafts are visibly unsent.
- **Cue authority stale** — the header cue block strikes through, and every
  cue-derived state on every card becomes unknown rather than continuing.
- **Receiver telemetry stale** — per-lane hatch and age counter. Audio stays
  live; only the affected lanes degrade.
- **Show lock** — identity, binding, alert-policy and scene edits disappear
  rather than disabling, and the remaining whimsy layer switches off.

## Acceptance

- A critical fault on an offstage source is visible without changing filter.
- A second critical category cannot be hidden by the first.
- Nothing on the card requires hover to read.
- A source with no approved headshot reads as incomplete rather than as a
  neutral placeholder, because an unidentified performer is a real problem.
- Every action on this surface is reachable with one thumb at iPad landscape.
- With all semantic colour removed, every state is still identifiable.
