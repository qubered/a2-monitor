# Surface: A1 mix confidence

**Status:** Proposed

The same design language, a different job, and — importantly — a different
primary action.

## The A1 does not listen here

This is the decision that shapes the whole surface. An A1 is mixing. They hear
the show on the console, through PFL and the monitor path they already trust,
and they are not going to audition a source on a tablet mid-number. The product
has nothing to add to how an A1 hears.

What it does have to add is **the two seconds between noticing something and
backstage knowing about it.** Today that is a verbal call over comms, with an
identity translation at both ends: "the tall one in the blue coat, I think it's
27?" This surface removes that.

So the A1 view carries no listen control, no transport, no player and no output
level. Pressing a channel reports a fault.

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER   The Winter Circus · A1        node 64ch  clock locked │
│                                        1 critical · 2 requests │
├────────────────────────────────────────────────────────────────┤
│ SHOWING [All channels 64][Needs someone 4][Being worked 2]…    │
├────────────────────────────────────────────────────────────────┤
│ ■ CRITICAL  27 · Eleanor Vance                        [Follow] │
│   RF quality collapsed. J. Marsh is on it — 0:40 so far.       │
├────────────────────────────────────────────────────────────────┤
│ All channels · press a card to report a fault                  │
│ ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐   │
│ │ face ⤢ ││ face ⤢ ││ face ⤢ ││ face ⤢ ││ face ⤢ ││ face ⤢ │   │
│ │ Name   ││ Name   ││ Name   ││ Name   ││ Name   ││ Name   │   │
│ │ ✓✓✓⚠   ││ ✓✓⚠✓   ││ ✓✓✓✓   ││ ✓–✓✓   ││ ✓✓✓✕   ││ –✓–✓   │   │
│ │PRESS TO││PRESS TO││PRESS TO││PRESS TO││PRESS TO││PRESS TO│   │
│ │ REPORT ││ REPORT ││ REPORT ││ REPORT ││ REPORT ││ REPORT │   │
│ └────────┘└────────┘└────────┘└────────┘└────────┘└────────┘   │
├────────────────────────────────────────────────────────────────┤
│ YOUR OPEN REPORTS                                    [See all] │
│ ● 27 ELEANOR · J. MARSH IS ON IT   ● 33 INES · A. DUNNE CLAIMED│
└────────────────────────────────────────────────────────────────┘
```

The card is the same object as on the A2 grid — photograph, name, status strip —
with two changes: it carries a standing `PRESS TO REPORT A FAULT` instruction,
because pressing it does something different here, and it shows **REPORTED** or
**BEING WORKED** on the photograph when it has been.

The bottom bar is not a player. It is the A1's open reports and who has them, so
the answer to "did anyone pick that up" is always on screen.

## The report flow

Two presses, both large, neither requiring the A1 to look away from the desk for
more than a moment.

**Press the channel.** A sheet rises from the bottom with the performer, the
console number, and one question: *What are you hearing?*

**Press what is wrong.** Eight faults in the A1's own words — dropping out,
crackling, distorted, too quiet, clothing noise, popping, hum or buzz, nothing at
all — each a 72px target with a one-line gloss beneath. There is also *Something
else — dictate a note*.

**That press is the send.** There is no confirm step. Mid-show a confirmation is
a step too many, and a mis-sent report is cheap: the sheet then shows **Sent to
backstage**, who has it, and an **Undo** that stays live for a few seconds.
Alongside it, two follow-ups the A1 can add without having needed them first:
*Mark urgent — it is on air now*, and *Done*.

The report arrives backstage carrying the channel, the performer, the fault in
plain words, the time, and who sent it. No identity translation, no readback.

## What the A1 gets back

- The card shows **REPORTED** until someone claims it, then **BEING WORKED** with
  the claimant.
- Critical exceptions across the whole show sit in one banner at the top,
  including sources not currently on stage.
- The open-reports bar names who has what.
- Nothing ever steals focus. No modal opens over the grid unprompted, no sound
  plays, and no notification interrupts a cue.

## What this surface deliberately does not have

Mic-kit inventory, placement galleries, battery cycle counts, antenna detail,
swap preparation, receiver configuration, or a listen control. The expand button
opens the same channel detail the A2 sees, for the rare moment an A1 wants the
full picture — but it is one deliberate press away, not the default.

## Acceptance

- Noticing a problem to backstage knowing about it is two presses and no typing.
- An A2 can act on what arrives without a verbal identity translation.
- A report can be undone for a few seconds and marked urgent after the fact.
- Nothing on this surface can take focus during a cue.
- A critical exception on an offstage source is visible without leaving the view.
