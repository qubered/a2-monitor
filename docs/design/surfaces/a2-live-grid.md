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

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER  72px                                                   │
│ Winter Circus · Prev 3    CUE 41 "Ballroom"  next 42 in 1:20   │
│ Zone: SL wing · J. Marsh   ⌾3 unchecked ▲2 batt ■1 open  ●live │
├───────────────┬────────────────────────────────┬───────────────┤
│ FILTER RAIL   │ CHANNEL GRID                   │ EXCEPTIONS    │
│ 200px         │ scrolls                        │ 340px         │
│               │                                │ (edge-swipe   │
│ On stage  12  │  ┌─────┐ ┌─────┐ ┌─────┐       │  sheet on     │
│ Up next    6  │  │card │ │card │ │card │       │  iPad)        │
│ Quick chg  2  │  └─────┘ └─────┘ └─────┘       │               │
│ My track   9  │  ┌─────┐ ┌─────┐ ┌─────┐       │ ■ 27 RF loss  │
│ Warnings   4  │  │card │ │card │ │card │       │ ▲ 12 battery  │
│ Unchecked  3  │  └─────┘ └─────┘ └─────┘       │ ▲ node clock  │
│ All        64 │                                │               │
├───────────────┴────────────────────────────────┴───────────────┤
│ TRANSPORT RAIL  120px                                          │
│ ◉ ELEANOR · latched   ◀prev  ⊘clear   MUTE  DIM  −18  ▮▮▮▮▯    │
│ [1 PRINC][2 ENSMB][3 BAND][4 SWING][5 RADIO][6][7][8]   ⟲REPLAY│
└────────────────────────────────────────────────────────────────┘
```

Columns: 4 at 1180 iPad landscape, 5–7 at desktop, 1 at iPad portrait. Card size
never changes with viewport; only the count does.

## Default state

On entering during an active performance the grid shows **On stage + Up next**,
ordered by intervention deadline, then cue relevance, then channel number. Not
by receiver number — the A2 thinks in people and deadlines.

Sources with a critical exception are pinned to the top of the grid regardless
of filter, with a 2px `--critical` outline, and they are *also* listed in the
exceptions rail. Duplication is deliberate: the rail is the show-wide truth, the
grid is the current-context truth, and a critical fault belongs in both.

## Filters

Filter chips are 44px targets with live counts. Filters compose; the active set
is shown as removable chips above the grid. A saved filter set is a named chip.

Filter by: on stage · up next · quick change · my track · dressing track · stage
or RF zone · assigned operator · rack · warning · unchecked · spare status.
Search matches character, performer, channel, receiver, pack asset and note text.

## Interaction

- **Tap card** — switch listening to that source. The marked edge moves.
- **Long-press card (400ms)** — latch. Filling ring at the touch point.
- **Swipe left on card** — open inspector.
- **Swipe right on card** — claim, or open the task sheet if already claimed.
- **Pinch** — cycle compact / standard / expanded.
- **Two-finger tap anywhere** — drop a replay marker at now.
- **Edge-swipe from right** — exceptions rail.
- **Long-press group button** — latch that group's mix.
- **Long-press clear (1500ms)** — clear all listening, with a filling ring.

Source switching changes the established server-side bus and never renegotiates
media, so the interface must not show a connecting state on a source change
([operator workflows](../../product/operator-workflows.md)). A tap that appears
to reconnect would teach operators to distrust the tap.

## The inspector

Opens over the rail at desktop, full sheet on iPad. Its content and action row
are specified in [components](../components.md). Two behaviours are specific to
this surface:

- The inspector never covers the transport rail. Mute, dim and level stay
  reachable while investigating.
- Opening the inspector does not change what you are listening to. Investigation
  and audition are separate actions, because an A2 often inspects one source
  while listening to another.

## Emergency remap and swap

Initiated from the inspector's action row, never from the card, because it must
never be one gesture away from a listen. The transaction shows: the replacement
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
- Every action on this surface is reachable with one thumb at iPad landscape.
- With all semantic colour removed, every state is still identifiable.
