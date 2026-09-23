# ADR 0028: Shared mic checks and A1 fault reports for the MVP

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-23
- **Owners:** Project team
- **Supersedes:** None

## Context

Guided mic checks lived in one browser's local storage, so the status strip's
Check cell was always unknown, another A2 could not see a check in progress,
and the A1 could not give the captured-audio verdict the design assigns to
them. The A1 mix-confidence surface (design system §11.2) did not exist, so a
report from the desk still meant a verbal call and an identity translation at
both ends. ADR 0027 made the backend the owner of shared monitoring state;
these two workflows need the same property.

## Decision

For the local MVP only, the backend owns two more pieces of shared state and
publishes them through the ADR 0027 live state:

1. **Mic checks.** `GET /api/v1/checks`, `PUT
   /api/v1/checks/:channelId/dimensions/:dimensionId` and `DELETE` routes
   (`mic-checks` contract). Every verdict records who gave it and when. A
   check records its subject — input patch, receiver channel and performer —
   and becomes stale, and stops counting, when that subject changes; the next
   verdict starts a new check. The live state carries a per-channel summary and
   the Check verdict: unknown until checked or when stale, fault on any fail,
   caution while in progress or waiting on the A1, good only when all eight
   dimensions pass. The A1's captured-audio verdict is given from the A1
   surface. Checks persist to `checks.json`.
2. **Fault reports.** `POST /api/v1/reports` files a report from the A1: the
   channel identity at that moment, one or more of the nine faults in the A1's
   words and an optional short note. `POST /api/v1/reports/:id/actions`
   applies `undo` (ten seconds, open reports only), `urgent`, `claim`,
   `resolve`, `confirm-fixed` and `reopen`. A report is a task until the A1
   marks it urgent or telemetry shows a measured fault on that channel; then it
   is an incident, and resolving it waits for the A1 to confirm the symptom is
   gone. Promotion keeps the request history. The live state carries open
   reports and those closed in the last five minutes; reports persist to
   `reports.json`.

Live gains an A1 role: the grid becomes the mix-confidence surface with no
listen control, pressing a channel opens the report sheet, and the bottom bar
lists open reports and captured-audio check requests. The A2 sees every
unclaimed report as a persistent, dismissible banner that never plays a sound,
and the card pulses its outline until someone claims it. The role is a
per-device presentation preference, not a permission.

## Consequences

### Positive

- The Check cell reflects shared, attributed evidence, and a changed patch or
  performer can no longer inherit an old pass.
- An A1 report reaches every A2 device with the channel, performer, faults,
  time and sender attached, and the A1 can see who has it.

### Negative

- There is no authentication: anyone on the trusted LAN can file, claim or
  resolve as any name (ADR 0026's trust boundary).
- Reports and checks share the backend's fate; the design's node-path
  delivery of reports during a backend outage (design system §12) is not
  implemented, and Live says so rather than queueing silently.
- This is a prototype of Phase 1A.2 task/incident behaviour. It supplies no
  timed-drill, receipt or operator evidence and does not advance that gate.

## Alternatives considered

- **Keep checks device-local.** Rejected: the A1 verdict and a second A2 need
  the same check.
- **Chat-style free text for reports.** Rejected by the design: two presses and
  no typing, with explicit task/incident state as the authority.

## Replacement gate

Replace the JSON files and unauthenticated routes when the durable control
ledger, authorization and the leased node path exist. The contracts and
lifecycle semantics may remain.
