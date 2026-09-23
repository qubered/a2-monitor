# ADR 0027: Backend-owned live monitoring state and alert lifecycle for the MVP

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-23
- **Owners:** Project team
- **Supersedes:** None

## Context

The local MVP could capture audio, stream one input to Live and read Shure
telemetry, but in device mode it raised no alerts at all: every card's Audio
verdict was `unknown`, the card meter was decorative, RF and battery verdicts
were computed separately in each browser, and acknowledgements lived in each
browser's local storage. PR #65's level history sampled the fabricated
snapshot, not the node. Two A2s on two iPads could therefore disagree about
what was wrong and who had seen it.

The architecture already assigns cross-source alert correlation and
acknowledgement to the backend, keeps the backend out of the sample path, and
lets Live receive media directly from the node. The production node/backend
IPC, authorization, control ledger and storage worker do not exist yet.

## Decision

For the local MVP only:

1. **The node measures.** `pulse-media-worker` (ADR 0026) meters every
   captured input (peak, RMS and clipped-sample count) over 50 ms intervals on
   blocks already read from the capture pipe, never on the real-time callback,
   and reports each interval as a `meters` control event. The listen gateway
   relays them: `GET /audio/v0/levels` is a one-second trailing summary plus
   capture state (`node-levels` contract), and `GET /audio/v0/meters` is a
   20 Hz Server-Sent Events stream of `meter-frame` payloads. Meters are
   measurements, not samples; audio never passes through the gateway.
2. **The backend judges.** The backend polls the node's levels and normalized
   Shure telemetry once a second, evaluates the active showfile against its
   alert policy, and owns one alert lifecycle: a finding must hold for a
   per-kind raise delay before it becomes an alert and be absent for a clear
   delay before the alert clears; acknowledgement records who and when and
   never clears; a severity escalation re-arms an acknowledged alert; caution
   overlays expire while the alert still counts as outstanding; critical
   overlays never expire. Active alerts and bounded history (1,000 cleared
   alerts) persist to `alerts.json` beside the production library so
   acknowledgements survive a backend restart.
3. **Everyone reads one state.** The backend publishes one contract-validated
   `live-state` document at `GET /api/v1/live/state` and streams it as
   server-sent events at `GET /api/v1/live/events`. Live renders verdicts and
   alerts only from that document and acknowledges through
   `POST /api/v1/alerts/:id/acknowledge`. Meter traces come straight from the
   node stream.
4. **Policy is part of the show.** The showfile gains an optional
   `alertPolicy` (battery, RF level, link quality, silence floor and timeout,
   clipping, overlay expiry) edited in Manager, with shared defaults in
   `@rvlt/pulse-protocol/alert-policy`. Silence alerting stays a per-channel
   setting (ADR 0019); channels gain stable ids so alerts and history survive
   renames, repatching and reordering.
5. **Simulation is labelled.** The reserved device name `Pulse test signal`
   makes `pulse-device-capture` generate a built-in eight-channel test signal
   in place of a physical input, and a development AD4Q simulator is
   available, so metering, alerting and WebRTC listening can all run without
   hardware. The node reports the device as `simulated` and Live labels it at
   every width.

When the backend is unreachable, Live keeps last-known identity, withdraws
every verdict and alert to unknown, and keeps listening through the node.

## Consequences

### Positive

- Every Live client shows the same verdicts, alerts and acknowledgements.
- Audio silence, clipping, RF level, link quality, interference, transmitter
  loss and mute, battery, receiver loss, capture failure and node loss all
  produce explainable, attributed alerts with bounded history.
- Thresholds are per show and visible, not constants in a browser bundle.

### Negative

- One-second polling adds up to about a second of alert latency on top of the
  raise delays; receiver telemetry cadence adds more.
- The full state is re-sent every second to every Live client. That is
  acceptable on a trusted LAN at MVP channel counts and is not a production
  fan-out design.
- `alerts.json` is a mutable local file, not the durable, append-only control
  ledger; RF-lost detection forgets which transmitters it has seen when the
  backend restarts.
- The endpoints inherit ADR 0026's trust boundary: no authentication or
  encryption, trusted local networks only.

## Alternatives considered

- **Evaluate alerts in each browser.** Rejected: clients disagree and
  acknowledgements cannot be shared.
- **Evaluate alerts in the gateway.** Rejected: alert policy, acknowledgement
  and history are backend responsibilities, and the gateway is a temporary
  MVP host (ADR 0026, ADR 0023).
- **Route meters through the backend.** Rejected: 20 Hz meters for every input
  to every client would put high-rate traffic through the management service
  and would stop with the backend.
- **Meter in the gateway process.** Superseded when ADR 0026 moved audio out
  of the gateway: the worker already holds every captured block, so metering
  there adds no second PCM pipe.
- **WebSocket for the state and meter streams.** Server-sent events are
  one-way, reconnect on their own and pass through the gateway's plain HTTP
  proxy unchanged; the gateway no longer carries a WebSocket dependency.

## Validation

- Unit and route tests cover every alert rule, the raise/clear/acknowledge/
  escalate/expire lifecycle, persistence round trips, the state and event
  endpoints and Live's rendering of shared state.
- The simulated stack (`npm run dev:simulate`) exercises the full path.
- Not yet validated: thresholds against a labelled alert set, alert latency on
  named hardware, behaviour with physical receivers and interfaces, and A2/A1
  operator use. None of this is evidence for a Phase 0 or Phase 1 gate.

## Replacement gate

Replace the polling link, JSON persistence and SSE fan-out when the node/backend
IPC, durable control ledger and authorized Live transport exist. The contracts
and lifecycle semantics may remain.
