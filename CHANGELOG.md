# Changelog

All notable operator-visible changes will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project will use [Semantic Versioning](https://semver.org/) after the first
externally tested release.

## Unreleased

### Changed

- Live: the alert count is a bell with a count beside the settings cog instead
  of a wide pill. It keeps the same tones and opens the same exceptions sheet;
  its accessible name still spells the state out. On a phone the logo, room,
  bell and cog share one row.
- Live: the filter chips list the room's categories after All channels and
  Needs someone (Wireless and Wired only when the show has no categories). The
  row stays on one line, with chips that do not fit under a More dropdown, and
  is a dropdown on a phone.
- Live: audio output, your name and the Manager link move into one settings
  menu (a cog) in the header, leaving the room switch, node state and alert
  count. Each item has an icon, and on a phone the cog sits on the top row with
  the logo. The cog shows a dot while your name is unset or audio has no
  destination.
- Live: the room chips move into a room switch in the header. It opens a room
  sheet that shows each room's channel count, run of show and alert state, and
  a dot on the switch says when another room needs someone.
- Live: the A2 grid drops its title and instruction line, and the filter chips
  lose their label (the A1 view keeps its heading).

### Added

- Per-channel monitor trim (ADR 0033). Manager's Channels tab sets a trim of
  −24 to +24 dB per channel, first in the chain under each operator's level, on
  this device and on host output feeds. Live shows the trim on the card and in
  the channel detail. The worker's gain ceiling rises to +48 dB to cover a
  +24 dB trim under a +24 dB level.
- Live: "Clear alerts and reset" in a channel's expanded view (ADR 0032). After
  switching a transmitter off, it moves the channel's alerts to history and
  returns the channel to its default, unarmed state until a transmitter or
  signal is seen again.
- Live: pressing empty space beside or between the channel cards stops what
  is playing. On this device it ends the listen session; joined to a host
  output feed it clears the feed's shared selection for everyone in it.
- Live: shared host monitor output feeds (ADR 0031). When the node has an
  output device (for example Dante Virtual Soundcard routed to comms), Live
  asks on open whether audio plays on this device or in one of the
  production's feeds, e.g. Comms A on output 1 or Comms B on output 2.
  Everyone in a feed shares its selection, mute, dim and level and sees who
  changed it last. Manager's Host output tab defines the feeds and picks
  their outputs from the device; the node applies changes without a restart.
  The macOS app window gains an output device and default channel choice.
- Rooms and categories (ADR 0030). Manager gains a Rooms section (rooms, and
  categories inside each room) and a room/category picker per channel;
  sessions belong to a room. Each room runs its own sessions, so a breakout
  can turn over while the ballroom keynote runs. Live gains a per-device room
  bar, groups the grid under category headings, and shows one now/next bar
  per room. `PUT /api/v1/live/session` takes a `roomId` to end one room's run.

- Sessions and a shared run of show for corporate events (ADR 0029). Manager
  gains a Sessions section: an ordered agenda with start times, the channels
  each session uses and a per-session presenter. Live gains a now/next bar and
  a turnover sheet that lists what each channel in the next session needs —
  transmitter off, a battery to change (including one whose reported runtime
  will not last the scheduled session), a presenter change — then starts the
  session for every client through `PUT /api/v1/live/session`. Channels the
  running session does not use stop raising RF lost, TX muted and No audio,
  and a This session filter hides them. A presenter change makes an earlier
  mic check stale.

- Manager: a Productions section for listing, creating, activating and
  removing named local productions, backed by a new
  `GET/POST /api/v1/productions`, `POST /api/v1/productions/:id/activate`
  and `DELETE /api/v1/productions/:id` API. `GET/PUT /api/v1/showfile`
  keep working unchanged against whichever production is active
  (ADR 0025).
- Manager channels: an optional mic type, an uploaded headshot photo
  (read locally and stored inline as the channel's `imageUrl`, capped at
  200 KB), and per-dimension battery/RF/audio monitoring toggles.
- Manager Productions: download any production's showfile as a `.json`
  file, and import a `.json` showfile to create and activate a new
  production from it (backed by a new `GET /api/v1/productions/:id`).
  An imported showfile's channel-to-input patches are dropped unless they
  match this Mac's currently observed audio device, the same rule already
  applied when Manager loads its own showfile.

### Changed

- Live: listening no longer starts muted. Mute and dim stay one touch away.
- Live alerts no longer veil the card. An unacknowledged alert is a 2px
  severity ring plus a solid band across the photo's lower edge, so the card
  underneath is not dimmed and the label reads from across a room
  (DESIGN.md 2.3.0).
- Live no longer overflows a phone-width viewport: the channel photo kept a
  minimum width from its aspect ratio and the player controls clipped. Manager
  tables no longer widen the page on a phone.

- Manager navigation moved from horizontal tabs to a settings-style sidebar
  (Show, Productions, Receivers, Channels), and the Show and Receivers
  panels moved from stacked cards to data tables, matching the Channels
  panel that was already a table.
- Rebuilt the Manager UI on Tailwind CSS and shadcn-style component
  primitives (Button, Card, Input, Select, Table, Tabs, Badge) layered over
  the existing `packages/ui` design tokens, so Paper/dark theming is
  unchanged. Replaced the single scrolling form with a tabbed Show/
  Receivers/Channels layout, fixed a broken two-column grid that clipped the
  channel patch table, and turned the receiver list and channel patch into
  proper cards and a data table.
- Reworded the fabricated Live/Manager development data from a theatre cast
  to a corporate all-hands scenario (podium, panel, Q&A handhelds) ahead of
  the product's first deployment context. No schema or field names changed;
  only the fabricated sample values.

### Removed

- Withdrew the specification layer that ran ahead of evidence: five independent
  review rounds and their response ledgers, the `schema/v0` wire contracts and
  their golden fixtures, the evidence catalogues, manifest schemas and the
  evidence verifier, and the collaboration contract that specified the
  deferred Phase 1B/1C chat features. Recoverable at commit
  `6c123f3b44f69392da62ee9da0f61d07c7999daf`.
- The verifier was withdrawn rather than repaired because it did not verify:
  it compared declared artifact hashes without resolving the storage key,
  reading bytes, checking length or recomputing SHA-256, and its passing
  fixture used placeholder hashes against nonexistent stores. A green check
  asserted an assurance level the project did not have.

### Changed

- ADRs 0004-0018 and the dependent architecture, quality and protocol
  documents are marked Hypothesis rather than Accepted or Normative. ADRs
  0001-0003 keep Accepted.
- Added `docs/open-questions.md` as the live working list: the two questions
  that decide the product, the disposable spike that answers them, the
  contract findings still open when the reviews were withdrawn, and the
  commercial questions the plan has never addressed.
- Closed the general architecture-review loop. Review moves to
  evidence-bearing milestones.

### Added

- Expanded the Shure receiver integration from battery-only telemetry to the
  full read-only suite the coverage matrix scopes: an explicit per-receiver
  model picker in Manager (with channel count derived from the model, except
  the dynamically-licensed ANX4), a shared model/capability registry
  (`@rvlt/pulse-protocol/shure-models`), and a per-family command-string
  adapter in listen-gateway covering RF level, antenna diversity, channel/link
  quality, interference detection, a receiver audio meter, transmitter
  identity/mute, and transmitter battery health (type, cycle count, runtime).
  Live now shows RF/antenna/interference status alongside battery. Every
  value stays `null`/unavailable rather than fabricated when a model's
  capability profile does not support it; the adapter remains
  `compatible-read-only` pending hardware acceptance testing.
- Added the first runnable Live application slice: a responsive A2 channel
  grid with fabricated local data, independent status dimensions, alert
  acknowledgement, listen selection, channel detail, Paper/dark themes and a
  muted-by-default listening bar. Added the npm workspace, shared design tokens,
  locally bundled fonts, interaction tests and Node 24 CI checks.

- Resolved the independent stack reviews with executable evidence predicates
  over verified artifact bytes, explicit OS/device/browser/lifecycle promotion
  matrices, capture-frame/RTP rules, a hardened shared-memory ABI, complete
  native/backend supervision, media-worker recovery, immutable-slot updates,
  strict Ajv 2020/Fastify conformance, explicit WebRTC crypto providers,
  hermetic ASIO builds, accountable release roles and conditional WiX use.
- Rebased Phase 0 into a prerequisite closure slice, stack scaffold, capture
  proof and three attributable Phase 0B media/appliance/integration gates.
- Aligned branch governance with the current single-maintainer phase: pull
  requests and required cross-platform checks remain enforced, while the
  impossible second-person approval gate returns before an external pilot.

- Selected and documented the implementation baseline: Rust with a replaceable
  CPAL audio-host layer, shared-memory/Protobuf IPC, `str0m` plus `libopus`, a
  TypeScript/Fastify backend, independent React/Vite applications, pinned
  SQLite, Cargo/npm workspaces, cross-browser testing and native signed
  Windows/macOS packages. Hardware-sensitive choices remain evidence-gated.
- Added the target workspace/dependency map and a Phase 0T scaffold gate before
  hardware capture work.
- Initial product, architecture, quality, and repository-management baseline.
- Closed the third independent-review design findings with safe takeover
  fencing, exact Live lease/data-channel semantics, persistence and media-
  sandbox ADRs, runtime/cue/swap/handoff/reconciliation state machines,
  machine-readable protocol/evidence schemas, and a three-slice Phase 1A plan.
- Recorded a fourth independent review of that baseline without changing the
  reviewed plan; it found remaining evidence-schema, signed-wire, continuous-
  fence, physical-transition, lifecycle, confinement and operator-gate blockers.
- Implemented the Round 4 response: executable evidence promotion, signed
  command/result contracts and vectors, component-level swap/performance state
  machines, power-fenced boot authority, platform confinement/offline PKI,
  reconciliation objects, listening/operator gates and a bounded review exit rule.
- Recorded the bounded Round 5 closure review. It retained the architecture but
  found five executable-contract blockers in evidence promotion, command
  authority, boot-grant issuance, event/reconciliation truth and operator-slice
  promotion; remediation is a targeted closure change, not another broad review.
