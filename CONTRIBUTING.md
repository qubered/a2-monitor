# Contributing

## Workflow

1. Branch from an up-to-date `main` (`feat/…`, `fix/…`, `docs/…`).
2. Build the change. Keep it small enough to review and roll back.
3. Run `./scripts/check-repo.sh` and the checks for the component you touched.
4. Open a pull request and squash-merge once checks pass.

No ADR, roadmap, or evidence-ledger step is required — see CLAUDE.md.

## Commits

Use Conventional Commit subjects:

```text
feat(audio): add per-client monitor bus
fix(ewdx): preserve channel binding after rediscovery
test(replay): cover clock discontinuity recovery
```

Use an imperative subject and explain why in the body when it is not obvious.

## Pull requests

Say what changed, how you tested it, and add screenshots for visible UI
changes. Draft pull requests are fine for early feedback.

## Releases

Use semantic versioning once the first externally tested build exists. Until
then, use dated internal builds. Maintain `CHANGELOG.md` for operator-visible
changes.

## Security and privacy

Follow `SECURITY.md`. Use synthetic or explicitly approved audio in tests.
Treat show audio, talent images, notes, device identifiers, and credentials as
sensitive production data.
