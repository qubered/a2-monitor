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

SQLite runs through pinned `better-sqlite3` in a dedicated storage worker with
one writer queue, reviewed SQL migrations, disabled extension loading and a
runtime-enforced SQLite 3.51.3 minimum. CPU-heavy import/export and untrusted
media work use bounded confined workers. None of these processes receives PCM
or enters the live media path. See ADR 0015 and ADR 0010.
