# Protocol contracts

This package contains the protocol-v0 normative schemas, transition catalogue
and golden vectors. Envelopes are strict and closed; public API adapters
translate at the boundary rather than leaking API naming into canonical history.

This package will contain versioned, implementation-neutral contracts for:

- audio-node registration, capability, health, and configuration;
- intended/observed state reconciliation;
- normalized receiver and audio telemetry;
- durable events and meter deltas;
- monitor-bus control and media authorization;
- show import/export manifests; and
- people/roles, performance cast and microphone assignment transactions;
- cue runtime, image relationships, incident ownership, and audit events; and
- backend/frontend API types.

JSON is the protocol-v0 control/event representation and RFC 8785 JCS is its
hash/signature representation. Large counters are strings. Binary media and
meter transport remain separate. Contracts must define units, time domains,
optional/unknown behavior, compatibility, bounds, and idempotency before code
generation is introduced.

The proposed semantics, including negotiation, snapshots/deltas, command
idempotency, atomic single-node activation, event delivery, imports, and Live
leases, are in [protocol v0](specification.md).

The only current machine-readable contracts are the two closed Phase 0T HTTP
response schemas needed by the running backend health and Live snapshot routes.
They do not restore the withdrawn command, event, authority, or IPC schemas.
Those contracts remain absent because the earlier `schema/v0` tree conflated
bootstrap and Live authority and accepted unconstrained canonical data. See
[open questions](../../docs/open-questions.md).

Schemas are rewritten against a runtime that exists. OpenAPI/AsyncAPI documents
are generated from the frozen domain schemas when concrete HTTP/subscription
routes are implemented; hand-written copies may not diverge from them.

`src/live-snapshot.ts` is the temporary handwritten TypeScript view of the two
running contracts. Deterministic type/client generation and compatibility
fixtures remain a separate Phase 0T deliverable; no generated artifact is
claimed by this slice.
