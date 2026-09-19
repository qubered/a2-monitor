# ADR 0013: Offline PKI and signing-key lifecycle

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
- **Date:** 2026-09-19
- **Owners:** Security/platform owner

## Decision

Each installation has an offline root CA and an online, constrained deployment
intermediate. Separate non-CA keys sign Live leases, boot-authority grants,
evidence results and software releases. A key cannot cross those purposes.
Private root and release keys remain offline; online keys use OS-protected key
storage or a documented hardware-backed profile and are non-exportable where
the platform permits.

Node certificates require installation/node identity SANs and node-client/server
EKUs. Backend certificates require the production DNS SAN and server EKU.
Operator/browser clients are authenticated at the application layer and do not
receive general-purpose CA credentials. Every signature carries an algorithm
and `kid`; verifiers accept only an explicit purpose-specific key ring.

Rotation distributes the new trust/key set before issuance, records activation
and retirement instants, retains an overlap no longer than the shortest relevant
artifact lifetime, and has a signed rollback package. Revocation uses signed,
versioned CRLs/status bundles distributed with show packages and during every
backend connection. A node will not start a new performance with stale
revocation data beyond policy. During an active offline performance it may honor
only already-established, monotonic-bounded leases/grants; it records the stale
condition and cannot extend them.

Certificate validity is checked against UTC at enrollment/preflight. Backward or
uncertain wall-clock movement blocks enrollment, renewal and new lease/grant
issuance; existing sessions are only shortened by their monotonic deadline.

Compromise procedure identifies purpose and `kid`, stops issuance, publishes a
signed emergency revocation bundle through two-person custody, rotates the
affected intermediate/key, invalidates dependent leases/grants, re-enrolls
affected nodes and preserves audit evidence. Loss of the offline root invokes a
new installation trust ceremony; it is never bypassed with an ad-hoc certificate.
Key backup/export is permitted only as encrypted, split-custody recovery material
with tested restore and an access log.

## Validation

Test first provisioning, wrong SAN/EKU/purpose, unknown/retired `kid`, overlapping
rotation, rollback, stale/forged CRL, offline expiry, wall-clock jumps, key loss
and each compromise playbook on Windows and macOS. Golden vectors cover all
signed object types. The evidence record identifies exact trust bundle and key
versions without exposing private material.

## Consequences

Offline operation is bounded, not trust-free. Key custody, PDU access and device
provisioning become explicit production responsibilities.
