# A2 Monitor

> Working title for an on-premises, browser-operated audio and wireless
> monitoring platform for A2s and live audio engineers.

A2 Monitor combines multichannel Dante audio, wireless receiver telemetry,
low-latency personal listening, synchronized replay, and explainable alerts.
The browser is the operator surface; a native service on the appliance owns
all real-time audio work.

The Live app provides distinct A1 and A2 workspaces over the same source,
performer, cue, task and incident truth. Contextual chat supports coordination,
but explicit task/incident state remains the authority for operational work.

The first reference production is theatre and musical theatre. Corporate AV is
the second product profile after the theatre workflow is proven.

The theatre model treats people, characters, understudies, microphone elements,
transmitters, receiver paths, audio inputs, headshots and cues as independent,
time-bounded records. Show-time swaps and cue state use the same documented
local API as the web applications so historical replay keeps the correct
identity.

## Project status

The project is in **discovery and technical validation**. The first milestone
is a measured cross-platform vertical slice using one Windows or macOS audio
device, WebRTC, Sennheiser EW-DX, and a representative Shure rack receiver. DVS
is an important device profile, not a special-case architecture. The
implementation baseline is now Rust/CPAL/`str0m`/`libopus` for the native node,
TypeScript/Node/Fastify for management, React/Vite for Manager and Live, and
SQLite for local authority. CPAL and `str0m` remain hardware/browser evidence-
gated rather than being treated as proven by selection alone.

## Product principles

1. **Show reliability comes first.** A clever feature is never worth an audio
   dropout or an unstable control surface.
2. **Measure latency; do not estimate it.** Performance claims must include
   the hardware, browser, network, percentile, and test method.
3. **Keep real-time audio isolated.** The audio callback must never wait on a
   browser, database, network request, allocator, or log sink.
4. **Explain problems, not just values.** RF, audio, battery, and operator
   events should converge into a useful diagnosis.
5. **Offline during the show.** Core monitoring must not depend on a public
   cloud service or internet connection.
6. **Secure by default.** Receiver credentials stay on the appliance and
   modern authenticated protocols are preferred.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/manager` | Management and show-building web application |
| `apps/live` | Focused browser/PWA application used during a show |
| `services/audio-node` | Headless process beside DVS/USB audio and receivers |
| `services/backend` | Shows, users, mappings, orchestration, API, and signaling |
| `integrations` | Vendor-specific hardware adapters |
| `packages/protocol` | Versioned contracts shared across components |
| `packages/ui` | Reusable presentation components and design tokens |
| `infra/appliance` | Appliance packaging, networking, certificates, updates |
| `tests` | Cross-component, hardware-in-loop, soak, and performance tests |
| `docs` | Product, architecture, research, decisions, and runbooks |

Read [the documentation index](docs/README.md) first. Contributors and coding
agents must also follow [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md).

## Near-term milestone

The initial spike must prove:

- stable 32–64 channel capture from one selected ASIO/WASAPI/Core Audio device
  on Windows and macOS, including DVS and a representative hardware interface;
- independent, uninterrupted server-side monitor mixes;
- WebRTC/Opus playback in target browsers;
- measured wired and Wi-Fi capture-to-ear latency;
- foreground screen-awake client, camera/microphone/notification audio-route
  tests and explicit native-client trigger;
- secure EW-DX discovery, authentication, and live telemetry;
- Shure command-string discovery, capability negotiation, and live telemetry
  on a selected physical receiver;
- active-node authority/control-ledger partition tests, a read-only QLab cue
  observer spike, and combined collaboration/attachment overload shedding; and
- a 12-hour run without an audio callback underrun.

The default deployment may place all four components on one appliance, but
their boundary is deliberate:

1. the audio node is hardware-adjacent and minimally managed;
2. the backend owns configuration, auth, and show state;
3. the Manager web app builds and administers shows; and
4. the Live web app is the focused operator surface.

See the [roadmap](docs/product/roadmap.md) and
[performance baselines](docs/quality/performance-baselines.md).

## Development

There is deliberately no root product build command until the selected
workspaces contain runnable components. The stack, alternatives and
falsification gates are recorded in
[technology stack selection](docs/research/technology-stack-selection.md) and
ADRs 0014–0018. The repository-level check is:

```sh
./scripts/check-repo.sh
```

## License

No public software license has been selected. Until that decision is recorded,
all rights are reserved. Do not copy third-party source code, schemas, assets,
or proprietary algorithms into this repository without documented permission.
