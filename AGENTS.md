# Repository instructions for coding agents

These rules apply to the entire repository. A more specific `AGENTS.md` may
add constraints inside a subdirectory but may not weaken the safety or quality
requirements below.

## Before changing code

- Read `README.md`, `docs/README.md`, and the relevant architecture documents.
- Check `docs/decisions` for decisions that constrain the work.
- For roadmap or phase work, locate the open GitHub tracking issue for that
  phase before changing code. Read the full issue and every linked prerequisite,
  record the issue number in the branch or pull request, and update its progress,
  evidence, decisions and remaining work before handoff. If no tracking issue
  exists, create one from the phase-tracking template before implementation.
- Treat the repository documents as the durable source of truth and the phase
  issue as the current execution ledger. When they disagree, stop, reconcile
  the repository documentation in the same change, and explain the resolution
  on the issue; do not silently follow stale issue text.
- For UI or UX work, read `docs/design/DESIGN.md` in full, inspect the relevant
  rendered states in `docs/design/mockups`, and use the reference build in
  `docs/design/prototype/index.html` before proposing or implementing a design.
- Inspect the working tree and preserve unrelated user changes.
- If a change introduces a framework, persistent service, wire protocol,
  database, or deployment dependency, add or update an ADR.

## UI and UX design

- Treat `docs/design/DESIGN.md` as normative for visual language, interaction,
  components, and product surfaces. Follow its referenced RVLT design language
  where required; do not create a parallel design system.
- Use the rendered states in `docs/design/mockups` as the visual targets and
  `docs/design/prototype/index.html` as the canonical interactive reference.
  When they disagree, the prototype wins and the rendered image is stale.
  Reproduce their information hierarchy, component behavior, terminology, and
  interaction flow. Do not derive production UI from earlier or experimental
  prototypes unless `docs/design/DESIGN.md` explicitly points to them.
- Treat mockup data as illustrative. Preserve the domain model, permissions,
  versioned contracts, and architectural boundaries defined elsewhere in this
  repository. If an architectural or safety requirement conflicts with the
  design source, document the discrepancy and request a decision instead of
  silently improvising.
- Design for a one-second operational glance before a detailed investigation.
  Keep cards sparse and put diagnostic depth in detail surfaces. Show every
  independently failing status dimension so one fault never hides another.
- Preserve the honesty grammar for observed, inferred, stale, and unknown data.
  Never render unknown as zero or healthy, distinguish human-authored notes from
  machine measurements, and keep RF level separate from link quality.
- Use design tokens and the locked type, colour, spacing, shape, elevation,
  icon, and motion rules from `docs/design/DESIGN.md`. Components must not
  introduce raw visual values. Paper is the default surface, dark mode is a
  first-class theme, and both must be tested.
- Keep the documented refusals: no gradients, glow, glass effects, decorative
  motion, emoji status icons, stock portraits, animated loading shimmer, or
  enthusiastic filler copy. Use short, specific, present-tense language with
  units, time references, and explicit uncertainty.
- Preserve the distinction between Manager and Live. Live UI must remain
  show-focused, resilient offline, and free of Manager-only screens and
  dependencies.
- Treat touch as the primary input while preserving full keyboard operation.
  Meet the documented target sizes, spacing, focus, semantic-control, contrast,
  and reduced-motion rules. Never make hover, precise dragging, colour, sound,
  or motion the only way to understand or complete an action.
- Keep audio safety controls visible: listening starts muted, and mute and dim
  remain one touch away. Make replay unmistakable, keep a one-action return to
  live visible, and retain current critical alerts while viewing the past.
- Implement the specific empty, loading, stale, degraded, offline, error, and
  permission states defined by the design language. Name what the product is
  waiting for or no longer knows; never imply unavailable work was completed.
- Verify UI changes against the canonical mockup at representative target
  viewports in both Paper and dark themes. Include screenshots or equivalent
  visual-regression evidence and run accessibility, touch, keyboard, and
  interaction checks before handoff.
- When changing the design reference itself, regenerate `docs/design/mockups`
  with `node scripts/render-mockups.mjs`; do not edit the generated PNGs by
  hand. Verify that the script used the real fonts before committing output.
- The current design language is proposed rather than field-validated. Record
  conformance separately from operator validation and do not claim that a UI is
  validated without named A1/A2 testing and evidence.

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
- Link every phase implementation pull request to its phase tracking issue and
  check off only work supported by committed code or named evidence. A green CI
  build alone does not close a hardware, performance, security or operator gate.
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
