# Surface: Replay and incident timeline

**Status:** Proposed

The most dangerous surface in the product: an operator hearing the past while a
show happens in the present. Every design decision here is about making that
impossible to confuse.

## The mode rule

Replay is a **mode**, not a panel. When it is active:

- The entire viewport gains a **4px `--replay-ink` border**. Unmissable from
  across a wing at any brightness because it is thick and it surrounds
  everything — not because it shines. Nothing in this product shines.
- Every meter, trace and value on every visible surface renders in
  `--replay-ink` instead of its live semantic colour. If it is violet, it
  already happened.
- A persistent bar states the offset and the epoch in mono:
  `REPLAY · −4m 12s · epoch 3 · 21:04:18`.
- **RETURN TO LIVE** is a 56px primary action, always visible, one touch, never
  behind a confirm.
- Current critical alerts stay visible in a pinned live strip at the top, in
  their live colours, explicitly labelled `LIVE`. The one place the two time
  bases appear together, and the only place, marked in both directions.

Audible distinction is a product requirement alongside the visual one
([operator workflows](../../product/operator-workflows.md)); the design here
assumes a short, quiet, non-programme confirmation on entering and leaving
replay, specified with the audio profile rather than here.

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ ⚠ LIVE  ■ 27 RF loss · J.Marsh investigating          [ GO ▶ ] │ ← live strip
├────────────────────────────────────────────────────────────────┤
│ ⟲ REPLAY · −4m 12s · epoch 3 · 21:04:18       [ RETURN TO LIVE ]│
├────────────────────────────────────────────────────────────────┤
│ SOURCE — same card grammar, violet                             │
│  ┌────────┐ ELEANOR VANCE / Marguerite Hale                    │
│  │ face   │ RX 4 · B · IN 27                                   │
│  └────────┘ AF ▁▂▅█▆▃▂▁▂▄▆█▇▄▂▁  −18.2 dBFS  ⟲                 │
├────────────────────────────────────────────────────────────────┤
│ TIMELINE — 30 min, lanes stacked, scrubbable                   │
│                                                                │
│  AUDIO   ▁▃▅█▇▅▃▂▁▁▁▂▄▆█▇▅▃▁▁▂▃▅▇█▆▄▂▁▁▁▂▃▄▅▆▇█▆▄▃▂▁          │
│  RF      ▅▅▅▅▅▄▄▃▂▁░░░░░▁▂▃▄▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅          │
│  QUALITY ▮▮▮▮▮▮▯▯▯▯▯▯▯▯▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮          │
│  CUE     │40      │41                    │42                   │
│  SWAP                    ◆ pack A2-114 → A2-119                │
│  EVENTS  ■ RF loss   ▲ quality drop    ✎ "hair noise?"         │
│                                                                │
│         ├──────────────────◆ 56px handle ─────────────────────┤│
│  −30m            −20m            −10m           −4m       now  │
├────────────────────────────────────────────────────────────────┤
│ TRANSPORT RAIL — MUTE DIM level, + ⏮ −10s  ▶  +10s ⏭  ⚑ MARK   │
└────────────────────────────────────────────────────────────────┘
```

## Timeline lanes

Lanes are stacked and independently readable — the point of a synchronised
replay is correlation, so the lanes must align to the same x-axis exactly.

- **Audio** — captured level over the window.
- **RF** — RSSI. Gaps in telemetry render as hatch, not as zero.
- **Quality** — link quality, **separate from RF level**, because interference
  degrades one without the other.
- **Cue** — cue boundaries with numbers and names. A period where cue authority
  was lost renders hatched and labelled `authority lost`, never interpolated.
- **Swap** — identity changes at their effective time, with the diff on tap.
- **Events** — system observations, operator reports, replay markers, ownership
  changes, selected messages. Markers written by a person render in the hand.

Lane heights: 44px each, so every lane is itself a touch target that selects the
event under the finger.

## Scrubbing, by touch

- The handle is 56px wide with a 44px-tall hit area extending above and below
  the track.
- Tapping anywhere on the track seeks there. Dragging is never required.
- `⏮ −10s` and `+10s ⏭` are 56px steppers. Most replay use is "just before that",
  and a stepper hits it faster than a drag.
- Pinch on the timeline changes the window: 30m / 10m / 2m.
- Seeks are cancellable; a new seek during a pending one supersedes it and the
  interface shows which target it is resolving to, not a spinner.
- Changing source preserves historical time where media exists. Where it does
  not, the card says so — *no media for this source at −4m 12s* — rather than
  jumping to live.

## Marking and export

- **Mark** is available from every surface by two-finger tap and from the rail
  as `⚑ MARK`. It creates an event at the current time with source, cue and
  person context already attached.
- A marker takes an optional note, dictated or typed, rendered in the hand.
- **Marking never exports audio.** Export is a separately permissioned action
  with its own explicit control, and the interface states what will leave the
  appliance before it does.

## Incident view

The same timeline, filtered to one incident, merging system observations,
operator reports, cue changes, assignment and swap events, replay markers,
ownership and selected messages — not the whole conversation.

Above it, the incident header carries: lifecycle state (`open`,
`investigating`, `mitigated`, `resolved`, `deferred`, `false-positive`),
coordinator, assignees, and operational impact. Seen receipts and claim are
shown as what they are — a receipt and an owner — and are visually separated
from lifecycle so neither can be mistaken for the other.

Resolution requires action, evidence and **confidence**, and the confidence
control is three explicit words — *observed*, *likely*, *unconfirmed* — not a
slider. Observed facts, derived warnings and suspected causes are rendered with
the three treatments defined in [principles](../principles.md) and never merged.

## Handoff

The handoff view is anchored to the last mutually accepted checkpoint and
summarises open work, changes since the watermark, quarantined assets, unread
pages and current health. Viewing it changes nothing — no checkpoint moves, no
ownership transfers, nothing is marked complete — and the interface says so
plainly at the top, because the worst possible outcome here is an operator
believing they handed over when they only looked.

Acceptance is a two-party action with a verbal-brief reminder, and late-arriving
offline events are called out separately after acceptance.

## Acceptance

- A person entering the room mid-show can tell within one second whether the
  screen is showing live or replay.
- Returning to live is one touch from anywhere.
- A live critical alert is visible while in replay, and is unambiguously labelled
  as live.
- Seeking to a precise moment requires no drag.
- Marking an event cannot export audio.
