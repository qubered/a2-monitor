# ADR 0018: Use Cargo/npm workspaces and native signed installers

- **Status:** Accepted as the implementation baseline; installers remain Phase 0 evidence work
- **Date:** 2026-09-19
- **Owners:** Release/signing custodian; platform/security owner
- **Supersedes:** None

## Context

The repository needs repeatable Windows/macOS builds without inventing a large
meta-build before code exists. Production installation must access native audio
devices in the logged-in show user's session, serve a local web application,
start predictably and remain installable offline with verified signatures.

## Decision

Use a Cargo workspace for Rust crates and npm workspaces for backend, web and
shared TypeScript packages. Commit `Cargo.lock` and `package-lock.json`. Pin the
exact Rust, Node and npm patch used for every release. Do not add pnpm, Nx, Turborepo,
Bazel, containers or a cross-language task runner until measured repository
scale requires one.

The default quality tools are:

- Rust formatting, Clippy, native unit/integration tests, property tests,
  parser fuzzing, concurrency-model tests, sanitizers where supported and
  microbenchmarks;
- TypeScript strict checking, ESLint and Vitest for backend/web packages;
- Playwright across Chromium, WebKit and Firefox for browser workflows;
- generated-contract dirty-diff and cross-language golden-vector tests; and
- the existing signed evidence manifests for hardware, latency, soak and
  operator promotion.

Keep the existing dependency-light Node test runner for repository contract and
cryptographic verifier tests until migration provides a concrete benefit.

Use signed MSI/Burn packages on Windows and signed, hardened,
notarized/stapled flat installer packages on macOS. WiX v7 is only the reference
authoring implementation after explicit OSMF/EULA/commercial approval; a
  supported commercial MSI authoring product or reviewed direct Windows
  Installer implementation is the fallback. Inno Setup is not represented as
  an MSI replacement. The
installer provisions immutable version slots, separate data directories,
certificates, firewall policy, logs, repair/uninstall and a dedicated show-user
startup mechanism.

Ship a pinned Node runtime, compiled application JS/static assets and the
adjacent signed native SQLite addon. Node SEA is not the initial package form.
Release/evidence builds have no public-network access, forbid CPAL's automatic
ASIO SDK download and consume licensed/checksummed native inputs from controlled
storage. Exact Node/npm/.NET/LLVM/protoc/native-source hashes appear in release
provenance.

The Phase 0 reference builds are Windows 11 x86-64 and Apple-silicon macOS on
exact in-support OS builds. macOS x86-64 and Windows ARM64 remain build-design
targets but are not support claims until their own HIL profiles pass. DVS on
Windows ARM64 is explicitly excluded while Audinate does not support it; a
future non-DVS USB profile can be evaluated independently.

Run the audio-node supervisor in the logged-in show user's session: a logon-
triggered task on Windows and LaunchAgent on macOS. The initial readiness model
requires that account to be logged in; operating-system boot alone is not audio
readiness. A backend helper may run as a service/daemon only after session,
authority and update tests prove the split.

The initial supported profile uses manual show-user login. Power-to-login-ready
and login-to-audio-ready are separate measurements; the 120-second recovery
target begins after login. Controlled autologin requires a separate managed-
appliance security profile.

Node and backend have independent supervisors. Updates are stopped-state
administrative operations over immutable application slots and an atomic,
ACL-protected activation record; mutable data is outside the slots. The previous
compatible version remains available until health confirmation. The updater
vendor/CDN is deferred, not these invariants. See
[the process/update lifecycle](../architecture/process-and-update-lifecycle.md).

## Consequences

### Positive

- Each ecosystem keeps its standard build, lockfile and diagnostics.
- Native installers can configure machine/session integration explicitly and
  support offline repair.
- Browser tests and OS-native builds run on the same three-OS CI model already
  used by repository contracts.
- The audio process runs where ASIO/Core Audio user-session behavior can be
  validated honestly.

### Negative

- Release engineering needs both Windows signing/WiX and Apple Developer ID/
  notarization infrastructure.
- Current WiX releases have an Open Source Maintenance Fee/EULA; use is blocked
  until its legal/commercial terms are approved, with another supported MSI
  authoring tool as the fallback.
- A dedicated show account must be logged in for the version-one audio profile.
- Unattended power recovery is not claimed by the manual-login profile.
- npm and Cargo orchestration is less centralized than a large monorepo tool.
- Signed installer/update and rollback tests require protected hardware and
  credentials outside ordinary pull-request CI.

## Alternatives considered

- **pnpm:** efficient and capable, but adds a package manager before repository
  scale demonstrates a need.
- **Nx/Turborepo/Bazel:** defer until caching or dependency-graph evidence
  outweighs configuration and supply-chain cost.
- **MSIX:** useful for enterprise management but introduces capability and OS-
  version differences for machine integration; revisit after MSI evidence.
- **Windows Service/LaunchDaemon for audio:** wrong initial session model for a
  user audio endpoint; retain only for user-independent helpers.
- **Docker/Kubernetes:** poor production fit for local pro-audio device/session
  access and offline appliance recovery. Containers may be used for isolated
  development tools, not the audio runtime.

## Validation

- Build, install, upgrade, roll back, repair and uninstall on clean supported
  Windows and macOS machines without internet access.
- Power-cut every slot installation, activation, health-confirmation, schema and
  rollback boundary; an active performance must reject update attempts.
- Verify signed binaries, notarization/stapling, ACLs, firewall bindings, data
  preservation and complete executable inventory.
- Exercise login/logout, lock/unlock, sleep/wake, crash/restart and audio-device
  permission behavior for the show account.
- Prove current/previous node-backend and schema pairs before an update and
  restore the previous signed version on failure.
- Emit SBOM, licence inventory, checksums and provenance for every release
  artifact.
