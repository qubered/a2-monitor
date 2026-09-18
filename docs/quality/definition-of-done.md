# Definition of done

A change is done only when every applicable item is true.

## Behavior

- Acceptance criteria are satisfied on the intended deployment profile.
- Failure, reconnect, stale-data, and partial-availability states are handled.
- The change does not create an undocumented management path on the audio node.
- Operator-visible errors say what failed and what action is safe.

## Quality

- Automated tests cover the new behavior and meaningful boundaries.
- A bug fix includes a regression test when technically feasible.
- Repository and component checks pass without suppressing a new warning.
- No new unbounded work, allocation, lock, I/O, or logging occurs on the
  real-time path.
- Resource cleanup and reconnect behavior have been tested.

## Performance and reliability

- Relevant latency, CPU, memory, storage, and network effects are measured.
- Audio changes report callback deadline and underrun results.
- Networking changes report loss/reconnect behavior.
- Performance results name hardware, OS, driver, DVS, browser, topology,
  duration, build, and percentile—not only an average.
- No baseline is weakened without an approved ADR.

## Security and data

- Applicable threat-model cases have named controls and passing test evidence.
- Authorization-denial tests cover every new command and role.
- Credentials and sensitive production data are not logged or committed.
- New persistent data has ownership, retention, export, and deletion behavior.
- External inputs are authenticated where appropriate and validated always.

## Documentation and delivery

- User, architecture, protocol, and runbook docs reflect the change.
- A difficult-to-reverse decision has an ADR.
- Operator-visible changes are added to `CHANGELOG.md`.
- Rollback or disablement is documented for show-critical behavior.
- The pull request is small enough to review with confidence.
- Changes to authentication, authorization, protocol, updates, imports, network
  boundaries, or secret handling have security/platform approval.
