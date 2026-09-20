# Dependency and licence inventory

**Status:** Implemented locked-component metadata inventories for the current
npm and Cargo workspaces; legal approvals remain open.

The current runnable repository consists of the independent Manager and Live
applications, the minimal Fastify backend, and shared UI/protocol packages. Its locked third-party npm components are recorded in
[`node-dependency-inventory.json`](node-dependency-inventory.json). The file is
generated from `package-lock.json`; it is an inventory of declared package
metadata, not legal advice or approval to redistribute a package.

Regenerate and verify it with:

```sh
node scripts/generate-node-dependency-inventory.mjs
node scripts/generate-node-dependency-inventory.mjs --check
node --test scripts/generate-node-dependency-inventory.test.mjs
```

The repository check rejects a stale inventory and dependencies whose lockfile
entry has no version or has missing, `UNKNOWN`, or `UNLICENSED` licence
metadata. A dependency change still requires human review of the actual licence
text, notices, source/binary distribution terms, runtime privilege and the
applicable regression evidence. The check does not infer compatibility from an
SPDX expression.

The complete current set of locked Cargo components is recorded in
[`cargo-dependency-inventory.json`](cargo-dependency-inventory.json). It is
generated without network access from `Cargo.lock`, the workspace licence and
the exact-version metadata policy in
`scripts/cargo-license-policy.json`. Regenerate and verify it with:

```sh
node scripts/generate-cargo-dependency-inventory.mjs
node scripts/generate-cargo-dependency-inventory.mjs --check
node --test scripts/generate-cargo-dependency-inventory.test.mjs
```

The generator requires every locked registry package to have an exact-version
policy assertion and a 64-character lockfile checksum. Licence assertions were
transcribed from upstream package metadata, but the offline generator does not
automatically verify them against an upstream registry or licence text. Missing,
`UNKNOWN` and `UNLICENSED` values fail closed, as do stale policy entries.
Source-less lock entries are proprietary only when their exact name/version is
in the workspace allowlist; unknown path packages and stale workspace entries
also fail closed. This is not a licence-text review or approval.

The initial native IPC comparison has these direct third-party Rust
dependencies. The generated inventory also records all of their transitives.
Licence values below are package metadata, not legal approval.

| Direct crate | Locked version | Declared licence      | Owner               | Purpose and update policy                                                                 |
| ------------ | -------------- | --------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `prost`      | 0.14.4         | Apache-2.0            | Audio runtime owner | Phase 0T Protobuf comparison; update manually with golden and unknown-field checks.        |
| `serde`      | 1.0.229        | MIT OR Apache-2.0     | Audio runtime owner | Private JSON comparison DTOs; update manually with all codec and workspace checks.         |
| `serde_json` | 1.0.151        | MIT OR Apache-2.0     | Audio runtime owner | Bounded canonical-JSON candidate; update manually with exact golden and malformed checks.  |

The Cargo metadata inventory is complete for the locked component set. It does
not preserve dependency edges. Human
licence-text, compatibility and notice review remain required before
distribution. No native library or build-time `protoc` binary is introduced by
this scaffold.

## Reproducible build identity

[`build-identity.json`](build-identity.json) lists the exact source inputs and
SHA-256 digests behind the current build identifier. The generator asks Git for
all tracked paths, then hashes sorted paths and their current worktree bytes.
This includes modified-but-unstaged bytes, dotfiles, assets, documentation and
future file types. A new file becomes a build input when it is added to Git; the
Git-index watch makes Cargo rerun the freshness gate at that boundary. The two
generated identity outputs and build-output directories are excluded to avoid
recursion.

```sh
node scripts/generate-build-identity.mjs
node scripts/generate-build-identity.mjs --check
node --test scripts/generate-build-identity.test.mjs
```

`a2-build-info/build.rs` runs the same freshness check on ordinary Cargo builds
and watches every selected input, its parent directories, the generated outputs
and Git index. A stale identity fails with the regeneration command. This build
gate requires the repository-pinned Node.js 24 toolchain; CI configures Node
before repository checks.

The resulting `a2-<version>+sha256.<prefix>` value is independent of wall-clock
time and staging state for already tracked inputs. Modified tracked source bytes
change the content digest directly, so there is no clean/dirty label that can
become ambiguous. `a2-build-info` exposes the full digest, build ID, version,
identity kind and input count to native code; the synthetic capture binary
and supervisor smoke binary print the same ID at startup. This is a reproducible
development identity only. It does not claim a Git commit, signed provenance,
SBOM, legal approval, installer signature or release approval.

## Accountable roles and blockers

No person has yet been assigned to the project roles below. `Unassigned` is a
blocking state, not an implicit assignment to the contributor who added a
dependency.

| Input or decision                                                   | Accountable role          | Current assignee | State and release effect                                                                                                       |
| ------------------------------------------------------------------- | ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Current npm locked components and licence review                    | Platform/security owner   | Unassigned       | **Blocked for external pilot/release.** Inventory generation is implemented; compatibility and notice review are not approved. |
| Third-party notices for npm packages and bundled fonts              | Release/signing custodian | Unassigned       | **Blocked for distribution.** Generate notices only after licence-text review.                                                 |
| Project software licence and contribution terms                     | Product owner             | Unassigned       | **Blocked for public release and external contributions.** The repository remains all rights reserved.                         |
| Proprietary Steinberg ASIO SDK route and `CPAL_ASIO_DIR` provenance | Platform/security owner   | Unassigned       | **Blocked for ASIO evidence and packaging.** No SDK or headers are stored here.                                                |
| WiX EULA/commercial approval or alternate MSI authoring tool        | Product owner             | Unassigned       | **Blocked for Windows packaging.** No tool choice is approved.                                                                 |
| Cargo dependency components, native libraries and codec notices     | Audio runtime owner       | Unassigned       | **Blocked for codec promotion and distribution.** Locked metadata is generated; human licence/notice review remains open.                         |

The independent reviewers remain those in
[`repository-governance.md`](repository-governance.md): release/signing review
for platform and security decisions, and the relevant domain owner for evidence
changes. Before a public release, replace role-only ownership with named people
in the release record and complete the project-licence and third-party-notice
decisions.

## Scope limits

The generated inventories cover only dependencies present in the committed npm
and Cargo lockfiles. They are metadata catalogues, not SBOMs, third-party notice
bundles or legal conclusions. The backend entry covers its current Fastify/Ajv
health and fabricated-snapshot skeleton only. The Rust workspace does not open
a physical audio device. Nothing here claims that an installer, ASIO, Opus,
SQLite, `str0m`, receiver SDK or hardware input has been approved. Add each new
ecosystem or proprietary input to this process when runnable code introduces
it; do not pre-approve the planned stack.
