# Repository instructions for coding agents

These rules apply to the entire repository. A more specific `AGENTS.md` may
add constraints inside a subdirectory but may not weaken the safety or quality
requirements below.

## Before changing code

- Read `README.md`, `docs/README.md`, and the relevant architecture documents.
- Check `docs/decisions` for decisions that constrain the work.
- Inspect the working tree and preserve unrelated user changes.
- If a change introduces a framework, persistent service, wire protocol,
  database, or deployment dependency, add or update an ADR.

## Architectural invariants

- The browser never connects directly to Dante or to wireless receiver APIs.
- The headless audio node owns capture, real-time DSP, replay timing, and
  personal monitor mixes. It has no general-purpose management UI.
- The backend owns shows, users, mappings, policy, orchestration, and WebRTC
  signaling. It does not enter the sample path.
- Manager talks to the backend for management. Live uses the backend for state,
  signaling, and authorization, then may send only signed-lease-approved
  listen/replay, cue, verification, and activated-pool emergency-swap commands
  and receive media directly from the selected node.
- Live-show operation must not import Manager-only screens or dependencies.
- UI, database, network, logging, and receiver operations cannot execute on
  the real-time audio callback.
- Cross-component messages use versioned contracts from `packages/protocol`.
- Vendor-specific semantics remain in `integrations`. Hardware-facing adapters
  run at the audio-node boundary when they require access to the local device
  network; only normalized state crosses to the backend.
- Core show operation works without internet access.
- The audio engine opens exactly one explicit ASIO/WASAPI/Core Audio device at
  a time; device switching is never automatic.
- Network-facing media, replay, and vendor adapters remain outside the
  real-time engine's process/privilege domain.

## Real-time audio rules

Inside an audio callback or equivalent real-time path:

- no heap allocation or deallocation;
- no locks, blocking waits, filesystem access, DNS, or network calls;
- no unbounded work or container growth;
- no synchronous logging;
- use preallocated buffers and lock-free handoff where practical;
- surface underruns, overruns, and clock discontinuities as metrics.

Any exception requires an ADR plus a benchmark demonstrating that the risk is
acceptable.

## Change discipline

- Keep commits and pull requests narrowly scoped.
- Do not mix mechanical refactors with behavior changes.
- Add tests for new behavior and a regression test for every bug fix when
  feasible.
- Update docs in the same change when behavior, a contract, operations, or a
  user workflow changes.
- Never commit secrets, receiver passwords, certificates, show recordings,
  customer data, generated build output, or licensed SDK binaries.
- Generated files must identify their source and regeneration command.

## Verification

- Run `./scripts/check-repo.sh` before handoff.
- Run all checks owned by the changed component.
- For audio or networking changes, report the benchmark or soak-test setup and
  results; "sounds fine" is not verification.
- Do not weaken a performance threshold merely to make a check pass. Document
  and investigate regressions.

## Documentation style

- Prefer short, direct Markdown.
- Record durable decisions as ADRs, not only in pull-request discussion.
- Mark assumptions, targets, and verified measurements distinctly.
- Use UTC ISO 8601 timestamps in machine data; local time may be shown in UI.
