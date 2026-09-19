# ADR 0015: Use TypeScript/Fastify for management and React/Vite for the web applications

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** None

## Context

The management plane contains a large, evolving theatre domain and two dense
browser applications, but it is intentionally outside the PCM/media path. The
team needs schema-first APIs, offline local deployment, fast product iteration
and independent Manager/Live artifacts without adopting a server-rendered or
cloud-dependent web platform.

ADR 0010 already selects local SQLite durability. The implementation must keep
synchronous database work and untrusted jobs off the HTTP/WebSocket event loop.

## Decision

Use the current supported Node.js 24 LTS line and strict TypeScript for the
management backend. Use Fastify for local HTTPS, REST, WebSocket signaling/state
subscriptions and static asset delivery.

Use separate React + TypeScript + Vite applications for Manager and Live. They
share generated protocol clients, headless accessible primitives, design
tokens and bounded visualization code, but retain separate entry points,
dependency graphs and deployable bundles.

The public application contract is:

- JSON Schema from `packages/protocol` is the source for REST and WebSocket
  JSON validation and generated Rust/TypeScript types;
- REST handles snapshots, commands, queries and show building;
- WebSocket carries bounded state/collaboration deltas and signaling;
- WebRTC carries per-client media and only the ADR 0009 bounded control channel;
- Manager and Live never call a database or receiver directly; and
- no GraphQL or server-side rendering in the first product.

Use SQLite through pinned `better-sqlite3` in a dedicated backend storage
worker with one writer queue. Use reviewed SQL migrations and prepared queries
behind repository interfaces; do not introduce an ORM initially. Assert the
runtime SQLite version/compile options and disable native extension loading.
Node's built-in `node:sqlite` may replace the addon only after it is stable and
passes migration, backup, version and performance gates.

High-rate telemetry does not flow through React component state. A typed
transport writes bounded external stores; Canvas/WebGL render meters, traces
and timelines on one animation scheduler with visibility culling. The DOM
remains the semantic/accessibility and command layer.

Live may install as a PWA for app-shell caching. Its service worker cannot
cache API data, credentials, media or mutations, and it creates no background-
audio guarantee.

## Consequences

### Positive

- Frontend and domain/API work share TypeScript and generated contracts.
- Fastify's schema model matches the existing JSON Schema repository.
- Static bundles and one local LTS runtime are straightforward to package.
- Audio reliability is not coupled to Node or browser rendering.
- Manager and Live can evolve and fail independently.

### Negative

- The product has both Rust and TypeScript toolchains.
- Event-loop blocking, dependency churn and native addon packaging require
  explicit tests and ownership.
- React requires a deliberately separate high-frequency render path.
- Raw migrations/repositories require more SQL discipline than a full ORM.

## Alternatives considered

- **Rust/Axum backend:** excellent correctness and deployment characteristics,
  but slower first-product iteration and less shared browser tooling.
- **Go backend:** operationally simple, but creates a third project language.
- **NestJS:** useful conventions but more framework/reflection surface than the
  local appliance needs.
- **Vue or Svelte:** both technically viable; React was selected for ecosystem,
  staffing and shared component/test maturity rather than a latency claim.
- **Next.js/SSR:** no SEO or public-server requirement justifies the extra
  runtime and rendering model.
- **PostgreSQL:** unnecessary service/operations burden for the single-host,
  single-writer authority profile.

## Validation

- Run API/WebSocket/storage load together with the Phase 0B full appliance load
  and prove it sheds before capture or live media.
- Profile 64 then 128 visible channels and enforce UI frame/input budgets on
  named browser devices.
- Test Manager and Live as independent builds and reject dependency leakage.
- Kill the storage worker at every transaction/checkpoint boundary and prove
  recovery/readonly behavior from ADR 0010.
- Exercise Chromium, WebKit/Safari and Firefox with Playwright plus real-device
  foreground/output-route tests.
