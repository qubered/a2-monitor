# Pulse

> Pulse by RVLT — an on-premises, browser-operated audio and wireless
> monitoring platform for A2s and live audio engineers.

Pulse combines multichannel Dante audio, wireless receiver telemetry,
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

Pre-release and moving fast. The stack is Rust for the native audio node,
TypeScript/Node/Fastify for the backend, React/Vite for Live and Manager, and
SQLite for local authority. Build the change, run it, and see if it works —
see [AGENTS.md](AGENTS.md) for the (short) list of things that aren't up for
grabs: real-time audio safety and the component boundaries below.

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
| `tools/evidence` | Non-promotional evidence-verifier conformance tooling |
| `tests` | Cross-component, hardware-in-loop, soak, and performance tests |
| `docs` | Product, architecture, research, decisions, and runbooks |

See [the documentation index](docs/README.md) for what's left. Contributors and
coding agents must also follow [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md).

The default deployment may place all four components on one appliance, but
their boundary is deliberate:

1. the audio node is hardware-adjacent and minimally managed;
2. the backend owns configuration, auth, and show state;
3. the Manager web app builds and administers shows; and
4. the Live web app is the focused operator surface.

## Development

The Live workspace uses the proposed React/Vite stack and requires the pinned
Node.js version. Its first local slice can be started with:

```sh
npm ci
npm run dev --workspace @rvlt/pulse-live
```

Run all current checks with:

```sh
./scripts/check-repo.sh
npm run check
```

## License

No public software license has been selected. Until that decision is recorded,
all rights are reserved. Do not copy third-party source code, schemas, assets,
or proprietary algorithms into this repository without documented permission.
