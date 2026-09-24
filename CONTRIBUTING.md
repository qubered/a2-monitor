# Contributing

## Workflow

1. Branch from an up-to-date `main` (`feat/…`, `fix/…`, `docs/…`).
2. Build the change. Keep it small enough to review and roll back.
3. Run `./scripts/check-repo.sh` and the checks for the component you touched.
4. Open a pull request and squash-merge once checks pass.

See [repository governance](docs/quality/repository-governance.md) for
dependency and licensing policy.

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

Say what changed, how you tested it, and add screenshots for visible UI
changes. Draft pull requests are fine for early feedback.

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
