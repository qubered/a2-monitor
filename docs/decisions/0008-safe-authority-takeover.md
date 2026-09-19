# ADR 0008: Version-one takeover uses power fencing and boot grants

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** Takeover wording in ADR 0004

## Context

An unreachable node cannot observe a newer backend epoch. A higher epoch orders
history but cannot stop an isolated old node serving an old client. A temporary
network rule is also not a durable fence when another interface, switch path or
later rule change can restore contact.

## Decision

Version one permits replacement authority only after the former node is
physically powered down or power-cycled and its chassis identity is witnessed.
Managed-switch quarantine may help an operator reach or shut down the node, but
is not independently sufficient. Removable-key and network-only fencing are
deferred until every canonical commit can synchronously validate a separately
owned fencing service.

Every canonical commit also requires an in-memory, backend-signed
`BootAuthorityGrant` matching node ID, random boot ID, authority epoch,
performance ID and active show revision. The grant is delivered only after
activation or a completed takeover, is never persisted, and is destroyed on
process exit, restart, sleep/resume ambiguity, grant expiry, performance close
or authority loss. The commit path validates the grant signature, scope and
monotonic deadline for every mutation; uncertainty fails closed before ledger
append. Capture and listening may continue read-only.

Takeover is a durable state machine:

`requested -> old-power-removed -> witnessed -> epoch-allocated -> new-grant-issued -> active`

Cancellation is allowed before grant issue. Any contradiction enters
`fence-uncertain`, revokes the new grant and blocks mutation. Two named operators,
or one administrator plus machine-verifiable switched-PDU evidence, attest the
old node ID/boot ID, chassis and power boundary. The backend enumerates all
known management, media and control interfaces in the record, marks the old
epoch retired, allocates the next epoch in a serializable transaction, and only
then signs a grant for the replacement boot.

`authority_epoch` is a fixed-width 32-character lowercase hexadecimal unsigned
128-bit counter. It never wraps. An old chassis restarted after takeover has a
new boot ID and no grant; an old process restored from memory cannot pass grant
deadline and retired-epoch checks once connected. Old-epoch tails import only
to quarantine for explicit classification, never directly to projections.

## Consequences

- Version one deliberately has no zero-touch failover.
- Power control and a printed two-person takeover checklist are part of the
  supported appliance profile.
- Network isolation remains defence in depth, not the safety proof.
- A node without a currently valid boot grant is a read-only monitor.

## Validation

- keep an old client/node connected while takeover is requested; replacement
  activation must refuse before witnessed power removal;
- remove each network quarantine path and prove it never substitutes for power
  evidence;
- restart both old and new nodes and prove neither can mutate until the backend
  issues the exact boot-scoped grant;
- expire, revoke, corrupt and remove the in-memory grant between validation and
  append; the sequencer must fail closed without a canonical event;
- replay old grants, leases and commands against both boots and epochs; and
- crash at every takeover transition and prove at most one unexpired grant can
  be issued for the performance/epoch.
