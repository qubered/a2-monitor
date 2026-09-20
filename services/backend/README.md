# Management backend

The backend is the product's management and orchestration authority. It serves
the Manager and Live APIs and may serve their independent static bundles, but
it is never in the real-time sample path.

## Owns

- users, sessions, roles, and permissions;
- production/show drafts, performances, cast, cues, images, versions,
  activation, and export/import;
- sources, node/audio/radio bindings, groups, scenes, and layouts;
- microphone inventory, intended/time-bounded assignment plans, projection of
  node-sequenced active-performance swaps, and historical identity resolution;
- node registration, capabilities, desired configuration, and reconciliation;
- normalized live state and durable operational events;
- operator workspaces/preferences, tasks, incidents, conversations, ordered
  messages, reactions, read cursors, priority pages and advisory presence;
- safe chat-image/voice-note ingestion, authorization, retention and export;
- cross-source alert correlation and acknowledgement;
- WebRTC signaling, short-lived media authorization, and scoped node-control
  lease issuance; and
- audit records and retention policy.

## Does not own

- device-driver callbacks or sample buffers;
- real-time mixing or encoding;
- direct browser access to hardware networks; or
- a hidden dependency required for an already active node to keep capturing.

The backend must expose versioned contracts and visibly distinguish intended,
observed, stale, and disconnected state.

The active node is the sole sequencer for runtime cue occurrences and assignment
overlays. Healthy commands pass through the backend for authorization/routing;
established Live sessions use the same bounded node authority directly during a
brief backend outage. Base-show mutation, collaboration and new authorization
still require the backend. Pre-approved runtime overlays/cue movement reconcile
from the node's durable control ledger.

## Implementation baseline

The backend uses strict TypeScript on Node.js 24 LTS with Fastify. It serves
versioned REST, WebSocket state/signaling and the independent static Manager and
Live bundles over local HTTPS. JSON Schema in `packages/protocol` is the public
contract source.

The packaged artifact contains an exact Node patch, compiled JavaScript/static
assets and an adjacent signed native addon. Fastify 5 is pinned at 5.12.2 or
newer and uses the protocol package's shared strict, non-mutating Ajv 2020
factory. Responses are validated before ordinary JSON serialization, then the
exact serialized JSON value is validated again so prototype inheritance,
getters, or `toJSON` cannot change the wire contract. Runtime conformance
vectors must agree with tools and generated Rust/TypeScript types.

SQLite runs through pinned `better-sqlite3` in a dedicated storage worker with
one writer queue, reviewed SQL migrations, disabled extension loading and a
runtime-enforced SQLite 3.51.3 minimum. CPU-heavy import/export and untrusted
media work use bounded confined workers. None of these processes receives PCM
or enters the live media path. See ADR 0015 and ADR 0010.

The Node process is owned by an independent platform bootstrap/supervisor, not
by the audio node. A Node worker thread isolates SQLite work from the event
loop, but it is not an operating-system crash or privilege boundary.

## Current implementation

The Phase 0T skeleton exposes two read-only routes:

- `GET /healthz` reports the backend process health contract; and
- `GET /api/v1/live/snapshot` returns a bounded, explicitly fabricated Live
  snapshot for development.

Both responses use the Draft 2020-12 schemas and shared validator runtime in
`packages/protocol`. Fastify validates both the supplied response object and the
exact value produced by ordinary `JSON.stringify` serialization. Undeclared,
inherited-only, coerced, defaulted, removed, or post-validation transformed
response data fails closed.

Run the backend on `http://127.0.0.1:3000` with:

```sh
npm run dev --workspace @a2-monitor/backend
```

This scaffold has no database, authorization, WebSocket, node connection, or
real telemetry. It does not establish a hardware, latency, security, receiver,
or operator result.
