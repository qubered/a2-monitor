# Repository instructions for coding agents

These rules apply to the entire repository. A more specific `CLAUDE.md` may
add constraints inside a subdirectory but may not weaken the safety or quality
requirements below.

## Before changing code

- No planning ceremony: there are no phase tracking issues, roadmaps,
  evidence ledgers, ADRs, or design-doc sign-off to create, update, or wait on.
  Just build the change, run it, and see if it works.
- For UI or UX work, look at the shipped Live and Manager apps directly — they
  are the reference, not a spec document.
- Inspect the working tree and preserve unrelated user changes.

## UI and UX design

- The shipped Live and Manager apps are the visual and interaction reference.
  Match their existing look rather than introducing a new one.
- Pulse is dark-mode only; don't add a light/Paper theme or a theme switch.
- Preserve the honesty grammar for observed, inferred, stale, and unknown data.
  Never render unknown as zero or healthy, distinguish human-authored notes
  from machine measurements, and keep RF level separate from link quality.
- Keep audio safety controls visible: mute and dim remain one touch away, and
  listening starts unmuted.
- Treat touch as the primary input while preserving full keyboard operation.
  Never make hover, precise dragging, colour, sound, or motion the only way to
  understand or complete an action.
- Verify UI changes by running the actual app and looking at it — that's the
  check, not a document.

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

Any exception must be justified in the PR description with a benchmark
demonstrating that the risk is acceptable.

## Change discipline

- Keep commits and pull requests narrowly scoped.
- Do not mix mechanical refactors with behavior changes.
- Add a test for new behavior or a bug fix when it's cheap to do so.
- Never commit secrets, receiver passwords, certificates, show recordings,
  customer data, generated build output, or licensed SDK binaries.
- Generated files must identify their source and regeneration command.

## Verification

- Run `./scripts/check-repo.sh` and the checks owned by the component you
  changed before opening a PR.
- Test by running the app against real or synthetic input, not by writing
  more documentation about it; "sounds fine"/"looks fine" without having run
  it is not verification.
