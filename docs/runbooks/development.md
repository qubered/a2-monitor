# Development runbook

## Repository setup

The selected toolchains are Node.js 24 LTS with npm and the repository-pinned
stable Rust toolchain with Cargo, rustfmt and Clippy. Until runnable workspaces
are scaffolded, the existing contract checks still require only Node/npm, Git
and a POSIX shell.

```sh
git status --short --branch
./scripts/check-repo.sh
```

Component READMEs own their exact setup and checks. The root may expose thin
orchestration scripts once at least two real components need them, but it must
not hide the underlying Cargo/npm commands or hardware evidence profile.

The intended workspace commands after scaffolding are:

```sh
npm ci
npm run check --workspaces --if-present
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

ASIO builds additionally require the reviewed Steinberg SDK/licensing path and
LLVM/Clang documented by the selected CPAL version. Do not download an SDK from
a build script in release CI.

## Local topology

Development must support both:

1. **single host:** audio node, backend, and frontend on one workstation; and
2. **split host:** audio node beside hardware, backend/frontend on another host.

Use synthetic devices by default. Access to real Dante and receiver networks
must be explicit, and test credentials belong in an ignored local secret store.

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

## Test artifacts

Write generated recordings, packet captures, performance reports, databases,
and logs only to ignored directories such as `recordings`, `captures`, or
`reports`. Share approved large artifacts through the future artifact store,
not normal Git history.
