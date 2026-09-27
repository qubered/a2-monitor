# Pulse next-level audit — September 2026

**Status:** Research snapshot and proposed shortlist. Nothing below the
shortlist is approved for build.

**Last reviewed:** 2026-09-27

**Scope:** one pass over what ships (G1), what users complain about (G2), the
competition (G3), the listen path measured (G4), UI research and a zero-training
test (G5), and a capped shortlist (G6). Judged against one job: **see every
channel at a glance, and listen to any of them in high quality at low latency,
on the LAN, offline.**

**Evidence labels used throughout**

- **Observed** — run or measured in this pass, on the stated setup.
- **Sourced** — from a cited primary source; **V** = page opened,
  **U** = snippet or unopened secondary source only.
- **Inferred** — reasoning from the above; says so.
- **Unknown** — not established; says what would establish it.

---

## Summary

- **The listen path is sound; its first seconds are not.** On a clean
  same-host path, the measured path (capture pipe → worker → Opus →
  Chromium → audio sink) is **~90–100 ms p50, ~100–120 ms p95** (Observed,
  Chromium 141, Linux, synthetic; ~32 ms of it is the sink's output latency). But **a fresh listen session starts at
  170–370 ms and takes 5–10 s to drain** — and Live opens a fresh session on
  the first tap, and on every channel added to a multi-select. Fix by timing,
  not by transport: open the session before the tap (G6 #1).
- **Nothing measured beats the current transport.** 5 ms Opus frames saved
  nothing measurable and made Wi-Fi-like loss worse (p50 150 → 187 ms);
  2.5 ms was worse everywhere; `jitterBufferTarget = 0` changed nothing;
  dropping Web Audio made no measurable difference; Chromium does not offer
  L16. **Keep WebRTC/Opus CELT 10 ms 128 kbit/s; tune around it.**
- **The latency gate as written is unreachable in a browser** (Inferred from
  Observed): the part Pulse and the browser control (~55–65 ms) already exceeds
  the 50 ms wired p50 budget before any device input or output buffer. Two tiers are proposed in
  [open questions](../open-questions.md#latency-gate-needs-two-tiers).
- **The glance fails at show scale.** On a 64-channel show an iPad shows
  **8 of 64** cards (phone: 4); **10 of 12** channels needing someone were
  off-screen in the walk; finding Ensemble 27 took 2,534 px of scrolling with
  no search. Photo-first cards are the cause (Observed).
- **The ringing card is the slowest card to hear.** First press acknowledges,
  second listens; in the walk, a tap meant to listen to Glinda silently
  acknowledged her battery alert instead (Observed).
- **Every Live client pulls ~790 kbit/s of JSON** — the whole show state once a
  second plus 20 Hz meters — six times its 128 kbit/s audio stream, on the same
  venue Wi-Fi that G2 says is the thing that breaks (Observed).
- **Where Pulse can win** (Sourced): WAVETOOL streams only to iOS with a
  hand-tuned 50–3000 ms buffer that "will be reset" when it drains; SoundBase
  "viewers cannot hear audio"; nobody publishes a latency figure. Any-device
  browser listening with an honest number is open ground.
- **Shortlist:** 10 items, 7 of them ≤ 1 day, 4 of them remove or simplify.
  Four need a DESIGN.md decision from you (listed at the end).

---

## G1 — What ships today, audited

### How this was walked

Observed on `421f319` (this branch), Linux container, 4 vCPU Xeon 2.8 GHz,
headless Chromium 141 via Playwright, touch emulation. Two shows:

- the `npm run dev:simulate` demo (8 inputs, one simulated AD4Q, two rooms,
  a corporate run of show); and
- a 64-channel musical-theatre show built for this audit: 48 wireless
  (12 simulated AD4Qs on 127.0.0.1–12) as 12 principals + 36 ensemble, 16 wired
  band inputs, categories Principals/Ensemble/Band, fictional names.

Viewports: iPad landscape 1024×768 (the stated primary device), iPad portrait
768×1024, phone 390×844, desktop 1440×900. **An agent walking the app is not a
user test.** Where this section reports time it is the app's measured response
time or a stated model; hesitations are the ones a first-time reader of these
screens meets, recorded honestly.

**First thing found:** `npm run dev:simulate` printed "Demo showfile was
rejected (HTTP 400)" and opened with no show. The demo seed still used the
pre-ADR 0035 `roomId/categoryId` channel shape. Fixed on this branch
(`421f319`) because nothing else in this audit could run without it.

### The core job, end to end (iPad landscape, 64 channels)

| Step | What happens | Taps | Hesitation / finding |
| --- | --- | --- | --- |
| Open | A modal asks **"Where should audio play?"** (This device / Comms A / Comms B) before the grid is usable, on any node with a host output. | 1 | A decision a first-timer cannot make yet ("what is Comms A?"). Blocks the first glance. |
| Glance | **8 of 64 cards fit on screen**; each card is 232×276 px, most of it a photo frame that on a new show reads "Photo not added" or a beltpack glyph. **10 of the 12 channels needing someone were off-screen.** Phone: 4 of 64. Desktop 1440×900: 12 of 64. | — | "Is anything wrong, and on whom?" cannot be answered without scrolling ~5 screens. The second row's status strips — "the thing an operator reads first after the face" — sit under the player. |
| Find | No search, no jump, no dense view. Category chips (Principals 12 / Ensemble 36 / Band 16) narrow the scroll; Ensemble 27 is still 2–3 screens down inside "Ensemble". | 1 + scroll | Theatre shows must create a "House" room to get categories at all, so the header shows a **Room: All rooms** switch and every heading reads "House · Principals". |
| Listen | Tap the card: "Listening" shows in the player in 0.3–0.5 s (simulated LAN). If the card happens to be ringing, the tap acknowledges instead — it happened to Glinda in the walk. A bar appears above the filters: **"1 channel monitored together."** | 1 | The bar is a bug (DESIGN §8.4 says it shows only with more than one) and pushes the grid down another 60 px. Player shows both a "Selected" pill and "Listening" text. |
| Switch | Tap another card; the node crossfades in place, no reconnect. | 1 | Good — matches the design. Measured switch latency in G4. |
| Alert → hear it | First press on an alerting card **acknowledges**; a second press listens. | 2 | The card that is ringing is the one the A2 wants to hear; the product makes it the slowest card to hear. |
| Mute / dim | Always visible in the player, 67×44 px pills ~75 px above the bottom edge. | 1 | Present and one touch away (good). Below the 56 px DESIGN §8.1 sets for primary live actions, and near the edge where touch accuracy is worst (G5 P9). |
| Stop | "Clear" exists only in that selection bar; blank-space press and `Esc` also stop. | 1 | Hidden gestures; the visible route exists only because of the bug above. |
| Back to glance | Scroll back up. | scroll | — |

### Every screen and component, classified

**Live** (`apps/live/src/components`)

| Component | Class | Reason |
| --- | --- | --- |
| `ChannelCard` | **Core — wrong size at scale** | The right content (number, name, status strip, trace, alert band); photo-first 16:10 layout makes 64 channels a 5-screen scroll. |
| `StatusStrip` | **Core** | RF · Audio · Battery in fixed positions with glyph + word is exactly P2/P17. Healthy = three green blocks, against P3. |
| `MeterTrace` | **Core** | 10 s trace on the card; honest silence/stale rendering. |
| `Player` (transport, mute, dim, level) | **Core** | Mute/dim one touch away. 156 px tall on iPad, 216 px on a phone (26 % of the screen); "History" (level history) is supporting. |
| `FilterBar` | **Supporting** | Chips with counts; the only way to narrow 64 today. |
| `ExceptionsSheet` (bell) | **Supporting** | Show-wide truth; good. |
| `ChannelDetail` | **Supporting** | The "why" surface; RF level and link quality kept separate (good). |
| `HeaderMenu` | **Supporting** | Output, operator, Manager link. |
| `SelectionBar` | **Questionable** | Shows for a single selection (bug); needed only for multi-select. |
| `OutputSheet` (first-open prompt) | **Questionable** | Useful when a production actually uses a host feed; as a mandatory first-open modal it is the first thing every user sees. |
| `RoomSheet` / room switch | **Questionable for theatre** | Corporate multi-room only; appears for any show with one room. |
| `SessionBar` / `SessionSheet` | **Questionable** | Corporate run of show; each room adds a 75 px full-width bar above the grid. Unvalidated with users. |
| `ReportBanner` / `A1Bar` / `ReportSheet` | **Supporting** | A1→A2 fault report (G2 #13). Not the core job but cheap and on-point. |
| `OperatorSheet` | **Supporting** | Name + A1/A2 role. |
| `MicCheck` | **Questionable** | Eight dimensions per channel, typed names, opened one channel at a time from the detail. G2 #9: A2s have 60–90 s per actor, often none. |
| `useLongPress` multi-select | **Questionable** | Useful for "hold two mics up against each other"; implemented as N separate WebRTC sessions (see risks). |

**Manager** (`apps/manager/src/components`, 8 tabs)

| Tab | Class | Reason |
| --- | --- | --- |
| Channels | **Core** | Names, inputs, receiver binding — without it nothing is monitored. |
| Receivers | **Core** | Telemetry source binding. |
| Show | **Core** | Show name, device. |
| Productions (library, photos) | **Supporting** | Headshots; useful, not required for the glance. |
| Alerts (policy thresholds) | **Supporting** | Visible, reviewable thresholds are right (G5 P6). |
| Rooms | **Questionable for theatre** | Categories can only exist inside a room. |
| Sessions | **Questionable** | Corporate only; unvalidated. |
| Host output | **Questionable** | Shared hardware feeds; drives the first-open modal in Live. |

Manager as a whole is supporting, not live-show surface. Two observations: a
64-channel show is a ~7,000 px table of 110 px rows that overflows
horizontally at 1440 px, and the status banner says "Showfile loaded from this
Mac" on any OS.

Nothing is classed **remove** outright: every questionable item has a
plausible user. The shortlist (G6) removes their *cost to the core job*
(modals, bars, fake rooms) rather than the features.

**Outside the apps.** About 11,000 lines in `crates/` (`pcm-abi`, `ipc`,
`supervisor`, `media`, `replay`) are not on the shipped listen path; only smoke
binaries use them. `crates/build-info` embeds a hash of every tracked file, so
any uncommitted edit — a doc, a script — fails `cargo build` until
`node scripts/generate-build-identity.mjs` is rerun. Both are developer cost,
not operator cost; listed under "not doing" with a suggested follow-up.

### DESIGN.md vs the shipped UI

| DESIGN.md | Shipped | Where |
| --- | --- | --- |
| §8.3 Arrows move focus; Space listens; Enter latches; Esc clears; 1–8 groups; M, D, R, `/` search. | Only **M, D, Esc**. No arrow navigation, no search; reaching channel 40 takes 85–89 Tab stops (two buttons per card). CLAUDE.md requires full keyboard operation. | `App.tsx` `handleKeyboard` |
| §8.4 Selection bar only while more than one card is selected. | Shows "1 channel monitored together." for one. | `SelectionBar.tsx` (`count === 0` check) |
| §8.1.2 Primary live actions 56 px. | Mute/Dim pills 67×44 px. | `Player.tsx`, `styles.css` |
| §10.4 Transport: previous · clear · mute · dim · level · groups · expand; scrub to replay; Save replay. | Mute · dim · level · History. No previous, no groups, **no audio replay** (level history only; `crates/replay` unwired). | `Player.tsx` |
| §10.8 Groups: show and personal press-to-listen groups. | Not implemented. | — |
| §11.3 Guided mic check ordered by track/zone, verdict controls in reach, hold-to-hear. | Per-channel checklist from the detail sheet, typed names. | `MicCheck.tsx` |
| §11.4 Replay mode. | Not implemented. | — |
| §3.4 Red = the channel you are hearing, **and** critical fault. | As designed — which is itself the problem (G5 P4): a listening ring and a critical ring are the same red on one grid. | `styles.css` |

### Code-level risks to the core job

| Risk | Where | Effect |
| --- | --- | --- |
| **First seconds of every new listen session are 2–4× late.** 13 of 14 fresh sessions ran at 170–370 ms capture→sink in their first seconds and took 5–10 s to drain to ~100 ms (G4). | Browser jitter buffer at session start; Live opens a session on first tap | The first thing a new user hears is the worst latency the product has. |
| **Multi-select = N peer connections + N AudioContexts.** Each has its own jitter buffer, so monitored channels are not time-aligned with each other; each added channel pays connection setup and the start-up transient; the node caps at `MAX_SESSIONS = 32` — 8 A2s × 4 channels exhausts it. | `App.tsx` playback slots; `audio-playback.ts` (one `AudioContext` per session); `pulse-media-worker/main.rs` | Contradicts latency.md ("one continuous stream per client, routing on the server"). |
| **Capture overruns are counted and never reported.** `pulse-device-capture` increments `dropped_callbacks` when its queue is full but nothing reads it. The worker's `droppedCaptureBlocks` does reach the gateway. | `device-capture.rs` `PcmQueue::try_push` | CLAUDE.md: "surface underruns, overruns, and clock discontinuities as metrics". A silent dropout at the source is invisible. |
| Capture writer thread polls with `thread::sleep(1 ms)`. | `device-capture.rs` | Up to ~1 ms added per chunk; on hosts with coarse timers more. Not on the RT callback, so no rule violation. Measure on Windows. |
| **The live-state stream resends the whole show (~70 KB) every second**, plus 20 Hz JSON meters: ≈ 790 kbit/s per Live client on the 64-channel sim, ~6× its audio stream, uncompressed (G4). | `services/backend` `/api/v1/live/events`; `meters.rs` | Competes with the listen path on venue Wi-Fi (G2 #7). |
| Real-time callback itself is clean: lock-free SPSC `try_push`, no allocation, no I/O on the callback. | `device-capture.rs` | No violation found. |
| The dev loop runs **debug** worker binaries (`start.ts` defaults to `target/debug`). CPU per listener doubles (6.7 % vs 3.2 % of a core, G4); latency is unchanged. | `listen-gateway/src/start.ts` | Only matters for anyone measuring on `npm run dev`. |

---

## G2 — What A2s and A1s actually complain about

**Coverage limits, stated first.** Reddit (r/livesound, r/techtheatre,
r/audioengineering) was unreachable to both search and fetch in this
environment; the Blue Room, ProSoundWeb *forums* and Gearspace returned HTTP 403.
Verified evidence therefore comes mostly from ControlBooth threads, ProSoundWeb
*articles* by working engineers, SoundGirls, and App Store reviews. Quotes from
named engineers hosted on shure.com are marked *vendor-hosted*. All URLs
accessed 2026-09-27. **V** = page opened; **U** = snippet/title only.

Ranked by how often and how severely the problem appears in the sources.

| # | Pain point | Who | Where | Evidence | Pulse |
| --- | --- | --- | --- | --- | --- |
| 1 | **Sweat and moisture kill or muffle lav elements mid-show**, repeatedly. The fix is physical; the tool's job is to point at the right actor fast. | A2, A1 | Theatre | 6 sources, "at least one lavalier per show this last week" — [ControlBooth mic-problems](https://www.controlbooth.com/threads/mic-problems.25509/) V; [PSW, Karch 2023](https://prosoundweb.com/placing-lavalier-mics-approaches-for-successful-deployment-in-theatrical-productions/) V; [SoundGirls](https://soundgirls.org/radio-mic-placement-in-musicals/) V | **Could solve (core):** hear the element on the actor's card in one tap; No audio / level-shape change while RF stays good is the signature. |
| 2 | **"Is it RF or the element?"** A mic dies mid-number; the mixer must compare RF against audio to decide. One A1 killed 15 radio mics and fell back to overheads. | A1, A2 | Theatre | [ControlBooth mic-goes-down](https://www.controlbooth.com/threads/mic-goes-down.25993/) V; [blog 2013](https://brian-the-techie.blogspot.com/2013/08/sound-101-mic-check-for-real.html) V; [ControlBooth 2005](https://www.controlbooth.com/threads/i-hate-our-wireless-mics.2828/) V | **Already solves (partly):** the status strip separates RF, audio and battery on one card. Link quality vs RF level is in the detail only. |
| 3 | **Meters can't tell breath or rustle from a broken mic — you have to hear it.** | A1, A2, RF | Theatre | "I listened back… that was just breath." Alice Brooks, *American Psycho* — [Shure insight](https://www.shure.com/en-US/insights/hear-what-the-meters-cant-tell-you-with-wavetool) V, vendor-hosted | **Could solve (core):** listen is the answer; listen-back (replay) is not shipped. |
| 4 | **Listening to one specific mic needs extra hardware.** Receivers sit backstage, not at FOH; Dante quad receivers have no headphone amp; listen stations, Wavetool, or an X32-as-Dante-interface are all "not really inexpensive". Picking a channel in Dante Controller risks a mis-click on the live system. | A2 | Theatre | [ControlBooth listen solution](https://www.controlbooth.com/threads/wireless-headphone-monitoring-solution.40283/) V; [headphone amp thread](https://www.controlbooth.com/threads/headphone-amp-for-monitoring-wireless-receivers.43819/) V; Broadway "listening station in the A2 rack" — [ControlBooth](https://www.controlbooth.com/threads/mic-sound-checks.38782/) V | **Core job, directly.** Any-device browser listen without touching Dante routing. |
| 5 | **A2s fitting mics away from the rack can't hear the pack.** A 2026 feature request asks for browser/WebRTC listen on a phone: "Target latency ≤ 200 ms", channel switch under 1 s, no install. | A2 | Corporate | [ShowStack issue 74](https://github.com/chazw661/ShowStack/issues/74) V (feature request, not a complaint) | **Core job.** Closest external statement of Pulse's promise; sets a user-stated latency ceiling of 200 ms. |
| 6 | **Battery certainty.** Fresh alkalines every show because a mid-show death is unacceptable; bars lie with rechargeables (calibrated to alkaline curves); tracking cycles is admin. | A2 | Theatre | [batteries](https://www.controlbooth.com/threads/batteries.16879/) V; [rechargeable tests](https://www.controlbooth.com/threads/test-results-rechargeable-batteries-for-wireless-mics.35443/) V; [cycles](https://www.controlbooth.com/threads/wireless-mic-batteries.43267/) V | **Supporting:** runtime minutes (where the receiver reports it) beat bars; Pulse shows runtime in detail and battery verdict on the card. |
| 7 | **Venue Wi-Fi is fragile for anything live.** Built-in APs are "junk"; audiences load the network; crews keep a hard line backstage. Wavetool's own iOS guide: "If the buffer runs out, the connection will be reset." | A1, A2 | Both | [XR18 Wi-Fi](https://www.controlbooth.com/threads/behringer-xr18-wifi-problems-and-embarrassing-stories.45255/) V; [backstage Wi-Fi](https://www.controlbooth.com/threads/backstage-wifi.34063/) V; [Wavetool iOS streaming](https://content-files.shure.com/Pubs/wavetool/en-US/ios-streaming.html) V | **Could solve:** a listen path that degrades (concealment, adaptive buffer) instead of resetting, and says honestly when it is late. |
| 8 | **Who has which pack** lives in spreadsheets; doubling roles and understudies cause wrong-actor/wrong-mic, caught only at mic check. | A2 | Theatre | [numbering packs](https://www.controlbooth.com/threads/numbering-packs.47655/) V; [mic check](https://www.controlbooth.com/threads/mic-check.49200/) V; Broadway A2 "elaborate Google Sheets" — [SoundGirls](https://soundgirls.org/interview-with-anna-lee-craig-a2-for-hamilton-on-broadway-part-2/) V | **Supporting:** character + performer on the card. Understudy swaps are not shipped. |
| 9 | **No time for mic check.** Equity half-hour, late actors, 60–90 s per actor; the A2 wiggles cable/connector/element to find intermittents. | A1, A2 | Theatre | [mic check](https://www.controlbooth.com/threads/mic-check.49200/) V; [sound checks](https://www.controlbooth.com/threads/mic-sound-checks.38782/) V | **Could solve cheaply:** hold-to-hear on the card while wiggling. An 8-dimension per-channel checklist works *against* this. |
| 10 | **Vendor tools are complex or capped for non-daily users.** WWB "unnecessarily complex for low-end users"; Smart Assist caps at 16 receivers; ShurePlus Channels dropped UR/UHF-R. | A1, school | Both | [WWB](https://www.controlbooth.com/threads/wireless-workbench.42748/) V; [Smart Assist reviews](https://apps.apple.com/us/app/smart-assist/id1497534897) V; [ShurePlus Channels reviews](https://apps.apple.com/us/app/shureplus-channels/id849092210) V | **Pulse's edge if it stays simple.** Every added screen erodes it. |
| 11 | **Corporate: no rehearsal, walk-in presenters, few channels shared across back-to-back panels, solo A1 wearing every hat.** | A1 (often solo) | Corporate | [PSW, Stewart 2024](https://prosoundweb.com/i-hate-it-when-that-happens-misadventures-in-the-glamorous-world-of-corporate-audio/) V; [PSW, Piligian 2025](https://prosoundweb.com/hats-off-managing-workloads-on-corporate-events/) V | **Supporting:** run of show / turnover exists. Its value is unproven with users. |
| 12 | **Corporate A1 is often not in the room** and sneaks out to listen. | A1 | Corporate | [PSW, Reed 2024](https://prosoundweb.com/up-periscope-using-a-probe-when-youre-not-in-the-room/) V | **Core job (listen)**, though to a room mic, not a radio mic. |
| 13 | **A1↔A2 identity translation over comms.** Corporate protocol confirms every presenter's RF channel verbally; budget theatres lack full-duplex intercom. | A1, A2 | Both | [PSW, Stewart 2025](https://prosoundweb.com/sharing-responsibilities-so-you-want-to-be-an-audio-engineer-part-3/) V; [ControlBooth comms](https://www.controlbooth.com/threads/communication-from-backstage-to-the-booth.38181/) V | **Supporting:** the A1 fault report. Useful, but not the core job. |
| 14 | **Receivers drop out of monitoring software** (grey in WWB) from IP conflicts, firewalls, cascaded switches, laptop on Wi-Fi. | A1, RF | Theatre | [QLX-D networking](https://www.controlbooth.com/threads/shure-qlx-d-networking.44657/) V | **Supporting:** honest stale/unknown grammar is exactly the right response. |

**Searched, not found (do not build on these without evidence):** user
complaints about Wavetool's latency, price or licensing; console
personal-mixer apps used as an A2 listen workaround; Bluetooth-latency
complaints from A2s; a primary account of a CEO's lav dying mid-keynote;
practitioner complaints about monitoring many breakout rooms; mixed-brand
rental fleets as a monitoring pain; complaints about Sennheiser WSM; a failure
caused by an understudy wearing the wrong pack (only indirect, #8).

### Theatre vs corporate, from the evidence

- **Failure mode.** Theatre: physical and recurring (sweat, wigs,
  choreography, element wear). Corporate: people and process (no rehearsal,
  walk-in presenters, shared receiver channels, presenters walking off with the
  pack — [PSW, Karch 2024](https://prosoundweb.com/placing-lavalier-mics-part-1-the-art-science-nuances-of-the-corporate-events-market/) V).
- **Identity.** Theatre thinks in characters and tracks, with understudies and
  In-Out sheets. Corporate thinks in presenter names that change per session.
- **Listening culture.** Theatre already has one (the A2 rack listen station,
  receiver headphone outs). Corporate evidence is about the A1 not being in the
  room.
- **Staffing.** Theatre separates A1/A2 and the A2 is mobile. Corporate is
  often one person.
- **What this means for Pulse.** The listen-first core job is strongest in
  theatre, where the pain is nightly and the incumbent answer is hardware.
  Corporate is where the run-of-show and room features live, and it is also
  where the evidence is thinnest.

---

## G3 — Competitive and adjacent landscape

All URLs accessed 2026-09-27. **V** = opened; **U** = snippet or unopened
secondary source. Independent user sentiment about these tools is scarce
(Reddit/PSW forums/Gearspace unreachable), so "complaints" below are mostly
what the vendors' own documentation reveals.

### Shure WAVETOOL 4 (released September 2026)

Primary source: the WAVETOOL 4 user guide, "Version 2.1 (2026-I)"
([PDF](https://pubs.shure.com/view/guide/WAVETOOL/en-US.pdf) V) and the
[product page](https://www.shure.com/en-US/products/software/wavetool4) V.

- **Platform.** Server is **macOS only** (the guide says macOS 14+, the product
  page macOS 11+). Audio from any Core Audio device at 48/96 kHz; Dante via
  DVS. Clients: free iOS/iPadOS/Apple-silicon Mac app, up to 8 users. **No
  Android, Windows or web client** (absence in docs and stores).
- **Listen path.** Solo to the server's output device; remote clients get
  their own mix, but **each client's audio goes to a hardware output on the
  server's interface** — only iOS clients stream over Wi-Fi, as PCM or AAC,
  mono/stereo, with a user-set **50–3000 ms buffer**; "If the buffer runs out,
  the connection will be reset." Shure's own troubleshooting tells users to
  turn off cellular and Ask-to-Join and use Airplane Mode. **No published
  end-to-end latency figure.**
- **Organisation.** Channel strips with photo, 10 s audio line (below
  −48 dBFS not drawn), one RF line = max across antennas, pink "quality" dashes
  ("Quality level can be low even if RF level is high"), battery; panels A/B,
  large/small tiles, zoom; 8 group buttons; **snapshots that follow MIDI** (so
  QLab/console drives them); players with real name, role and images.
- **Alerting.** Low RF, low battery, no signal, and SCP ("intelligent mic issue
  detection": broken-cable/unwanted-signal detector, with **alerts rejected
  when many channels clip at once**, e.g. a loud effect).
- **Replay.** Per-channel instant replay 1–30 min and **global replay** across
  all channels with −1 min/−30/−20/−10/−5 s hotkeys; click an event to hear it.
- **Other.** Mic check with up to 4 "acts", who/when per mic, Y/N keys;
  notebook; LTC display; chat with images, voice notes, MIDI/OSC macros.
- **Receivers.** ~25 families across 8 brands; auto-discovery only for Shure
  AD/ULX-D/SLX-D; **Wisycom Manager and WAVETOOL cannot run at once**.
- **Price.** $70/month, $660/year or $2,200 perpetual; activation needs
  internet (ShureCloud), then LAN-only. A typical rental kit is a Mac mini +
  DVS + touchscreen + UniFi AP + iPad mini
  ([rental listing](https://epic-productions.com/product/wavetool-audio-monitoring-server/) V).
- **Praise.** National Theatre (Dominic Bilkey): "roam freely backstage… with
  the chat function" ([AV Network](https://www.avnetwork.com/products/audio/shure-unveils-wavetool-4-heres-what-to-know) V);
  replay to tell breath from a broken mic (above). One independent App Store
  review wants iPad split view.
- **What it leaves open.** Mac-only server, Apple-only listening, per-client
  hardware outputs, manual Wi-Fi buffer tuning, no latency number.

### SoundBase (Show Code Corp.; Sennheiser investor and reseller)

- **What it is.** RF coordination + hardware control + device monitoring
  ("Coord"), plus intercom tracking and in-development patch/logistics apps
  ([docs](https://docs.soundbase.app/get-started/what-is-soundbase/) V).
  **It is not a listening product.** Remote View: "viewers cannot hear audio
  through the link" ([Remote View](https://docs.soundbase.app/guides/monitoring/remote-view/) V).
- **Monitoring wall.** Per-device cards with RF A/B + peak hold, audio,
  **link quality as its own field**, battery %/runtime, TX mute/power/lock;
  offline cards dimmed, battery "Awaiting telemetry"; tabs per act/position
  (a channel can be on several); photo cards; note cards
  ([monitoring](https://docs.soundbase.app/guides/monitoring/) V).
- **Remote View.** A LAN web server in the desktop app (browser views, no
  install, unlimited viewers, ~10 meter updates/s, "brief network flickers are
  smoothed over rather than flashing offline"). Pro-only.
- **Listen.** Clicking a card solos the mapped **REAPER** track over OSC;
  "Audio never flows through SoundBase"
  ([REAPER](https://docs.soundbase.app/guides/monitoring/audio-monitoring-reaper/) V).
- **Platform / offline.** Desktop macOS/Windows; fully offline local
  projects; licence activation needs internet
  ([requirements](https://docs.soundbase.app/reference/system-requirements/) V).
- **Price.** SE free (one manufacturer per project); Pro $399/user/yr;
  Business $1,999; Enterprise $3,999
  ([pricing](https://soundbase.app/pricing) V).
- **Sentiment.** ControlBooth, 2026: strong RF engine, steep UI for newcomers
  ("by *icon*; no tooltips"), docs "several versions behind"
  ([thread](https://www.controlbooth.com/threads/soundbase-and-actual-receivers.51622/) V).

### Adjacent tools (brief)

| Tool | Praised | Cursed / worked around |
| --- | --- | --- |
| Shure WWB 7 ([page](https://www.shure.com/en-US/products/software/wwb) V) | Free; monitor tab with timelines, event log, alerts | Complex for non-daily users (G2 #10); receivers grey out on bad networks (G2 #14). Listening happens at the hardware (Dante Cue/Browse on Axient Digital). |
| WWB Mobile / ShurePlus Channels (4.4★/42) | Quick phone check | Dropped UR/UHF-R support; "need to carry around a laptop" (2025 review) V |
| Sennheiser WSM 4.9 / Control Cockpit 9.2 / Smart Assist (2.9★/38) | WSM: coordination + monitoring, 6 computers | Smart Assist: 16-receiver cap, re-pair to reorder, one-at-a-time firmware V. WSM/Cockpit coexistence issues U |
| Lectrosonics Wireless Designer | Free, per-channel levels | No sentiment found U |
| RF Venue Spectrum Recorder | Browser UI, API, works with WWB/WSM/SoundBase | Spectrum only; no telemetry or audio |
| Dante Controller / DVS / Via | DVS: 64/128 ch, 4/6/10 ms latency ([docs](https://dev.audinate.com/GA/dvs/userguide/webhelp/content/dante_latency.htm) V) | Controller can't listen; Via ≈ 10–15 ms, 20–30 ms with two instances ([SOS](https://www.soundonsound.com/sound-advice/q-can-reduce-latency-when-using-dante-and-cubase) V); "not suitable when low latency is needed" ([RME forum](https://forum.rme-audio.de/viewtopic.php?id=31401) V) |
| Console apps (Yamaha MonitorMix 3.3★, A&H OneMix, Mixing Station) | Control a personal mix from a phone | **Control only — no audio to the phone.** The A2 still listens on a wired feed. |
| Assistive-listening (Listen Everywhere ~60 ms U; Sennheiser MobileConnect 50–65 ms U; AudioFetch) | Phone listening at venue scale | Few channels; not built for monitoring; numbers are vendor claims |
| Micboard ([repo](https://github.com/karlcswanson/micboard) V) | Read-only Shure telemetry web board on a Raspberry Pi | Stale since Oct 2022 ("Open to commits?" unanswered); no audio. 2026 revivals exist — unmet demand signal |
| RFutils ([repo](https://github.com/stoatworks-labs/RFutils) V, Jul 2026) | Browser Shure/SSC/AES67 + browser headphone cue | PCM16 over WebSocket at "~100–200 ms"; README: "not yet hardware-tested" |
| Shure-wireless-Reaper-Companion ([repo](https://github.com/elraval/Shure-wireless-Reaper-Companion) V) | DIY telemetry buttons + REAPER listen | DIY stack; proves people are stitching this together themselves |

No open-source WebRTC/Opus multichannel mic-listen project was found (GitHub
search, absence only).

### Where Pulse wins / is behind / nobody has solved it

**Pulse can win**

- **Listening on any device, no install.** WAVETOOL streams only to iOS via a
  Shure app with a hand-tuned 50–3000 ms buffer that resets when it drains.
  SoundBase stops at telemetry and solos REAPER on the host. Nobody lets an A2
  listen on an Android phone or a borrowed laptop from a browser. G2 #4 and #5
  are the evidence that this is wanted.
- **A latency number.** No incumbent publishes one. A measured,
  reproducible capture-to-ear figure — and an honest on-screen "you are N ms
  behind" when Wi-Fi makes it worse — is a differentiator on its own.
- **Honesty.** SoundBase has started (dimmed offline, "Awaiting telemetry",
  LQI as its own field); WAVETOOL hides low audio and merges antennas. Pulse's
  observed/inferred/stale/unknown grammar is a genuine wedge — *if* it stays
  glanceable.
- **Cost and platform.** A mini-PC + browsers undercuts a Mac + DVS + iPads
  kit and a per-seat subscription.

**Pulse is behind**

- **Density at scale.** WAVETOOL has large/small tiles and zoom; SoundBase has
  grid/cards/list. Pulse has one card size (G1: 8 of 64 visible on an iPad).
- **Listen-back.** WAVETOOL's global replay is the feature customers quote.
  Pulse's replay exists only as an unwired crate.
- **Receiver breadth.** Pulse: one Shure family in simulation. WAVETOOL ~25
  families; SoundBase 6 brands natively.
- **Show-control coupling.** WAVETOOL snapshots follow MIDI; Pulse has no cue
  input yet (by design, cue is opt-in).

**Nobody has solved it**

- **Wi-Fi reality.** Every phone-listening path is defeated by phones leaving
  internet-less SSIDs and by congestion; nobody ships a "this network is fit
  for listening" answer or per-client audio health.
- **Listen + multi-vendor telemetry without a DAW or a Mac.** Today it is
  WAVETOOL (Mac + DVS) or a stitched stack (SoundBase/Companion + REAPER + DVS).
- **Concurrent receiver access.** Vendor tools fight over sessions
  (WAVETOOL vs Wisycom Manager). One node owning one normalised session and
  fanning it out is Pulse's architecture already.

---

---

## G4 — The audio core

### What was measured, and how

Harness: [`tools/latency/`](../../tools/latency/README.md), built in this
pass. Raw records: [`next-level-audit-2026-09-data/`](next-level-audit-2026-09-data/README.md).

- **Path:** a stand-in capture process (same stdout contract as
  `pulse-device-capture`, 128-frame chunks paced to the wall clock) → the real
  listen gateway and `pulse-media-worker` (release build unless stated) →
  str0m → Opus → headless **Chromium 141.0.7390.37** playing Live's chain
  (muted `<audio>` + `MediaStreamAudioSourceNode` → gain → destination) → a
  **PulseAudio 16.1 null sink** at 48 kHz → `parec` stamping samples on arrival.
- **Reference → end point:** the time the chunk holding a 4 ms 2 kHz burst is
  written to the worker's pipe → the burst's first sample > 0.1 at the sink.
  ~1 burst/s, randomised against the 10 ms block. Chromium's own estimate
  (`getOutputTimestamp`) agreed with the sink to ~1 ms in every Web Audio run.
- **Host:** Linux container, 4 vCPU Xeon 2.8 GHz, 15 GB, kernel 6.18. No
  physical network: loopback, or a FIFO-preserving UDP relay that impairs the
  media direction.
- **Not included:** ADC/driver/DVS input buffering before the pipe; the
  output device after the sink. Chromium reports `baseLatency` 11.6 ms and
  `outputLatency` 32 ms for this sink (the latter read as 0 in some runs).
  **These are not capture-to-ear numbers.** No Firefox, Safari, iPad, real
  Wi-Fi or real audio interface was available: all of those are **Unknown**.

### Results

Latency in ms, capture→sink. *Steady* = bursts ≥ 30 s after the page started
listening. *First 10 s* = worst burst in the first 10 s of the session.

| Run | n | p50 | p95 | p99 | max | Steady p50 / p95 | First 10 s max | Mean jitter buffer | Concealed | Worker CPU (1 core) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A** Live chain, 10 ms (as shipped) | 150/150 | 95.8 | 115.8 | 120.5 | 121.6 | 94.4 / 99.2 | 121.6 | 33.6 | 0.02 % | 3.2 % |
| **B** plain `<audio>`, no Web Audio | 151/151 | 91.0 | 170.9 | 314.6 | 346.7 | 89.5 / 102.4 | 346.7 | 50.9 | 0 | 3.2 % |
| **C** A + `jitterBufferTarget = 0` | 149/150 | 103.6 | 120.5 | 307.5 | 345.5 | 102.4 / 116.8 | 345.5 | 36.3 | 0.01 % | 3.2 % |
| **G** A, debug worker (what `npm run dev` runs) | 120/120 | 89.2 | 113.6 | 222.2 | 269.1 | 87.1 / 92.0 | 269.1 | 31.4 | 0.01 % | 6.7 % |
| **F1** Opus **5 ms** frames | 121/121 | 89.3 | 116.0 | 141.8 | 171.0 | 87.9 / 94.1 | 171.0 | 30.2 | 0 | 4.3 % |
| **F2** Opus **2.5 ms** frames | 120/120 | 110.7 | 155.7 | 317.2 | 363.0 | 106.4 / 124.1 | 363.0 | 60.1 | 0 | 5.6 % |
| **W10** Wi-Fi-like¹, 10 ms | 150/151 | 149.8 | 183.4 | 363.0 | 397.1 | 149.5 / 156.6 | 397.1 | 79.2 | 1.05 % | 2.9 % |
| **W5** Wi-Fi-like¹, 5 ms | 148/150 | 188.7 | 206.1 | 320.6 | 363.5 | 187.2 / 204.1 | 363.5 | 125.4 | 1.25 % | 3.7 % |
| **P10** poor Wi-Fi², 10 ms | 116/120 | 231.9 | 287.9 | 339.1 | 380.0 | 228.3 / 249.0 | 380.0 | 153.6 | 5.05 % | 3.0 % |

¹ relay: 1 % loss, 2–8 ms uniform extra delay, 1 % of packets start a stall of
≤ 60 ms. ² 5 % loss, 4–19 ms, 2 % stalls ≤ 120 ms. Same shape as ADR 0026's
synthetic profiles; **not a model of any access point**.

| Other measurement | Result |
| --- | --- |
| Switch (`PUT …/channel` → first sample of the new input at the sink), n = 30 | p50 **103.5**, p95 258.5, max 430.1 ms. The tail is switches made inside the start-up transient; after it, a switch costs the path latency and nothing more. |
| Offer → track unmuted (new session) | 53–94 ms across 14 runs |
| Listeners 1 / 8 / 16 / 32 (node cap is 32) | worker CPU **3.2 / 8.4 / 13.4 / 24.4 %** of one core; RSS 8.4 / 9.7 / 11.3 / 14.7 MB; measured listener's steady p50 94–103 ms at every size. 8 listeners at 5 ms frames: 11.0 % (vs 8.4 %). |
| Non-audio traffic per Live client, 64-channel sim | live state: the **whole snapshot (~70 KB) once a second** ≈ 594 kbit/s; meters: 20 Hz JSON ≈ 196 kbit/s; neither compressed. Audio: 128 kbit/s. |
| Codecs Chromium offers | opus/48000/2, red/48000/2, G722, PCMU, PCMA, CN, telephone-event. **No L16.** |

### What the numbers say

1. **Where ~95 ms goes on a clean path** (Inferred attribution, consistent
   with the measured total): 10 ms block wait (5 ms mean) + Opus look-ahead
   2.5 + browser jitter buffer 20–35 (measured, decaying ~1 ms/s) + WebRTC
   10 ms playout chunks ~10 + Web Audio `baseLatency` 11.6 + this sink's
   `outputLatency` 32. **The part Pulse and the browser control is ~55–65 ms;**
   the rest is the output device.
2. **The start-up transient is the largest avoidable delay.** In 13 of 14
   fresh sessions the first seconds ran at 170–370 ms (jitter buffer
   240–340 ms) and drained over 5–10 s. The one exception (run A) started at
   121 ms. Live opens a session on the first tap, and multi-select opens one per
   added channel, so **the first seconds a user hears are the worst**. Cause
   (Inferred): media reaches the browser's jitter buffer before playout starts;
   the buffer then time-compresses its way down. A session opened before the
   tap spends the transient where nobody is listening.
3. **Smaller Opus frames do not pay.** 5 ms matched 10 ms within run-to-run
   drift on a clean path (steady p50 87.9 vs 87.1–102.4 across 10 ms runs)
   and was **worse under loss** (W5 vs W10: +38 ms p50, larger jitter buffer,
   more concealment) at +34 % CPU. 2.5 ms was worse everywhere.
4. **Web Audio costs nothing measurable here.** Plain `<audio>` steady p50
   89.5 vs Live's chain 94.4 — inside the ±8 ms spread between identical
   configurations. Keep it: it is what lets Live boost +24 dB and keep mute and
   dim authoritative.
5. **`jitterBufferTarget` is not a lever in Chromium.** It is a floor, not a
   cap; 0 changed nothing.
6. **Wi-Fi is where latency lives.** A mild 1 % loss / few-ms jitter profile
   adds ~55 ms (buffer grows to ~80 ms); a poor one adds ~135 ms with 5 %
   concealed audio. Nothing in the node changes this; the browser's jitter
   buffer decides. What Pulse *can* do is show it (G6 #5) and not waste the
   air (G6 #8).
7. **Quality.** CELT at 128 kbit/s mono concealed 0.00–0.02 % of samples on a
   clean path. Transparency was **not** tested by listening or by an objective
   metric (PEAQ/ViSQOL) — Unknown. Switching crossfades linearly over one
   10 ms block by design; artefacts not measured — Unknown. Loss concealment
   under the impairment profiles tracked the loss rate (1.05 % at 1 % loss,
   5.05 % at 5 %).
8. **Scale is not the constraint.** 32 listeners cost a quarter of one core.
   The per-client JSON stream (~790 kbit/s) is six times the audio and is the
   bigger load on venue Wi-Fi.

### Alternatives, with evidence

| Option | Evidence | Verdict |
| --- | --- | --- |
| Smaller Opus frames (2.5/5 ms) | F1, F2, W5 | **No.** No clean gain; worse under loss; more CPU. |
| Uncompressed L16/PCM over RTP | Chromium's offer has no L16 (Observed) | **Not available** in the browser's WebRTC. A custom path (WebTransport/WebSocket + AudioWorklet) re-opens ADR 0021's problems for ~2.5 ms of Opus look-ahead. |
| Jitter-buffer strategy | C (target 0 = no change); transient in 13/14 sessions | **Warm the session** instead (G6 #1). Firefox and Safari behaviour Unknown. |
| AudioWorklet vs default decode | B vs A: no measurable difference | **Keep the default decode + Web Audio gain.** A custom worklet jitter buffer only competes for the 20–35 ms NetEq uses on a clean path. |
| Capture buffer sizing | Not measurable here (no device) | Keep 128 frames with fallback; measure on the reference Mac/Windows host. |
| Switching / crossfade | Switch p50 103.5 ms = path latency | **Keep.** Server-side crossfade adds nothing measurable. |
| Multi-listener scaling | S8–S32 | **Keep per-session encoders**; 32 listeners = 24 % of a core. |
| Opus RED (Chromium offers `red/48000/2`) | Not tested (str0m support unknown) | **Next measurement** for venue Wi-Fi: redundancy costs bandwidth, not latency. |

### Recommendation: keep, and tune three things

**Keep** WebRTC/Opus CELT, 10 ms, 128 kbit/s, per-session encoder, server-side
crossfade, browser adaptive jitter buffer, Web Audio gain chain.

**Tune:** (1) open the listen session before the tap (G6 #1); (2) stop sending
the whole show state every second (G6 #8); (3) show the listener how late the
audio is (G6 #5). **Replace:** nothing — no measured alternative is better,
and each replacement costs more than it could save.

**Risk of this recommendation:** every number above is Chromium-on-Linux into a
virtual sink. Safari/iOS and Firefox may behave differently (e.g. a different
start-up policy); a real interface adds input buffering; a real AP behaves
unlike the relay. The physical test in
[latency.md](../architecture/latency.md#test-method) on your reference hardware
is still the gate — see "Decisions I need" at the end.

**Latency gate.** The measured numbers move the gate discussion, so they are
written into [open questions](../open-questions.md#latency-gate-needs-two-tiers)
with a proposed two-tier gate.

---

## G5 — UI/UX: nobody needs to learn it

### Principles that transfer

Sources accessed 2026-09-27; **V** = opened, **S** = snippet or secondary.
Only principles that change a Pulse decision are kept.

| # | Principle | Evidence | Transfer to Pulse |
| --- | --- | --- | --- |
| P1 | **The status question must resolve in one ~1.5–2 s glance, without scrolling or reading.** | NHTSA visual-manual guidelines: mean glance ≤2.0 s, ≤15 % over 2 s ([Federal Register 2014-22028](https://www.govinfo.gov/content/pkg/FR-2014-09-16/pdf/2014-22028.pdf) V); glances >2 s at least doubled crash risk (Klauer 2006, S). Real smartwatch glances are shorter than 5 s ([Visuri et al., CHI 2017](https://ubicomp.oulu.fi/files/chi17.pdf) V). | "Is anything wrong, and which one?" must be answerable for **every** channel from one screen. Scrolling to see 56 of 64 channels fails this. |
| P2 | **Only one unique visual feature pops out pre-attentively (<200–250 ms).** Conjunctions need serial search. | [Healey, perception in visualization](https://www.csc2.ncsu.edu/faculty/healey/PP/) V | A faulted tile must differ from all healthy tiles on one strong channel (a solid tinted cell/band). Healthy tiles must not carry competing saturated colour. |
| P3 | **Dark cockpit: when everything is normal the alert layer is dark.** Continuous instruments stay visible. | Airbus "lights out" philosophy ([FCTM via ManualsLib](https://www.manualslib.com/manual/2570669/Airbus-A318.html?page=207) V); Boeing "Quiet Dark" ([NASA NTRS](https://ntrs.nasa.gov/api/citations/19910001624/downloads/19910001624.pdf) V) | Pulse paints up to three **green** cells on every healthy card (~160 on the 64-channel sim) — the opposite of a dark cockpit, and green competes with the one card that matters (P2). |
| P4 | **Reserve alert colours for alerts.** | FAA HF compendium citing AC 25.1322-1 ([PDF](https://hfcc.dot.gov/publications/docs/GeneralGuidance/zz_FAA_GeneralGuidanceDoc_Chapter_04_Section_03.pdf) V) | Pulse uses red for "the channel you are hearing" (DESIGN §3.4) *and* for critical faults. On one grid the listening ring and a critical ring are both red. |
| P5 | **Replace invalid data with an explicit flag; never leave a frozen last value.** | A320 PFD flags ([FlyByWire docs](https://docs.flybywiresim.com/pilots-corner/a32nx/a32nx-briefing/pfd/flags-messages/) V, secondary) | Pulse already does this (honesty grammar). Keep it. |
| P6 | **85–99 % of alarms need no action; alarm fatigue kills. Every alert must imply an action.** | [Joint Commission SEA 50](https://digitalassets.jointcommission.org/api/public/content/f65e5c9df2b94000a99445e0a7877007) V; 88.8 % false arrhythmia alarms, 91 % of ST alarms <1 min ([Drew et al. 2014](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0110274) V); −89 % alarms with no harm ([BMC pilot](https://www.sciencedaily.com/releases/2014/01/140115172938.htm) V) | Audit every alert kind for "what does the A2 do now?" TX muted and clipping are states, not faults, in most shows. Debounce transient RF dips. |
| P7 | **Budget alerts per operator per 10 min; group floods by common cause.** | EEMUA 191 benchmarks: <1 per 10 min steady, ≤10 in the first 10 min of an upset ([ASM white paper](https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/February%2028%202005%20-%20Acheiving%20Effective%20Alarm%20System%20Performance%20Benchmarking.pdf) V) | A receiver going offline should be **one** alert naming its four channels, not four cards ringing. |
| P8 | **Latching vs non-latching; technical vs subject alarms.** | IEC 60601-1-8 definitions ([sample](https://cdn.standards.iteh.ai/samples/37404/02bc9af9db9f4cf0805ee27fd344ea0d/IEC-60601-1-8-2003.pdf) V) | A 200 ms dropout the A2 did not see should latch a mark on the card; "receiver offline / data stale" must look different from "battery low". |
| P9 | **One-handed thumb targets need ~9.2–9.6 mm; corners need ~12 mm.** 44 pt is ~6.9 mm. | [Parhi et al. 2006](https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/parhi-mobileHCI06.pdf) V; [Hoober](http://www.4ourthmobile.com/publications/designing-for-touch) V | Mute/dim at the bottom edge need ≥56 px on a phone (DESIGN already says 56 for primary live actions — shipped Mute/Dim are 44–48). A dense tile ≥ 60×60 CSS px is still an acceptable one-thumb target. |
| P10 | **Grips change every few seconds; don't design for one thumb zone.** | [Hoober, 1,333 observations](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php) V | Keep mute/dim centred or mirrored, never in a corner. |
| P11 | **Novices search linearly; experts use stable spatial memory; offer type-to-jump.** | [Cockburn, Gutwin & Greenberg, CHI 2007](https://grouplab.cpsc.ucalgary.ca/grouplab/uploads/Publications/Publications/2007-PredictiveModelMenus.CHI.pdf) V | Keep fixed showfile order (Pulse does). Add jump-by-number/name. Never page channels. |
| P12 | **Recognition over recall; visible system status; response within 0.1 s.** | [NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) V; [response times](https://www.nngroup.com/articles/response-times-3-important-limits/) V | Tap must show "selected" instantly; a connecting state after ~1 s; the listening state must be on the card, not only in the player. |
| P13 | **First click predicts success (87 % vs 46 %).** | Bailey & Wolfson via [MeasuringU](https://measuringu.com/do-click-tests-predict-live-site-clicks/) V | Zero-training test = first-tap test on the real grid (G5 test below). |
| P14 | **Light-on-dark is less legible, especially at night; compensate with size/weight.** Avoid pure white on black and saturated colour on dark. | [NN/g dark mode](https://www.nngroup.com/articles/dark-mode/) V; [Material dark theme codelab](https://codelabs.developers.google.com/codelabs/design-material-darktheme) V | Keep Pulse dark (for light spill, not legibility); keep names ≥15 px and bold; desaturate healthy states. |
| P15 | **Glance-critical text ≥20–22 arcmin.** | [FAA HFDS ch. 5](https://hf.tc.faa.gov/hfds/download-hfds/hfds_pdfs/Ch5_Displays_and_printers.pdf) V | At 40 cm (phone) that is a ~21–23 px font for a channel's name/number; at 60 cm (iPad) ~3.5 mm cap height. A dense tile's name must stay ≥15 px bold, number ≥18 px. |
| P16 | **Uncertainty is ignored unless it changes the value's appearance.** | [Padilla, Kay & Hullman 2020](https://friendly.github.io/6135/papers/Uncertainty_Visualization_Padilla_Kay_Hullman_2020.pdf) V | Confirms the honesty grammar: stale must change the mark itself (hatch, dash), not add a caption. |
| P17 | **Never colour alone (≈1 in 12 men).** | [NEI](https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness) V; [WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) V | Pulse already carries glyph + word. Keep it in any dense view. |
| P18 | **Flash small and slow.** ≤3 flashes/s; IEC high-priority 1.4–2.8 Hz. | [WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) V | The 2 s attention pulse is compliant; keep it to the ring, never a whole saturated tile (light spill in the wings). |

**Commonly misapplied, not adopted:** red-only "night mode" (the reading fovea
has no rods; phone reds are broadband — low luminance matters more than hue);
"dark mode is more legible" (it isn't); "7±2 means show fewer channels"
(recognition, not recall — fix scale with density + jump, not paging);
copying IEC/EEMUA numbers literally (the principles transfer, the numbers
don't); sound as a second alert channel (backstage, on headphones, it is
unusable — and the iOS Safari Vibration API does not exist, so haptics can't
be the second channel either).

### The zero-training test

**Definition.** A first-time A2, no instructions, iPad in one hand, a
64-channel show. Eight tasks, each with a budget of taps, scroll and seconds
(seconds are for human runs; the agent run below records taps, scroll and the
app's own response time instead).

| # | Task | Budget | iPad 1024×768 (Observed) | Phone 390×844 (Observed) | Result |
| --- | --- | --- | --- | --- | --- |
| T0 | Open Pulse and see the channels | 0 decisions | Modal "Where should audio play?" first | Same | **Fail** |
| T1 | "Is anything wrong, and on whom?" | one glance, 0 scroll | 8 of 64 cards on screen; **2 of 12** channels needing someone visible | 4 of 64; 2 of 24 visible | **Fail** |
| T2 | Listen to Glinda | 1 tap, ≤ 3 s | Tap **acknowledged** Glinda's Low battery alert instead of listening | 1 tap; "Listening" shown after 470 ms | **Fail** (iPad) |
| T3 | Switch to Ensemble 27 | 1 tap, find ≤ 2 s | 2,534 px of scroll (≈ 4 screens), no search | 5,209 px (≈ 8 screens) | **Fail** (switch itself: 216–239 ms to the player) |
| T4 | Mute | 1 tap, ≤ 1 s | 67×44 px, 77 px from bottom | 67×44 px, 70 px from bottom | Pass (under DESIGN's 56 px) |
| T5 | Unmute, dim instead | 2 taps | 2 taps | 2 taps | Pass |
| T6 | An alert is ringing on a channel — hear it | 1 tap | 2 presses | 2 presses (+496 px scroll) | **Fail** |
| T7 | Stop listening | 1 visible control | "Clear" — visible only because of the selection-bar bug | Same | Pass by accident |
| T8 | Find Elphaba's frequency | ≤ 2 taps, ≤ 10 s | Expand (44×44) → detail → Frequency | Same | Pass |
| K | Reach channel 40 by keyboard | ≤ 3 keys | 89 Tab stops; arrows do nothing | 85 | **Fail** |

Four of the five failures are the glance and the first tap — the core job.
**This is an agent's run, not a user test.** The same eight tasks with five
real A2s, timed, is the validation step after the shortlist ships.

### Channel organisation at 64 channels

**Can a first-timer find the right channel in under two seconds?** Not today
(Observed): only channels 1–8 are on the first iPad screen; a category chip
narrows Ensemble to 36 cards that still span nine rows; there is no search.

What helps, from G5 research: fixed showfile order (Pulse has it — P11), all
channels on one screen so novices can scan linearly (P1, P11), a number and
name large enough to read at arm's length (P15), and a jump for the keyboard
(P11). What does not: more filter chips, paging, or sorting by severity (Pulse
rightly refuses the last).

Model review:

- **Categories** are right and cheap. They should exist **without a room**:
  a theatre show today must invent a "House" room, which then puts a room
  switch in the header and "House ·" on every heading.
- **Rooms** are right for corporate multi-room shows and noise for everything
  else; hide their UI when a show has one room.
- **Run of show** (sessions) is unvalidated and each room adds a full-width
  bar above the grid; keep it, compress it to one line.
- **Filters** earn their place ("Needs someone" especially); they are not a
  substitute for seeing everything.

### Where I think DESIGN.md is wrong

Stated explicitly, with evidence, rather than silently deviated from. Each needs
your decision before the matching shortlist item is built.

1. **§10.1 "The centrepiece, and it is a photograph."** At 64 channels a
   16:10 photo per card is why the glance fails (G1: 8 of 64 on an iPad; G5 P1,
   P2). WAVETOOL (small tiles, zoom) and SoundBase (grid/cards/list) both
   concede density (G3). Proposal: the grid fits every channel on screen and
   shows the photo when there is room for it; the photo always lives in the
   detail.
2. **§10.3 "Pressing the card acknowledges it, and nothing else."** The card
   that is ringing is the one the A2 most needs to hear, and the vision
   promises "hear and diagnose any incident within two taps". T2 and T6 show
   the rule costing a tap and, worse, eating a tap meant to listen. Proposal:
   the press acknowledges *and* listens.
3. **§2.9 / §3.3 "The brand is the good state" (green on every healthy cell)
   and §3.4 red = the channel you are hearing.** Dark-cockpit practice keeps the
   alert layer dark when all is well (P3) and reserves alert colours for alerts
   (P4); pre-attentive pop-out needs the faulted tile to be the only saturated
   one (P2). Proposal: healthy cells are a quiet neutral tick; listening uses a
   non-alarm colour so red on the grid always means critical.
4. **§10.4 "Live asks once whether to play on this device or join a feed."**
   It is the first thing every user meets (T0) and most productions will not
   use a host feed. Proposal: default to this device; the header menu (already
   there) switches to a feed.

DESIGN.md is right, and the app is wrong, on: 56 px primary live actions
(§8.1.2), the selection bar only for ≥ 2 (§8.4), and keyboard operation
(§8.3).

---

## G6 — The shortlist

Ten items, ranked by impact on the core job ÷ effort. Effort: **S** ≤ 1 day,
**M** 2–4 days. Each passes the cut test: (1) the core-job step it improves,
(2) the finding it answers, (3) why removal alone won't do, (4) what it costs
the operator — where the target is zero or negative.

**Decision, 2026-09-27:** approved except #3 (the first-open output prompt is
intentional) and #7 (operators don't need a latency readout). #4 keeps the
current card layout as an option alongside the glance view.

| Rank | Item | Kind | Effort | Decision |
| --- | --- | --- | --- | --- |
| 1 | Warm listen session | Tune | S | Approved |
| 2 | Pressing a ringing card hears it | Change | S | Approved (DESIGN §10.3) |
| 3 | No first-open modal | **Remove** | S | **Declined** — intentional |
| 4 | Glance view: every channel on one screen | Change | M | Approved, with the card view kept as an option (DESIGN §10.1) |
| 5 | Nothing above the grid that isn't needed now | **Remove** | S | Approved |
| 6 | Colour only means trouble | **Simplify** | S | Approved (DESIGN §2.9, §3.4) |
| 7 | Show how late the audio is | Add | S | **Declined** — not needed by operators |
| 8 | Stop sending the whole show every second | **Remove** (traffic) | M | Approved |
| 9 | Surface capture overruns | Add (rule) | S | Approved |
| 10 | Full keyboard operation | Change (rule) | M | Approved |

### 1. Warm listen session — the first tap sounds like every other tap · S

- **Step:** listen. **Answers:** G4 — 13 of 14 fresh sessions ran at
  170–370 ms for their first 5–10 s, plus 53–94 ms to connect; Live opens one
  on the first tap. G5 P12.
- **Why not removal:** the delay is the browser's jitter buffer at session
  start; the only lever is *when* the session starts.
- **What:** Live opens its listen session when the page opens (node sends
  silence, gain at zero); the first tap is a `PUT …/channel` (measured p50
  ~100 ms, same as steady state). Still starts unmuted at the operator's last
  level (DESIGN §2.7). Same for an added multi-select channel if a spare warm
  session exists.
- **Operator cost:** none. **Appliance cost:** one idle session per open page
  (~0.7 % of a core, 128 kbit/s or less for silence — measure).
- **Verify:** harness — first-tap latency 15 s after page open, 20 trials, vs
  cold start.

### 2. Pressing a ringing card hears it · S · *DESIGN §10.3*

- **Step:** listen (the listen that matters most). **Answers:** vision ("hear
  … any incident within two taps"); T2 (a listen tap silently acknowledged an
  alert), T6 (two presses); G2 #1–3.
- **Why not removal:** acknowledgement is still needed for the expiry rules;
  the press does both.
- **What:** first press on an alerting card acknowledges **and** listens. The
  band clears; the status strip keeps the fault (unchanged).
- **Operator cost:** negative — one rule fewer.
- **Verify:** T2/T6 = 1 press on the 64-channel sim; `App.test.tsx`.

### 3. No first-open modal · S · *DESIGN §10.4 / ADR 0031*

- **Step:** open → glance. **Answers:** T0.
- **What:** Live plays on this device by default; the header menu (already
  there) joins a host feed and the header says which is active. A remembered
  feed still applies.
- **Operator cost:** negative. **Verify:** T0 on a node with host output.

### 4. Glance view — every channel on one screen · M · *DESIGN §10.1*

- **Steps:** glance, find. **Answers:** T1, T3 (8 of 64 visible; 10 of 12
  troubled channels off-screen; 2,534 px to Ensemble 27); G2 #1–2; G5 P1, P2,
  P11, P15; G3 (both competitors concede density).
- **Why not removal:** dropping the photo alone still leaves fixed-size cards;
  the grid must size tiles to what is in view.
- **What:** tile size is chosen so every channel in the current room/filter
  fits the viewport, down to a floor of 60 px targets (P9): 64 channels on a
  1024×768 iPad = 8×8 tiles of ~120×65 px. A dense tile keeps number, name
  (≥ 15 px bold), the three-cell status strip and a level bar; the photo
  appears when tiles are big enough and is always in the detail. Below the
  floor (a phone at 64) the grid scrolls, ~30 tiles per screen. Showfile order
  unchanged, no reordering.
- **Operator cost:** none; less scrolling.
- **Verify:** Playwright on the 64-channel sim — all 64 tiles fully visible at
  1024×768 and ≥ 60 px; T1 and T3 with 0 px scroll; grayscale screenshot still
  readable.

### 5. Nothing above the grid that isn't needed now · S

- **Step:** glance. **Answers:** G1 — "1 channel monitored together" bar
  (bug vs DESIGN §8.4, +60 px); a 75 px run-of-show bar per room; a room
  switch and "House ·" headings on single-room shows.
- **What:** selection bar only with ≥ 2 selected; a stop control on the
  player instead (T7); one-room shows hide the room switch and prefix;
  run-of-show bars collapse to one line.
- **Operator cost:** negative. **Verify:** screenshots; first card's top edge
  ≤ 140 px on iPad.

### 6. Colour only means trouble · S · *DESIGN §2.9, §3.4*

- **Step:** glance. **Answers:** G5 P2, P3, P4; G1 (~160 green cells on a
  healthy 64-channel grid; listening ring and critical ring both red).
- **Why not removal:** it *is* mostly removal — the green fill goes.
- **What:** healthy cell = quiet neutral tick with its word; caution, fault and
  unknown keep their tints. Listening uses a non-alarm ring (`--ink` or the
  signal green), so red on the grid is only ever a critical fault.
- **Operator cost:** none. **Verify:** 64-channel screenshot with one fault —
  it is the only saturated tile; still operable in grayscale (P17).

### 7. Show how late the audio is · S

- **Step:** listen (trust). **Answers:** G2 #7 (Wi-Fi fragility), G3
  ("nobody publishes a latency figure"), G4 #6, README principle 2.
- **What:** the player reads the listen session's `getStats()` once a second
  and, only when playout delay passes a threshold, says so: "Audio ≈ 180 ms
  behind (network)". Concealment shown when non-zero. Labelled as the
  browser's estimate (honesty grammar: inferred).
- **Operator cost:** one line, only when something is wrong.
- **Verify:** harness `--impair` profiles — the shown figure tracks
  capture→sink within ~20 ms.

### 8. Stop sending the whole show every second · M

- **Steps:** all (the network under the listen path). **Answers:** G4 — each
  Live client receives the full ~70 KB state once a second (≈ 594 kbit/s) plus
  ≈ 196 kbit/s of meters, ~6× its audio; G2 #7.
- **Why this is removal:** the same information, sent only when it changes.
- **What:** the state stream sends a snapshot on connect and then only what
  changed (channels, alerts, reports); meters stay 20 Hz but compact
  (numbers, not keyed JSON). Contract versioned in `packages/protocol`.
- **Operator cost:** none. **Verify:** bytes per client per 10 s on the
  64-channel sim, before/after; Live tests unchanged.

### 9. Surface capture overruns · S

- **Step:** trust in everything. **Answers:** CLAUDE.md real-time rule; G1
  risk (`dropped_callbacks` counted, never read).
- **What:** `pulse-device-capture` reports its overrun count; the worker adds
  it to its stats; Live's node notice says "Capture dropped audio N times" when
  it moves.
- **Operator cost:** none unless it happens. **Verify:** unit test that fills
  the queue; gateway stats-event test.

### 10. Full keyboard operation · M

- **Steps:** find, listen, switch (A1 at a desk, laptops). **Answers:**
  CLAUDE.md; DESIGN §8.3; K (89 Tab stops; arrows do nothing).
- **What:** the grid is one Tab stop with roving focus; arrows move, Space
  listens, Esc clears; typing a channel number, or `/` then a name, jumps.
- **Operator cost:** none for touch users. **Verify:** Playwright keyboard
  walk; `App.test.tsx`.

### Not doing, and why

| Tempting idea | Why not (now) |
| --- | --- |
| Opus 2.5/5 ms frames | Measured: no clean gain, worse under loss, more CPU (G4). |
| L16/PCM, custom AudioWorklet jitter buffer, WebTransport | L16 not offered by Chromium; a custom path re-opens ADR 0021's problems to chase ~20–35 ms that NetEq uses on a clean path. Item 1 removes the big delay for free. |
| `jitterBufferTarget` tuning | Measured: no effect in Chromium. |
| Multi-select as one node-side mix | Real problems (N sessions, unaligned, 32-session cap), but multi-select is new and unvalidated. **Your call:** convert (M) or cut. |
| Replay / listen-back | The feature WAVETOOL users quote and the strongest next candidate — but it is a mode, a storage policy and a surface. Next pass. |
| Opus RED for Wi-Fi | Promising (Chromium offers it); needs str0m support checked and a measurement first. |
| Chat, voice notes, reactions | Competitors have them; comms is the authoritative urgent path. Fails "no feature because a competitor has it". |
| Haptic second alert channel | iOS Safari has no Vibration API. |
| Previous-source button, press-to-listen groups | DESIGN lists them; no G2 evidence ranks them above the ten. Revisit after item 4. |
| Guided mic-check rewrite | Real pain (G2 #9) but pre-show, not the live core job. Later: hold-to-hear + pass/fail walking the grid. |
| Categories without a room (Manager) | Right fix for theatre shows; item 5 hides the symptom in Live first. |
| Understudy swaps, cue integration, more receiver families | Theatre-real and large; not glance/listen surface work. Separate tracks. |
| Deleting the unwired `crates/` (~11k lines) | Mechanical; CLAUDE.md forbids mixing it with behaviour changes. Separate decision. |
| Build identity failing on any uncommitted edit | Developer friction only; separate task. |

---

## Decisions I need

1. ~~Approve (or cut) the shortlist.~~ Decided 2026-09-27 (above). Items 2,
   4 and 6 update DESIGN.md in the same slice as the change.
2. **Multi-select:** convert to one node-side mix, or cut it?
3. **Hardware for the physical capture-to-ear test:** which Mac or Windows
   host and interface (DVS or USB), which client devices (iPad model, an
   Android phone, a laptop), and which access point. Until then every G4
   number is synthetic.
4. **Latency gate tiers:** confirm or change the two tiers proposed in
   `docs/open-questions.md`.
