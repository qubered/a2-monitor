# Development runbook

## Repository setup

The selected toolchains are Node.js 24 LTS with npm and the repository-pinned
stable Rust toolchain with Cargo, rustfmt and Clippy. The Live npm workspace is
runnable; native and backend workspaces have not been scaffolded yet.

```sh
git status --short --branch
./scripts/check-repo.sh
```

Component READMEs own their exact setup and checks. The root may expose thin
orchestration scripts once at least two real components need them, but it must
not hide the underlying Cargo/npm commands or hardware evidence profile.

Current npm workspace commands are:

```sh
npm ci
npm run check --workspaces --if-present
```

The intended Rust workspace commands after native scaffolding are:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Start the Live development server with:

```sh
npm run dev --workspace @a2-monitor/live
```

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
