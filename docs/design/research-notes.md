# Design research notes

**Status:** Research snapshot

**Last reviewed:** 2026-09-19

Sources behind the decisions in this directory. Web sources were accessed on
2026-09-19.

## Shure WAVETOOL 4 — the competitive baseline

Shure's own documentation describes the home screen in concrete terms.

Channel strip contents: channel name, channel image, a green waveform line
representing the last ten seconds of incoming audio level (levels below −48 dBFS
are not drawn), an antenna input indicator (A/B), and battery status in hours and
minutes for supported receivers.

Status encoding: green line for the audio waveform history; orange line for the
last ten seconds of received antenna signal strength; green frame for the active
channel; white frame for hard solo; a red overlay with an SCP symbol for a
channel problem requiring an alert reset; pink dashes for quality level on
supported receivers; and a coloured channel-name background indicating group
membership.

Toolbar: Select, Zoom, Select-and-Zoom, Panel views (A/B), Solo Clear (press for
1.5 seconds), Alert Reset, Chat, and group buttons 1–8 with press-to-listen.
Arrow keys navigate; Shift+left-click resets one channel's alert.

Product page claims: up to 192 wired and wireless channels in one system view, a
redesigned scalable interface with zoom/resize/prioritise, Global Instant Replay
rewinding all channels with up to 30 minutes of history, intelligent mic issue
detection that filters expected production sounds, up to eight concurrent users,
chat with images/reactions/voice notes, and pre-show session building with talent
photos, instrument images and channel notes.

Sources:

- [WAVETOOL home screen documentation](https://content-files.shure.com/Pubs/wavetool/en-US/home-screen.html)
- [Shure WAVETOOL 4 product page](https://www.shure.com/en-ASIA/products/software/wavetool4)

### What we take

- **Photo-forward tiles.** An A2 identifies people faster than numbers. Keep.
- **A ten-second rolling trace on the tile.** A shape, not a chart. Keep, and
  keep the ten-second window because it is a learned convention.
- **Group colour as a name-plate background.** Identity, not status. Keep
  exactly, including keeping it off borders and meters.
- **Press-to-listen group buttons 1–8.** Keep, enlarged to touch size.
- **Long-press for global clear.** Keep, with a visible filling ring.
- **Zoom levels for density.** Keep, on pinch as well as a control.

### What we change, and why

- **The trace sits on the face.** In the reference screenshot the waveform is
  drawn over the headshot, and the headshot is the fastest identifier on the
  tile. We move the trace to its own lane below the name.
- **Audio and RF share one overlay.** We stack them as two lanes so neither
  obscures the other and each can be hatched independently when its own source
  goes stale.
- **RF level and link quality risk being read as one thing.** Sennheiser
  distinguishes them because interference can reduce quality without an
  equivalent fall in RSSI
  ([research](../research/wavetool-and-browser-audio.md)). We show a level trace
  and a separate discrete quality indicator, and prohibit a merged health bar.
- **A red overlay covers the channel.** It obscures the face. We use a
  `--critical` outline, a badge and an exception sentence instead.
- **One visible problem per channel.** Our badge rail shows every show-critical
  category at fixed positions so a second independent fault cannot hide.
- **Saturated neon on black at high density.** Legible to a trained operator,
  punishing at a glance and in a dark wing. We trade some density for the
  one-second glance and push the remainder into the inspector.
- **Modifier-key actions.** Replaced with long-press, because touch is primary.

## RVLT design language — the reference for materiality

The user's existing design language for another product, cited as a style
reference rather than a template.

Recorded characteristics: a 2px outline with a hard offset shadow and no blur,
described as "tactile, like printed flight cases"; cards lifting on hover; a
"lit edge" top accent for live, real-time widgets; pill buttons that lift 1px on
hover and drop 2px on active; radii of 14px and 20px with 99px pills; inputs at
16px minimum text and 44px tall with a 2px rule; an 8-colour avatar palette;
"colour is the fun; never decorate the rows"; a single reserved accent for
active/live and alerts only; display, body, tabular-mono and handwriting type
roles; Lucide icons at 16/20/24px; and a mascot with idle/scanning/celebrating/
worried states.

Sources:

- [RVLT design language](https://rvlt-labs.github.io/rvlt-designlanguage/)
- [RVLT component preview](https://rvlt-labs.github.io/rvlt-designlanguage/preview)

### What we take, and how we diverge

Taken: the hard-offset materiality, the lit edge for live, pill buttons that
physically travel, the 44px/16px input floor, the four type roles, Lucide at
matching stroke weight, and the discipline that colour is meaning rather than
decoration.

Diverged: our foundation is the Show Slate dark palette rather than cream and
red; our radii are tighter (12/18) because our cards carry instrument data
rather than catalogue content; our accent is `--listening` cyan reserved for
audition rather than a red primary; our mascot is a ghost light rather than a
moving-head fixture, and it never celebrates; and our handwriting layer carries
a hard semantic rule — the hand means a human wrote it — rather than being a
decorative accent.

## PostHog — whimsy that survives being a serious tool

Recorded characteristics: an explicit "taste" principle — decisions that reflect
a real point of view, caring whether something is right rather than merely done;
clarity over cleverness; a deliberate rejection of the default dark-tech
aesthetic in favour of bordered cards on a warm cream canvas with a
textbook-illustration sensibility; a hedgehog mascot, Max, drawn in specific
scenarios; an olive/sage family for text and borders; and the position that
brand is the company experienced from the outside.

Source: [PostHog brand handbook](https://posthog.com/handbook/brand/foundations),
[visual identity](https://posthog.com/handbook/brand/visual-identity),
[logos and hedgehogs](https://posthog.com/handbook/brand/assets)

The lesson taken is not the cream canvas — we need dark for a wing. It is that
the whimsy is *consistent, drawn by hand, and confined*: a specific character in
specific situations, an opinionated palette, and documentation that states the
point of view rather than listing tokens. Our Ghost is that character, our
confinement rule is the whimsy policy in [principles](principles.md), and the
"refusals" list exists because a point of view is mostly a list of things you
will not do.

## Airbnb DLS — restraint and unification

Recorded characteristics: the principles Unified, Universal, Iconic and
Conversational, with "each piece is part of a greater whole"; Airbnb Cereal,
commissioned in 2018 from Dalton Maag, guided by the keywords human, friendly,
welcoming and creative professionalism; and a foundation of restraint — one
typeface, one accent, soft shapes, depth from photography and whitespace rather
than heavy shadows.

Sources: [Building a Visual Language](https://medium.com/airbnb-design/building-a-visual-language-behind-the-scenes-of-our-airbnb-design-system-224748775e4e),
[Working Type](https://medium.com/airbnb-design/working-type-81294544608b),
[Airbnb DLS](https://karrisaarinen.com/dls/)

Taken: one accent, depth from photography (our headshots) rather than layered
shadow, and the principle that a component must contribute positively to the
system at scale — which is why our card, tile, mic-check row and timeline lane
are one grammar rather than four designs.

Not taken: one typeface. We need four, because the distinction between a machine
measurement and a human note is the product's central honesty claim and type is
the cheapest, fastest way to carry it.

## Mobbin — the pattern survey, used as a warning

Searched for dark per-device status dashboards and for people-card grids on web.
Returned: Vapi, Railway, Supabase, Sentry, Cloudflare, Better Stack, StackAI and
LangChain for the first; Circle, Whop, Notion, Polywork, ClickUp and HelloFresh
for the second.

The dark-dashboard results are close to identical to one another: near-black
canvas, hairline 1px borders, a single accent, a large number above a sparkline,
generic sans throughout, no materiality, no voice. They are the thing the
refusals list in [principles](principles.md) exists to prevent. They were used
as a negative reference.

The people-card results were more useful, and confirmed two things: a photo plus
a name plus one status chip is read almost instantly, and a card that carries
more than about six facts stops being glanceable. That ceiling is why the A2
card pushes everything past six facts into the badge rail — fixed positions the
eye learns — and the rest into the inspector.

Screens cited: [Vapi](https://mobbin.com/screens/9da1fbc3-8295-418a-bb3f-67079f8fd2f2),
[Railway](https://mobbin.com/screens/4e385395-8885-4bd2-ae55-a242c9c7af30),
[Supabase](https://mobbin.com/screens/782baf2b-1d87-4a1c-a461-a87acc585ba9),
[Sentry](https://mobbin.com/screens/ac81ee7f-550f-4395-aafe-13da3dc10e05),
[Cloudflare](https://mobbin.com/screens/fa011061-0438-45b8-9371-caa44424b211),
[Better Stack](https://mobbin.com/screens/dc1236fd-3d9b-4152-a435-f54a50642974),
[Circle](https://mobbin.com/screens/c2f99cf3-fa9b-4be2-b607-e09c41f3b5da),
[Notion](https://mobbin.com/screens/0bd76f5f-9281-4d76-933e-cafe385ef965),
[ClickUp](https://mobbin.com/screens/9d29b1e7-7fb3-482a-8d4c-88891da75e66),
[HelloFresh](https://mobbin.com/screens/9ad368e4-3979-483c-ad77-82726b866a71).

## Design review, 2026-09-19 — first visual round rejected

The first styleframe round was rejected by the product owner as reading
"futuristic AI slop". The diagnosis was specific and correct, and it is recorded
here because it is the most useful design finding in this directory.

What was wrong:

1. **Glow.** The listening marker was a 2px edge with an outer halo, and the
   replay mode chrome had a bloom. Both read as a heads-up display. Everything
   that emitted light has been removed; the marker is now a 7px matte bar, and
   replay is a 4px matte border.
2. **A cold blue-black canvas.** `#0E1113` and its blue-leaning greys are the
   default of every framework dark mode, and that default is now the strongest
   "generated by a machine" signal available in a dark interface. The neutrals
   were re-cut warm — `#121110` canvas, `#4A453E` rules, `#F2EFE9` ink.
3. **Saturated fills on near-black.** The semantic palette was correct as
   *colour* and wrong as *material*. Each meaning now has a hue for text and
   glyphs and a matte ink for anything actually laid down as a mark.

The rule that came out of it is the one now at the top of
[visual language](visual-language.md): **printed, not illuminated.** It is worth
more than the rest of this file, because it is the one that was learned by
getting it wrong first.

Not changed, because they were not the problem: the pill controls, the card
grammar, the grid layout, the rails, and the four-family type system.

## Design review, round 4 — structure, not paint

Three instructions from the product owner, each of which changed the shape of
the product rather than its finish.

1. **"I want to be able to do headshots and stuff."** The card is now a
   photograph with a 5:4 crop, the channel number and fault flags over the
   image, and the ten-second trace as a strip on its bottom edge. This is
   WaveTool's instinct and it is correct: an A2 looks for Eleanor, not for input
   27. It also makes Manager's managed headshot pipeline
   ([roadmap](../product/roadmap.md), Phase 1A.3) load-bearing for the Live
   experience rather than a nicety, which is worth knowing before it is
   scheduled.
2. **"I don't think a sidebar is the vibe for this app at all."** Correct, and
   for a reason beyond taste: a standing left rail spends permanent width on
   navigation used in bursts, and a standing right rail spends it on a list that
   is empty most of the night. Filters became a horizontal band under the
   header; show-wide exceptions became a sheet on every viewport. The width went
   to faces.
3. **"The bottom bar coming up when you click on a channel to monitor it with
   like its timeline."** This replaced the side inspector entirely and is the
   better idea. The detail view now rises from the thumb zone, the grid does not
   move, nothing covers the faces, and the source's own timeline sits directly
   under the source's own identity. It also collapses two concepts — the
   inspector and the replay scrub — into one control that behaves the same way
   in both.

What this cost: the "full record" (assignment history, placement gallery, every
check badge, incident evidence) no longer has a permanent home and is now a
sheet reached from the monitor bar. That is one more tap for the deepest
material, which is the right trade, but it needs watching in the first
rehearsal — see the open questions below.

## Open design questions

These need an operator in a room, not more desk research.

1. Does the hand/mono split read as intended to an A2 who has never been told
   the rule, or does it just look inconsistent?
2. Is a 300×212 card at four columns too sparse for an operator used to
   WaveTool's density, and does pinch-to-compact recover it?
3. Is the ten-second window right for our lanes, or does separating audio and RF
   change the useful window for each?
4. Does the replay violet chrome survive a wing at 20% brightness under blue
   worklight, against the dark canvas?
5. Is the badge rail learned within one performance, or does it need labels for
   longer than that?
6. Does the ghost light read as a ghost light, or as a lamp?
7. Does the warm charcoal hold up under a blue worklight, or does the warmth
   disappear the moment the ambient light is cold?
8. Is the matte ink still legible at 20% screen brightness, or did removing the
   saturation cost more than the glow was worth?
9. Does a real production headshot survive the 5:4 crop, at 196px, in a dark
   wing — or do theatre headshots (often high-key, often full-length) need a
   managed face crop on ingest?
10. Is one tap to the full record too far when an A2 is mid-swap, and should the
    monitor bar have a second, taller detent instead of a separate sheet?
11. Does the monitor bar's timeline confuse live and replay, given that dragging
    its scrub is what enters replay mode?
