# Development runbook

## Repository setup

The selected toolchains are Node.js 24 LTS with npm and the repository-pinned
stable Rust toolchain with Cargo, rustfmt and Clippy. The Manager, Live and
minimal backend npm workspaces are runnable. The root Cargo workspace contains
the first project-owned audio-host boundary, bounded in-process PCM ring and
deterministic synthetic audio node. They are scaffolding, not hardware evidence.

```sh
git status --short --branch
./scripts/check-repo.sh
```

The repository check includes the non-promotional evidence-verifier
conformance suite. Run it directly while changing verifier code:

```sh
node --test tools/evidence/*.test.mjs
```

A passing conformance run proves parser/verifier behavior only. It cannot be
attached as Phase 0 product evidence.

Component READMEs own their exact setup and checks. The root may expose thin
orchestration scripts once at least two real components need them, but it must
not hide the underlying Cargo/npm commands or hardware evidence profile.

Current npm workspace commands are:

```sh
npm ci
npm run check --workspaces --if-present
```

Run the whole local stack against a physical input with
`A2_AUDIO_DEVICE="Exact device name" npm run dev`, or without hardware with:

```sh
npm run dev:simulate
```

Simulate mode starts the backend, listen gateway, Live, Manager and a
development Shure AD4Q double, opens the built-in `Pulse test signal` source and
seeds a demo show in `data/simulated` (never your normal `data` directory). It
exercises every monitoring verdict and alert kind: battery drain, RF dips,
interference, transmitter loss and mute, clipping, silence and dropout. Nothing
it produces is evidence about real equipment.

Public health/snapshot TypeScript artifacts are generated from the closed JSON
Schemas. Regenerate after changing either schema and verify freshness before
handoff:

```sh
npm run generate --workspace @rvlt/pulse-protocol
npm run generate:check --workspace @rvlt/pulse-protocol
```

The generated file is committed for frontend/backend consumers and must retain
its source paths and regeneration command. The repository gate fails when it
does not exactly match generator output.

Run the Rust workspace checks with:

```sh
cargo metadata --locked --format-version 1 --no-deps
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo run --locked --bin a2-synthetic-capture
cargo run --locked --bin a2-supervisor-smoke
cargo run --locked --bin a2-replay-smoke
```

The supervisor smoke binary exercises the platform-neutral policy with a
recording process adapter. It does not create restricted children. Platform
adapters must preserve the node boot ID and monotonically increasing worker
generations, provide role-specific readiness evidence, emit sequenced
heartbeats, and route process exits back to the state machine. A
force-termination adapter must not return success until death is confirmed.
After the finite termination-retry budget, operators see `TerminationStuck` and
must not launch a replacement while the retained handle may be live. Quarantine
release is always an explicit action. The smoke topology is intentionally
partial and is not a deployable node profile.

Pull requests also run scaffold-portability jobs on GitHub-hosted
`windows-2025` x64 and `macos-15` arm64 runners. These jobs record the hosted
image identity, repeat the npm and Cargo checks, run the Cargo-only smokes and
exercise the platform layout/package harnesses. They are portability checks,
not the named-host clean-checkout evidence required by Phase 0T: the Windows
runner is not the required Windows 11 profile, and the hosted Apple-silicon
runner is not a nominated reference Mac. The jobs do not install an MSI/pkg,
open an audio device, verify confinement, or support a release claim.

Start the web development servers with:

```sh
npm run dev --workspace @rvlt/pulse-backend
npm run dev --workspace @rvlt/pulse-live
npm run dev --workspace @rvlt/pulse-manager
```

The backend binds to `127.0.0.1:3000`; Vite proxies `/api` from
`127.0.0.1:4173`, while the disconnected Manager shell binds to
`127.0.0.1:4174`. Current application data is fabricated and must remain
labelled as such.

ASIO builds additionally require the approved proprietary Steinberg SDK path,
recorded checksum/provenance, LLVM/Clang documented by the selected CPAL
version, and an explicit `CPAL_ASIO_DIR`. Do not download an SDK from a build
script. Evidence/release builds run with public-network access disabled and
must fail if a required controlled input is absent.

The first packaged backend is a pinned Node 24 patch plus compiled JavaScript,
static assets and an adjacent signed `better-sqlite3` addon; it is not Node
SEA. Fastify is pinned at 5.12.2 or newer in major 5 and receives an explicit
strict, non-mutating Ajv 2020 compiler. Release provenance records toolchain,
SDK, native source, lockfile and installer hashes.

## Local topology

Development must support both:

1. **single host:** audio node, backend, and frontend on one workstation; and
2. **split host:** audio node beside hardware, backend/frontend on another host.

Use synthetic devices by default. Access to real Dante and receiver networks
must be explicit, and test credentials belong in an ignored local secret store.
The supported startup profile requires manual login to the nominated show
account. Tests report `awaiting-show-user` before login rather than treating OS
boot as audio readiness.

## Adding a component dependency

Before adding a production dependency:

- identify the capability it provides;
- check license and redistribution terms;
- assess real-time, binary-size, update, and security impact;
- pin it through the component's package manager; and
- add an ADR if it establishes a framework or runtime boundary.

Never vendor Dante/vendor SDK binaries or credentials into Git.

Production dependencies use exact lockfile resolution. Rust and Node toolchain
changes, CPAL/`str0m`/Opus/SQLite changes and native package changes require
their relevant Phase 0 regression evidence, not only a successful compile.

`str0m` is built with default features disabled. The baseline crypto feature is
`apple-crypto` on macOS and `wincrypto` on Windows; any fallback is explicit in
the build profile and evidence manifest.

## Test artifacts

Write generated recordings, packet captures, performance reports, databases,
and logs only to ignored directories such as `recordings`, `captures`, or
`reports`. Share approved large artifacts through the future artifact store,
not normal Git history.
