# Touch and input

**Status:** Proposed

Read this before designing any control. Touch is the primary input for the Live
surfaces, not a responsive afterthought. The A2 is holding the device in one
hand, in the dark, possibly wearing gloves, with a spare pack in the other hand.

## The contract

1. **Every control is operable by touch with no pointer, no hover and no
   keyboard.** Hover may add convenience on a pointer device. It may never be
   the only route to information or action.
2. **No control is smaller than 44×44 CSS px.** Primary live actions — listen,
   mute, dim, claim, pass/fail — are **56×56 minimum**. The mic-check verdict
   controls are 72px tall.
3. **Spacing between adjacent targets is at least 8px**, and at least 12px where
   a mis-tap has an operational cost (anything that changes audio or identity).
4. **Input text is 16px minimum** so iOS does not zoom on focus.
5. **Nothing depends on a precise drag.** Scrub handles are 56px wide with a
   44px-tall hit area extending past the visible track. Anything draggable is
   also settable by a tap on the track and by stepper buttons.
6. **No right-click, no double-click, no modifier-only action.** Where WaveTool
   uses Shift+click to reset one channel's alert, we use a long-press with an
   explicit confirming affordance.
7. **Destructive or audio-changing actions need a deliberate gesture**, not a
   larger tap target. Long-press with visible progress, or a two-step confirm
   on a full-width control — never a small button placed far away.

## Gesture vocabulary

One gesture set across every surface. It is short on purpose; an operator learns
it once during a technical rehearsal.

| Gesture | Meaning | Applies to |
| --- | --- | --- |
| Tap | Momentary listen — hear it while held on a group button, switch to it on a card | Channel card, group button |
| Long-press (400ms) | Latch — stay on this source until cleared | Channel card, group button |
| Long-press (1500ms) | Global clear, with a filling ring showing progress | Solo clear, alert reset |
| Swipe left on card | Raise the monitor bar for that channel | Channel card |
| Swipe right on card | Claim / open the task sheet | Channel card |
| Swipe down on sheet | Dismiss sheet, or lower the monitor panel | Monitor bar, sheet |
| Two-finger tap | Mark the current moment for replay, from anywhere | Whole surface |
| Pinch on grid | Change zoom level: compact / standard / expanded | Channel grid |
| Edge swipe from right | Open the exceptions sheet | A1 and A2 Live |

Every gesture has a visible equivalent control. The gesture is the shortcut, not
the mechanism. A new operator who knows no gestures can run the show.

## Press feedback

Touch has no cursor, so feedback must be immediate and physical.

- The control travels `+2px, +2px` and its hard shadow collapses to `--sh-press`
  within 80ms of `pointerdown`. This happens before any network round trip.
- Latching adds the lit edge and holds it. Latched state is visible from across
  a wing.
- A long-press draws a filling ring or bar in `--listening` at the touch point.
  If the operator lifts early, the fill reverses and nothing happens.
- Where the device supports it, `navigator.vibrate` fires a 10ms tick on latch
  and a 30ms tick on a destructive confirm. Haptics are an enhancement; the
  visual is the contract.

## Thumb zones

At iPad landscape (1180×820 reference) the device is most often held two-handed
by the outer edges, or one-handed by the left edge while the right hand works.

- **Bottom, always** — the monitor bar. Collapsed it is the transport row:
  listen state, mute, dim, level, group buttons, replay. Raised it is the
  selected source in full. Everything used more than once a minute lives here,
  because this is where the thumb already is.
- **Right edge** — an edge swipe opens the show-wide exceptions sheet. There is
  no standing right rail.
- **Below the header** — the filter band, scrolling horizontally. Reached by
  stretching, not by the resting thumb, which suits a control used in bursts.
- **Top 72px** — status, identity and context. Read constantly, touched rarely.
- **Centre** — the grid of faces. Scrolls behind the monitor bar.

At iPad portrait everything stays where it is; the grid narrows to three or four
columns and the monitor panel gets taller.

At desktop the layout is the same. We do not relocate controls between
viewports; we only change how many columns the content has. An operator who
learns the iPad layout knows the desktop layout.

## One-handed mode

Guided mic check has an explicit one-handed mode: all verdict controls move to
one half of the screen, selectable left or right, at 72px tall and full
half-width. The performer context sits in the other half and is not interactive.
This is the only surface where layout changes handedness, because it is the only
surface an operator runs while physically working on a person.

## Gloves, dark, and wet hands

- Targets are sized for a gloved fingertip, not a stylus.
- No target relies on the fingertip's exact centre; hit areas are rectangular
  and extend past the visible control where space allows.
- A screen-brightness-independent design: the interface is legible at 20%
  brightness. This is why `--rule` is a solid 2px at `#344047` rather than a
  faint hairline, and why status is carried by glyph and shape.
- Accidental-touch rejection: the transport rail ignores touches that begin
  within 8px of the screen edge and travel less than 4px, which is the signature
  of a palm resting on the bezel.

## Keyboard and pointer

Desktop is a first-class secondary. Everything reachable by touch is reachable
by keyboard.

- Arrow keys move channel focus, following WaveTool's convention.
- `Space` momentary-listens the focused channel; `Enter` latches it.
- `Esc` clears listen. Holding `Esc` for 1.5s is the global solo clear.
- `1`–`8` press-to-listen the corresponding group.
- `M` mute, `D` dim, `R` return to live, `/` search.
- Focus rings are 2px `--listening` offset 2px, and are never suppressed.

## Accessibility

- All interactive elements are real buttons with accessible names.
- Live regions announce state changes that an operator must know about — a
  critical fault appearing, listen latching, replay entering or leaving — and
  nothing else. A meter does not announce.
- The whole product is operable with every semantic colour removed.
- Target sizes above already exceed WCAG 2.2 AA (24px) and meet AAA (44px).
