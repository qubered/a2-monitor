# ADR 0008: Safe authority takeover requires external fencing

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** Takeover wording in ADR 0004

## Context

An unreachable node cannot observe a newly allocated authority epoch. If it can
still reach a client and still owns an unexpired lease, an epoch stored only in
the backend cannot stop it from committing. A higher number is an ordering tool,
not a fence.

## Decision

Version one has no logical takeover of an unreachable writer. A replacement
node may become runtime command authority only after an authorized operator
records one of these externally verifiable fences against the former node:

1. power removed and chassis identity witnessed;
2. old node ports quarantined by a managed switch/firewall rule whose active
   state is read back from the enforcing device;
3. the old node's removable control identity/device path physically removed;
   or
4. a future shared fencing service that every canonical commit must synchronously
   consult and whose failure stops mutation.

The first three are the only version-one mechanisms. They require two named
operators, or one administrator plus machine-verifiable enforcement evidence.
The takeover record contains old/new node IDs and boot IDs, last known ledger
positions, fence kind, evidence hash, witnesses, reason and UTC/monotonic times.
If the fence cannot be proved, capture/listening may continue on an independently
safe path, but cue, assignment and verification mutation remains stopped.

`authorityEpoch` is a fixed-width, 32-character lowercase hexadecimal string
representing an unsigned 128-bit counter. Fixed width makes bytewise and numeric
ordering identical and avoids JSON/JavaScript integer loss. The backend allocates
the next value in a durable serializable transaction after accepting the fence.
`ffffffffffffffffffffffffffffffff` is terminal: no wrap or reset is permitted.

An old node that returns enters `quarantined-authority` before any reconciliation.
Its post-fence tail is never imported into canonical projections automatically.
An administrator must classify each tail command as already represented,
evidence-only, or rejected-conflict; a corrective command on the current
authority records any required physical truth. History is never silently merged
by timestamp or epoch preference.

## Consequences

- A spare cannot provide zero-touch failover, but split-brain identity is
  prevented by an observable operational procedure.
- Epochs still fence restored snapshots and connected stale nodes after the
  physical/network fence is in place.
- Productions need a printed takeover checklist and tested switch/power access.

## Validation

- keep an old client and old node exchanging valid leased commands while the
  backend attempts takeover; activation must refuse until the fence is proven;
- after replacement activation, replay every old lease/command against both
  nodes and prove that only the new authority can create canonical history;
- remove the quarantine rule and reconnect the old node with an unimported tail;
  prove automatic projection/import is impossible; and
- crash before and after fence evidence, epoch allocation and activation and
  prove there is never more than one enabled writer.
