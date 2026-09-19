# Contributing

## Workflow

1. Start from an up-to-date `main` branch.
2. Create a short-lived branch such as `feat/ewdx-discovery`,
   `fix/replay-clock`, or `docs/latency-method`.
3. Keep changes small enough to review and roll back safely.
4. Run repository and component checks locally.
5. Open a pull request using the repository template.
6. During the single-maintainer pre-pilot phase, record a deliberate self-review
   in the pull request; a second GitHub approval is not required. When another
   qualified maintainer is active—or before any external pilot—restore required
   independent review. Audio and security-sensitive changes still carry their
   domain evidence and sign-off gates before a support or release claim.
7. Merge only with passing checks and resolved review comments.

Direct commits to `main` should be disabled once the repository is hosted.
Use squash merge by default so one pull request produces one coherent commit.
See [repository governance](docs/quality/repository-governance.md) for protected
branch, severity, compatibility, dependency, and licensing policy.

## Commits

Use Conventional Commit subjects:

```text
feat(audio): add per-client monitor bus
fix(ewdx): preserve channel binding after rediscovery
docs(adr): choose WebRTC for browser monitoring
test(replay): cover clock discontinuity recovery
```

Use an imperative subject, explain why in the body when it is not obvious, and
reference the issue or ADR when relevant.

## Pull requests

A pull request should include:

- the user or operational problem;
- the chosen approach and meaningful alternatives;
- risk and rollback notes;
- tests performed;
- measurements for latency, CPU, memory, network, or reliability changes; and
- screenshots or recordings for visible UI changes.

Draft pull requests are encouraged for early architectural feedback. A pull
request is ready only when it meets the
[definition of done](docs/quality/definition-of-done.md).

## Decisions

Create an ADR from `docs/decisions/0000-template.md` when a change establishes
or reverses a difficult-to-change decision. Examples include:

- language or framework selection;
- audio driver and Dante integration strategy;
- WebRTC implementation;
- persistent storage;
- process boundaries and IPC;
- wire formats and compatibility policy;
- supported operating systems and browsers; and
- security or update mechanisms.

## Releases

Use semantic versioning once the first externally tested build exists. Until
then, use dated internal builds. Follow `docs/runbooks/release.md` and maintain
`CHANGELOG.md` for operator-visible changes.

## Security and privacy

Follow `SECURITY.md` and `docs/quality/security-baseline.md`. Use synthetic or
explicitly approved audio in tests. Treat show audio, talent images, notes,
device identifiers, and credentials as sensitive production data.
