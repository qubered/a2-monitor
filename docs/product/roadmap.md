# Roadmap

**Status:** Proposed and rebaselined after independent review

Dates begin only when the named team, representative hardware, vendor access,
and test network are available. Every phase ends in evidence and a go/no-go
decision; calendar completion alone does not advance the product.

## Phase 0A: prove capture and time — 4 to 6 weeks

Build a disposable, instrumented cross-platform audio core.

Deliverables:

- frozen machine-readable evidence manifest plus signed result artifacts;
- pinned Windows/macOS CI builds, contract tests and real-time callback guards;
- Windows and macOS node builds sharing one capture contract;
- ASIO, WASAPI, and Core Audio evaluation;
- DVS plus a representative professional USB/Thunderbolt device on each OS;
- exactly one selected device and capture clock at a time;
- 32–64 channels at the 48 kHz reference profile;
- capture epochs, device identity, discontinuity and loss/recovery behavior;
- bounded callback-to-worker handoffs and initial resource envelope;
- 12-hour capture soak and physical input-to-node measurement; and
- ADRs selecting implementation language, host library, IPC, and reference
  hardware.

Exit gate:

- both operating systems meet callback and continuity targets on named hardware;
- device/driver/clock changes are detected and never silently repatch sources;
- the one-device constraint is enforced;
- worst-case callback work remains inside the budget; and
- unsupported device/rate/channel combinations fail clearly.

## Phase 0B: falsify the end-to-end architecture — 4 to 6 weeks

Connect the minimum complete signal and control path without treating the code
as production-ready.

Deliverables:

- frozen Phase 0B manifest for every named tuple, fault and pass/fail threshold;
- per-client server-side bus and WebRTC/Opus playback;
- physical gesture-to-ear and capture-to-ear measurements on the named browser
  field kit;
- multi-NIC ICE/interface/firewall validation with no hardware-network leakage;
- browser reload, lock/wake, output-change, roaming, and backend-restart tests;
- one real EW-DX SSCv2 profile and one representative Shure rack profile;
- sandboxed adapter failure and reconnect-storm test;
- a minimal preallocated replay ring proving the timeline/storage architecture;
- backend local HTTPS/CA provisioning, node enrollment, pinned WebRTC DTLS,
  reliable ordered control data channel, signed lease and secret-envelope spikes;
- active-node authority epoch, externally fenced takeover, unprivileged client
  gateway, boot authority grant, exact proof-of-possession, durable idempotency/control-ledger and
  partition/quarantine spikes;
- minimum chunk seal/import, signed receipt, ledger-head rollback comparison and
  projection-rebuild spike;
- replay-reader/prefetch isolation and concurrent seek cancellation;
- foreground wake-lock field profile plus camera, microphone/voice capture,
  notification sink and audio-route continuity tests;
- QLab 5 read-only OSC show-control-broadcast observer spike;
- cue shadow-mode comparison against a manual rehearsal log before authority;
- combined capture/replay/receiver/media load plus chat fan-out, upload/hostile
  decode, page storm, disk pressure and impairment; and
- a second 12-hour end-to-end soak.

Exit gate:

- at least one named wired and one named Wi-Fi client meet numeric latency and
  continuity targets;
- browser lifecycle limitations and the native-client trigger are documented;
- valid Live sessions retain bounded listen control through backend restart;
- receiver/adapter failure cannot interrupt capture;
- replay backpressure cannot reach the callback; and
- collaboration/resource overload sheds before capture/live media and the
  authority/control ledger cannot fork or evict accepted runtime mutations; and
- the security/process architecture has no unresolved P0 design blocker.

## Phase 1A: operational rehearsal core — three independently gated slices

The reference production is theatre or musical theatre. The former combined
12–16 week estimate is withdrawn: every slice is estimated only after Phase 0B
evidence, staffing and hardware availability. The exact feature/dependency table
is the [phase capability matrix](phase-capability-matrix.md).

### Phase 1A.1: monitor and identify

- Manager activation, people/role/asset identities and performance overlay;
- foreground-safe Live audio, meters, receiver state, replay and output control;
- minimum live ledger import, head comparison and projection rebuild for every
  offline canonical identity mutation;
- A1 mix-confidence and A2 identity/exception views over shared truth;
- resumable guided mic check and one prepared-spare promotion path; and
- protocol, persistence and CI foundations required by those paths.

Gate: named operators complete monitoring, identity, mic-check and single-pack
drills under the signed Phase 1 operator manifest without wrong-source actions
or historical-identity corruption. Cue-
derived automation, complex swaps and collaboration controls remain hidden.

### Phase 1A.2: operate and intervene

- node-side QLab observer and deliberate external/manual authority handover;
- interventions, complex cast plans and the physical-swap identity automaton;
- capability-aware alerts and A2 multi-critical-category visibility;
- structured task/incident lifecycle, ownership and foreground receipts; and
- handoff state, printable fallback and physical-first re-entry.

Gate: cue loss/rebase, 10–20 second pack change, swing cascade, simultaneous
faults, post-hoc physical truth and absent-operator handoff pass timed drills.
The labeled alert gate passes its frozen miss/false-alarm/flood and human-action
thresholds before alerts are relied upon.
There is no chat or product page; working intercom/radio is mandatory.

### Phase 1A.3: recover and rehearse

- exact pruning/backup barrier, compaction recovery, import/export and migration
  hardening (minimum live reconciliation already shipped in 1A.1);
- signed update/rollback, backup/restore, factory recovery and spare procedure;
- OS-sandboxed managed headshot/placement-image pipeline;
- appliance/resource hardening and browser/profile qualification; and
- full timed A1/A2 dress-rehearsal and failure script with working theatre crew.

Gate: an A2 can build, verify, operate, recover, replay, remap and hand off a
representative show; an A1 retains mix/cue focus; scheduled/mid-show understudy
and mic swaps reconcile after backend loss; all assigned RTO/RPO and cold-start,
power, update/rollback and restore tests pass. Approval remains internal rehearsal
or supervised non-critical use, never a show-critical dependency.

## Phase 1B: bounded text collaboration — 6 to 8 weeks

Deliverables:

- performance and incident conversations, text/structured quick messages,
  reactions, contextual links and immutable identity snapshots;
- priority pages with concrete recipient states and intercom/radio reminder;
- object-level conversation authorization, midstream revocation, corrections,
  tombstones, retention and keyset history;
- durable acceptance/outbox, per-conversation ordering, task/incident status
  actions that emit system messages, and shift summaries; and
- combined fan-out/page/reconnect/database/disk/overload evidence on the
  reference appliance.

Exit gate:

- text collaboration cannot affect capture/live/replay deadlines under the
  declared envelope;
- no reaction/read/page state can mutate operational lifecycle;
- accepted messages/pages survive every crash point with correct ordering; and
- object-level negative tests prevent cross-performance/conversation access.

## Phase 1C: rich collaboration — 6 to 10 weeks, optional

Deliverables:

- quarantined image/short-voice attachment processing and safe renditions;
- direct messages only if field research establishes a need;
- optional local transcription, disabled during active performance until its
  resource budget is validated;
- attachment/evidence retention, privacy deletion/redaction and bounded export;
  and
- per-client voice/camera/audio-route compatibility gates.

Exit gate:

- upload/decode/transcription/resource attacks shed before core monitoring;
- recording voice never interrupts or reroutes monitoring on a supported tuple;
- attachment authorization, revocation and browser-cache purge tests pass; and
- the feature is disabled on any client/appliance profile that fails a gate.

## Phase 2: limited field beta — 16 to 24 weeks

Deliverables:

- 128 inputs from DVS Pro on each supported OS/reference profile;
- at least eight independent clients under the combined full-load test;
- full 30-minute/128-input synchronized replay, incident timeline, markers, and
  exports with declared concurrent reader count;
- hardware-validated EW-DX and Shure tuples required by the deliberately chosen
  pilot inventory;
- published appliance, audio-device, browser, network, receiver, and firmware
  compatibility matrices;
- five independent 24-hour full-load soaks and at least 500 aggregate lab hours;
- adversarial security, power-loss, disk, certificate, update, import, and LAN
  tests;
- recovery runbooks, UPS guidance, diagnostics, vulnerability response, and
  supervised pilots on representative productions; and
- measured alert false-positive/missed-event results from labeled rehearsals.

The first supervised pilots are theatre/musical productions. Corporate AV
discovery runs late in the phase and produces the second reference fixture,
without displacing theatre exit gates.

Exit gate:

- all numeric performance, security, compatibility, and recovery gates pass on
  named supported profiles;
- pilot users choose the product for real advisory work while retaining the
  defined conventional fallback;
- support and replacement procedures have been rehearsed; and
- no unresolved severity-one or severity-two defect remains under the published
  severity policy.

## Phase 3: platform — after core operator trust

- complete the documented Shure catalogue and add high-priority Sennheiser,
  Wisycom, Lectrosonics, and Sound Devices families;
- read-only WWB/WSM and Dante inventory reconciliation;
- ShowLink, charger, spectrum, antenna, LTC, additional OSC/MIDI, and console
  integrations beyond the Phase 1A QLab observer;
- adapter SDK and compatibility test kit;
- optional native Pro Listen only if a documented browser gate fails;
- multi-node activation, replay alignment, and client handoff through new ADRs;
- fleet/show templates and support lifecycle; and
- corporate AV workflow validation and pilots before concert/festival or
  broadcast expansion;
- operator-confirmed diagnosis and opt-in model improvement only after a
  labeled evidence base exists.

## Explicit deferrals

Phase 0–2 do not promise simultaneous audio devices, aggregate devices,
multi-node atomic activation, frequency coordination, performer/IEM monitoring,
automatic root-cause diagnosis, or every receiver in the catalogue.

## Staffing and schedule assumption

A credible rehearsal product requires four to six people covering real-time
audio, WebRTC/backend, frontend/product design, device integration,
security/platform, QA/automation, and live-audio validation. Some roles may be
part-time specialists, but their work cannot be omitted. Hardware procurement,
vendor access, field support, and rewrite contingency are schedule dependencies.
Dates are re-estimated after each Phase 0 result rather than preserving a plan
invalidated by evidence.
