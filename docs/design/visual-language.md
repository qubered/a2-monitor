# Visual language

**Status:** Proposed

## Colour

### The governing idea: printed, not illuminated

Nothing in this interface emits light. Colour behaves like ink laid on a dark
painted surface — matte, absorbed, slightly dulled. There is no glow, no halo,
no bloom, no emissive fill anywhere in the product, including on the element the
operator is currently listening to.

This is the difference between an instrument that feels built and a dark
dashboard that feels generated. A saturated colour with a soft outer shadow on a
blue-black field reads as a heads-up display in a film. The same colour, matte,
on warm charcoal, with a hard edge and no shadow, reads as a painted flight case
in a wing. We want the second one.

### Foundation — warm charcoal

The neutrals are warm, not blue. Blue-black is the default of every dark mode in
every framework; it is also the single strongest "generated" signal in a dark
interface. Stage black is a painted, slightly warm black, and that is what the
canvas is.

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#121110` | Application background. Painted stage black. |
| `--panel` | `#1A1816` | Panels, rails, headers, sheets. |
| `--raised` | `#24211E` | Cards, inputs, controls sitting on a panel. |
| `--rule` | `#4A453E` | The drawn outline. Load-bearing, never a hairline. |
| `--ink` | `#F2EFE9` | Primary text and numerals. Warm off-white, not pure. |
| `--ink-2` | `#A8A29A` | Secondary text, units, labels. |
| `--shadow` | `#080706` | Hard offset shadow. Darker than canvas by design. |

`--rule` is the structural element of this language: 2px on small parts, **3px
on cards, panels and the window itself**. It replaces the shadow-and-blur
separation used by conventional dark dashboards. Surfaces are distinguished by
drawn outline and offset, not by luminance alone.

### Semantic — the hue, and the ink

Each semantic meaning has two values. The **hue** is used for text and glyphs,
where a saturated colour on a dark field is simply legible. The **ink** is a
matte, desaturated version of the same hue, and it is the only thing allowed to
be laid down as a mark: a rule, a bar, a trace, a filled control.

| Meaning | Hue (text, glyphs) | Ink (marks, rules, fills) | Glyph |
| --- | --- | --- | --- |
| Listening / selection | `--listening` `#56C7D9` | `--listening-ink` `#4E9DA9` | `◉` |
| Verified / healthy | `--verified` `#69C17D` | `--verified-ink` `#6A9C6E` | `✓` |
| Intervention | `--intervention` `#E3B55F` | `--intervention-ink` `#BE9A52` | `▲` |
| Critical | `--critical` `#F05D5E` | `--critical-ink` `#C2514F` | `■` |
| Replay | `--replay` `#B39DDB` | `--replay-ink` `#8F81AC` | `⟲` |
| Stale / unknown | `--stale` `#8B9499` | `--stale-ink` `#7E786F` | `?` + hatch |

Rules:

- A semantic colour is never used decoratively. Amber on a surface means an
  intervention exists; it is not an accent.
- `--critical` is the rarest colour in the product. If more than a few percent
  of a screen is vermilion, the screen has failed to prioritise.
- `--listening` marks exactly one thing at a time on a surface: what you are
  hearing. Selection and audition are the same idea here.
- A hue is never used as a fill at scale, and an ink is never given a shadow,
  blur or halo. A filled control uses the ink with near-black text on it, the way
  a colour is printed with knocked-out type.
- `--replay` is a mode colour. When replay is active it takes over the chrome
  edge of the entire window so the mode is unmissable
  ([operator workflows](../product/operator-workflows.md)).
- Every semantic colour is paired with its glyph and a word. See
  [principles](principles.md), rule 4.

### Group colours

Groups (drums, band, principals, ensemble, radio zone) get an eight-colour
categorical ramp used *only* as a name-plate background behind a channel's
label, following WaveTool's convention, which operators already read fluently.
Group colour is identity, never status, and never appears on a meter, a badge
or a border.

```
--g1 #56C7D9   --g2 #69C17D   --g3 #E3B55F   --g4 #B39DDB
--g5 #E08A5B   --g6 #7FA7D9   --g7 #C4A8E0   --g8 #8FBF9F
```

Group plates are set at 22% opacity behind mono text at full `--ink`, so the
plate reads as a colour without competing with a semantic state.

### Light theme

Dark is the reference. A light theme exists for Manager (show building happens
in offices and daylight) and must be authored as a genuine re-mapping, not an
inversion: `--canvas` becomes a warm paper, not white; `--rule` keeps the same
2px weight and the same visual heaviness; the semantic hues shift down in
lightness to hold contrast on light. Live surfaces default to dark regardless of
system preference and expose an explicit override.

### Texture

Every surface is printed on something. A tiled fractal-noise tooth sits over the
whole window at 4% opacity — not visible as a pattern, only as the absence of the
perfectly flat digital field. Cards and traces have a hard baseline rule where a
printed chart would have one.

There are no gradients in this product, anywhere, for any purpose.

### Contrast

All text meets WCAG 2.2 AA against its own surface. Numerals in meters and the
inspector meet AAA where achievable, because they are read at a glance in the
dark at low brightness. Semantic colours are verified against `--panel` and
`--raised`, not against `--canvas` only.

## Typography

Four families, four jobs. Each has one job and does not cross into another.

| Role | Family | Fallback | Job |
| --- | --- | --- | --- |
| Display | **Bricolage Grotesque** | `system-ui` | Surface titles, wordmark, big counts. Carries the voice. |
| Interface | **Instrument Sans** | `system-ui` | Labels, body, buttons, names. Quiet and warm. |
| Machine | **IBM Plex Mono** | `ui-monospace` | Anything a machine measured. Tabular figures always. |
| Hand | **Caveat** | `cursive` | Anything a person wrote. Never used for a measurement. |

Bricolage Grotesque is chosen for its slight width irregularity — it is
recognisably drawn rather than generated, which is the point. It appears at
large sizes only; below 20px it loses its character and gains nothing.

Caveat carries the human layer: operator notes, placement notes, replay marker
labels, quick-change annotations, the emergency change log. It is never used for
a value, a unit, a time, or anything a person must act on precisely. Rendered at
`--ink-2` unless the note is flagged.

### Scale

A 4px-based scale. Sizes are fixed, not fluid, because a meter readout that
changes size between viewports cannot be learned.

```
display-1  40/44  Bricolage 600      surface titles
display-2  28/32  Bricolage 600      section heads, big counts
ui-lg      18/24  Instrument 600     card primary (character name)
ui         15/22  Instrument 400/600 default interface text
ui-sm      13/18  Instrument 500     secondary labels
micro      11/14  Instrument 700     badges, all-caps labels, +0.06em tracking
mono-lg    22/24  Plex Mono 500      primary readouts (battery, level)
mono       13/18  Plex Mono 400      values, identity strings
mono-sm    11/14  Plex Mono 500      tape labels, channel numbers
hand       17/20  Caveat 500         operator notes
```

Minimum interface text size is 13px. Minimum input text size is 16px, to stop
iOS zooming on focus. No text below 11px exists in this product.

Figures are tabular everywhere. A level readout that shifts horizontally as it
changes is unreadable in motion.

## Space

A 4px base with an 8px rhythm. Card interiors use 12px; panels use 16px;
surfaces use 20px gutters at desktop and 16px at iPad.

```
--s1 4    --s2 8    --s3 12   --s4 16
--s5 20   --s6 24   --s7 32   --s8 48
```

## Shape

```
--r-sm  8px    inputs, badges, small controls
--r     12px   cards, panels
--r-lg  18px   sheets, modals, the inspector
--r-pill 999px  buttons, chips, filters
```

Pill buttons are the default for actions. Rectangular-with-radius is for
containers. This split is deliberate: if it is round on the ends, you can press
it.

## Elevation — the hard offset

There is no blurred shadow in this product.

```
--sh      3px 3px 0 var(--shadow)        raised card at rest
--sh-hover 5px 5px 0 var(--shadow)       card lifted (pointer only)
--sh-press 1px 1px 0 var(--shadow)       control pressed
--sh-flat  none                          flush elements, list rows
```

A raised element sits on `--raised` with a 2px `--rule` outline and `--sh`. On
hover (pointer devices only) it translates `-2px, -2px` and takes `--sh-hover`,
so the offset appears to grow while the element stays anchored. On press it
translates `+2px, +2px` and takes `--sh-press`. The result is a control that
visibly travels — the flight-case latch feeling — with no blur anywhere.

### Marked edge and dog-ear

There is no lit edge, because nothing in this product glows.

An element that is *live* — currently being listened to — gets a solid **7px top
bar** in `--listening-ink` sitting flush over its outline, and its outline takes
the same ink. It reads as a strip of coloured tape laid across the top of the
card. Matte, opaque, no shadow, no halo. Exactly one element per surface.

A **latched** source additionally gets a folded corner in the same ink — the way
you dog-ear the page you are working on.

Replay mode replaces the window's outer chrome with a **4px** `--replay-ink`
border applied to the whole viewport. It is unmissable because it is thick and
it surrounds everything, not because it shines.

## Texture

Two textures, both traceable to physical objects.

**Tape.** Printed identity — pack asset, receiver slot, input number — sits on a
tape strip: `--raised`, 2px rule, `--r-sm`, mono-sm, slightly rotated by
`-0.4deg` at rest. It is the label-maker strip on the front of a rack.

**Hatch.** Stale or unknown data is overlaid with a 45° 2px hatch at 8% `--stale`
over the affected region, plus an age counter. Hatching is the only fill
pattern in the product and it always means *do not trust this number*.

## Iconography

Lucide, 2px stroke, at 16 / 20 / 24px, matching the rule weight exactly so icons
read as part of the same drawn system. Semantic glyphs (`✓ ▲ ■ ◉ ⟲ ?`) are
drawn as icons, not typed as characters, so they hold weight at 11px.

No icon appears without a label on a first-use surface. Icon-only controls are
permitted only in the persistent toolbar, where they are learned within one
performance, and each carries an accessible name.

## Motion

| Token | Duration | Curve | Use |
| --- | --- | --- | --- |
| `--m-press` | 80ms | `cubic-bezier(.2,.8,.3,1)` | Control press/release |
| `--m-state` | 140ms | `cubic-bezier(.2,.8,.3,1)` | Badge, chip, selection change |
| `--m-panel` | 220ms | `cubic-bezier(.16,1,.3,1)` | Inspector, sheet, drawer |
| `--m-mode` | 320ms | `cubic-bezier(.16,1,.3,1)` | Entering or leaving replay |

Meters and traces are not animated. They redraw at their data rate. Applying a
transition to a live value makes it lie about when it changed.

`prefers-reduced-motion: reduce` removes all translation and reduces every
duration to 0ms; state changes remain visible through colour, glyph and outline,
which is why those carry the meaning in the first place.

## Data visualisation

The channel trace follows WaveTool's proven idea — a rolling window of recent
history drawn compactly, readable at a glance — with two changes.

1. **Audio and RF are separate lanes.** WaveTool overlays a green audio trace
   and an orange RF line on the same tile. We stack them as two short lanes so
   neither obscures the other, and so a lane can be independently hatched when
   its source goes stale.
2. **RF level and link quality are never merged.** Sennheiser distinguishes them
   because interference degrades quality without an equivalent fall in RSSI
   ([research](../research/wavetool-and-browser-audio.md)). The card shows the
   level trace and a separate discrete quality indicator. A single "RF health"
   bar is prohibited.

Trace rules: 10-second rolling window on the card, matching WaveTool's
convention; `--verified-ink` for present audio, `--ink-2` for expected silence,
`--stale` hatch when the feed is old. Traces are drawn in ink, on a baseline
rule, at the matte values above — never in the saturated hue, which on a dark
field is what makes a meter look like a neon sign. No axis, no gridlines, no legend on a
card — it is a shape, not a chart. The inspector carries the real chart with
axes and a legend.
