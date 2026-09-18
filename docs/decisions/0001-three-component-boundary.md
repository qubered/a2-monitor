# ADR 0001: Separate audio node, management platform, and live frontend

- **Status:** Accepted
- **Date:** 2026-09-18
- **Owners:** Project team
- **Supersedes:** None

## Context

Audio capture must run beside DVS, a USB interface, or future professional
audio ingress. Its failure modes and timing constraints are very different
from show building, user management, and browser presentation. The product may
be installed on one appliance initially, but future productions may require
multiple audio nodes or a separately hosted management service.

## Decision

Define three responsibility areas implemented as four code components:

1. **Audio node:** headless, minimally managed, hardware-adjacent capture,
   bounded analysis, rolling replay, receiver adapters, personal mixes, and
   browser media endpoint.
2. **Management backend:** authoritative show drafts, users, permissions,
   mappings, scenes, orchestration, normalized state, event correlation, API,
   and WebRTC signaling.
3. **Web frontends:** a Manager application for Build/admin workflows and a
   deliberately lean Live application using backend contracts and direct media
   from an authorized audio node.

The standard deployment may co-locate them, but no component may depend on
in-process calls to another. The node caches the active show revision and keeps
the active audio function running through a temporary backend outage.

## Consequences

### Positive

- Real-time audio is insulated from management and browser failures.
- Multiple-node and distributed deployments remain possible.
- Management and live frontends can evolve without entering the sample path.
- The Live app does not carry show-building complexity during operation.
- Node resource limits and operational responsibility are explicit.

### Negative

- Versioned contracts, reconciliation, authentication, and deployment are
  required earlier.
- Split deployments introduce clock, network, and support complexity.
- Some diagnostics span processes and require correlation identifiers.

## Alternatives considered

- **Single monolithic application:** simpler initially but couples show
  management and UI load to real-time audio and makes multi-node evolution
  expensive.
- **Browser owns audio processing:** cannot ingest Dante directly and gives up
  deterministic capture, centralized replay, and efficient per-user mixing.

## Validation

- Kill and restart the backend during a 12-hour capture test.
- Verify the node keeps capture, replay writing, and existing mixes alive.
- Reconnect and reconcile intended/observed state without duplicating events or
  silently changing bindings.
