# Dependency and licence inventory

**Status:** Implemented for the current npm workspace; legal approvals remain
open.

The current runnable repository consists of the Live application, the minimal
Fastify backend, and shared UI/protocol packages. Its third-party npm graph is recorded in
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

## Accountable roles and blockers

No person has yet been assigned to the project roles below. `Unassigned` is a
blocking state, not an implicit assignment to the contributor who added a
dependency.

| Input or decision                                                   | Accountable role          | Current assignee | State and release effect                                                                                                       |
| ------------------------------------------------------------------- | ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Current npm dependency graph and licence review                     | Platform/security owner   | Unassigned       | **Blocked for external pilot/release.** Inventory generation is implemented; compatibility and notice review are not approved. |
| Third-party notices for npm packages and bundled fonts              | Release/signing custodian | Unassigned       | **Blocked for distribution.** Generate notices only after licence-text review.                                                 |
| Project software licence and contribution terms                     | Product owner             | Unassigned       | **Blocked for public release and external contributions.** The repository remains all rights reserved.                         |
| Proprietary Steinberg ASIO SDK route and `CPAL_ASIO_DIR` provenance | Platform/security owner   | Unassigned       | **Blocked for ASIO evidence and packaging.** No SDK or headers are stored here.                                                |
| WiX EULA/commercial approval or alternate MSI authoring tool        | Product owner             | Unassigned       | **Blocked for Windows packaging.** No tool choice is approved.                                                                 |
| Future Cargo dependency graph, native libraries and codec notices   | Audio runtime owner       | Unassigned       | **Not yet applicable; blocked before the first native dependency lands.** There is no Cargo workspace on `main`.               |

The independent reviewers remain those in
[`repository-governance.md`](repository-governance.md): release/signing review
for platform and security decisions, and the relevant domain owner for evidence
changes. Before a public release, replace role-only ownership with named people
in the release record and complete the project-licence and third-party-notice
decisions.

## Scope limits

This inventory intentionally covers only dependencies present in the committed
npm lockfile. The backend entry covers its current Fastify/Ajv health and
fabricated-snapshot skeleton only. It does not claim that the planned Rust,
native audio, installer, ASIO, Opus, SQLite, `str0m`, receiver SDK or hardware
inputs exist or have been approved. Add each new ecosystem or proprietary input
to this process when runnable code introduces it; do not pre-approve the planned
stack.
