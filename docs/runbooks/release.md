# Release runbook

**Status:** Baseline; automation to be added with the first runnable build

## Preconditions

- Scope is frozen and changelog entries are complete.
- Required reviews and all checks pass.
- Dependency and license changes are reviewed.
- Supported hardware/browser compatibility tests pass.
- Performance, soak, restart, reconnect, and rollback tests pass.
- Upgrade and downgrade paths preserve the active show safely.
- No real credentials or production data exist in release artifacts.

## Build

- Build from a clean, tagged commit using pinned toolchains.
- Produce separate, versioned audio-node, backend, and frontend artifacts.
- Generate checksums and a software bill of materials.
- Sign packages and the update manifest.
- Record source commit, toolchains, dependencies, and build environment.

## Staged rollout

1. Synthetic lab.
2. Hardware-in-loop lab.
3. Internal rehearsal rig.
4. Supervised non-critical production.
5. Limited pilot customers.
6. General availability only after the pilot exit criteria pass.

Do not perform an untested upgrade immediately before doors or during a show.

## Rollback

- Keep the previous signed version locally available.
- Back up show metadata before migration.
- Never require rollback to rewrite replay media in the audio callback path.
- Verify that node/backend protocol compatibility supports the rollback pair.
- Record the outcome and attach sanitized diagnostics to the release issue.
