# Surface: Guided mic check

**Status:** Proposed

The only surface designed to be operated while physically working on another
human being. Its ergonomics override everything else in the language.

## What it is for

Working a track or zone in a fixed call-and-response order, recording an
independent verdict per dimension, and never producing one ambiguous tick that
hides which half of the job was actually done.

## The hard constraint

The operator has one hand. The other hand is holding a transmitter, a belt, a
wig cap, or the performer's costume. They are often kneeling. The performer is
talking to them.

Therefore: **one screen, one person, one decision at a time, verdict controls
72px tall in a reachable half of the screen, and no scrolling to complete a
check.**

## Layout — one-handed mode, right-handed

```
┌────────────────────────────────────────────────────────────────┐
│ ⌾ MIC CHECK · SL wing track      7 of 22       ⏸ pause  ✕ exit │
├─────────────────────────────┬──────────────────────────────────┤
│ CONTEXT (not interactive)   │ VERDICTS (thumb half)            │
│                             │                                  │
│  ┌────────┐                 │  1 IDENTITY / LABEL              │
│  │ face   │  ELEANOR VANCE  │  ┌────────┬────────┬──────────┐  │
│  │  96px  │  Marguerite     │  │  PASS  │  FAIL  │ RECHECK  │  │
│  └────────┘  Hale           │  └────────┴────────┴──────────┘  │
│                             │         72px tall                │
│  RX 4 · B · IN 27           │                                  │
│  Pack A2-114 · TL45 beige   │  2 RF / LINK IN ZONE      ✓ pass │
│                             │  3 CAPTURED AUDIO HEARD   · next │
│  ┌──────────────────────┐   │  4 TX MUTE / CONTROL      · —    │
│  │ placement image      │   │  5 SPARE PACK CHECKED     · —    │
│  └──────────────────────┘   │  6 BATTERY FOR SHOW       · —    │
│                             │  7 PLACEMENT / COSTUME    · —    │
│  "tape lifting again,       │  8 OPERATOR SIGN-OFF      · —    │
│   3rd time this week"       │                                  │
│   — J. Marsh, Tue      ✎    │  ┌────────────────────────────┐  │
│                             │  │  ◉  LISTEN  (hold)         │  │
│  ⚠ quick change at cue 52   │  └────────────────────────────┘  │
├─────────────────────────────┴──────────────────────────────────┤
│  ◀ PREVIOUS        ⏭ SKIP — absent / costumed / blocked        │
└────────────────────────────────────────────────────────────────┘
```

Handedness is a setting and mirrors the two halves. This is the only surface
where layout changes handedness.

## The eight dimensions

Explicit check states, never one checkbox
([operator workflows](../../product/operator-workflows.md)): physical identity
and label · RF and link in the relevant zone · captured audio heard ·
transmitter mute and control state · primary and spare pack · battery approved
for the required show window · placement and costume note acknowledged ·
operator sign-off with timestamp.

Each records **who** verified it and **when**. Physical fit is assigned to the
A2; captured-audio-heard is assigned to the A1 unless production policy says
otherwise, and the interface shows whose verdict is outstanding rather than
letting one person tick both.

## Order, resumability and exceptions

- Work is ordered by A2 track or zone, not by channel number.
- Progress — `7 of 22` — persists. The check is resumable across a break, a
  reload, a device change and a backend restart.
- **Absent, already-costumed and blocked performers stay visible as explicit
  exceptions.** Skip requires choosing which, and that reason is recorded. They
  are listed in an exceptions lane at the end, not silently dropped.
- A swap invalidates only the checks whose subject changed. The affected badges
  become "invalidated by swap at 19:42" with a slash, not empty. Valid work is
  never erased.

## Interaction

- Verdict buttons are 72px tall, full half-width, with 12px separation. A verdict
  advances to the next dimension after a 300ms confirmation hold of the pressed
  state, which is long enough to see and short enough not to wait for.
- **Listen is hold-to-hear**, a 72px control, so audio cannot be left open while
  the operator walks away.
- Fail opens a one-tap reason list — the common causes, not a text field.
  Dictation is available; typing is never required.
- `⏭ Skip` requires a reason. `◀ Previous` is always available and never
  destroys a recorded verdict.
- Two-finger tap drops a replay marker, same as everywhere.

## Voice

This is the one Live-adjacent surface where warmth is allowed in copy, because
the operator is standing with a person and the screen should not be colder than
the room. It stays short: "Ready for Eleanor." "Seven done, fifteen to go."
Never a joke, never an exclamation mark, never a congratulation.

On completion: Ghost, burning, and the count. Not a celebration.

## Acceptance

- A full track can be checked without the second hand and without scrolling.
- No dimension can be marked by someone the policy did not assign it to.
- A swap mid-check invalidates exactly the affected dimensions and no others.
- An absent performer is still visible at the end of the check.
