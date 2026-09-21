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
optional/unknown behavior, compatibility, bounds, and idempotency before a
contract enters generation.

The proposed semantics, including negotiation, snapshots/deltas, command
idempotency, atomic single-node activation, event delivery, imports, and Live
leases, are in [protocol v0](specification.md).

The only current machine-readable contracts are the two closed Phase 0T HTTP
response schemas needed by the running backend health and Live snapshot routes.
They do not restore the withdrawn command, event, authority, or IPC schemas.
Those contracts remain absent because the earlier `schema/v0` tree conflated
bootstrap and Live authority and accepted unconstrained canonical data. See
[open questions](../../docs/open-questions.md).

Schemas are written against a runtime that exists. OpenAPI/AsyncAPI documents
will be generated from the frozen domain schemas when concrete
HTTP/subscription routes are implemented; hand-written copies may not diverge
from them.

`schema/v0/http` is authoritative for the two running response contracts.
`generated/http-contracts.ts` contains their generated TypeScript types,
closed response parsers and small HTTP client. The header records its inputs
and regeneration command; never edit it by hand. The generated client applies
per-response byte limits before JSON parsing, so schema validation never starts
from an unbounded buffered body.

`validation/strict-ajv.mjs` is the Node/backend runtime for authoritative JSON
Schema validation. Its factory fixes Draft 2020-12 strictness and format
validation while disabling coercion, defaults, and property removal. The
backend and fixture tooling import this factory; callers cannot supply option
overrides. Response serialization validates the supplied value and the exact
parsed JSON value so serialization hooks cannot bypass the contract. Browser
clients continue to use the generated bounded parsers and do not import Ajv.

Generate and verify the committed artifact with:

```sh
npm run generate --workspace @rvlt/pulse-protocol
npm run generate:check --workspace @rvlt/pulse-protocol
npm run validate:fixtures --workspace @rvlt/pulse-protocol
npm run test --workspace @rvlt/pulse-protocol
```

The generator is deterministic and `--check` compares the complete expected
output, failing when the committed artifact is absent or stale. Repository
checks run this freshness gate. The fixture validator rejects any schema not
registered in its accepted/rejected matrix and executes that matrix with the
same strict Ajv factory as Fastify. Compatibility fixtures cover the current
and previous deployment pair while the schema major remains `0`; incompatible
major versions and undeclared fields are negative vectors. A future schema
major needs its own directory and explicit negotiation rather than silently
relaxing these closed parsers.
