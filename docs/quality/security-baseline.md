# Security baseline

The enforceable threat and mechanism design is in
[the threat model](threat-model.md). This file summarizes non-negotiable
controls.

## Trust boundaries

- Dante/audio network and its devices.
- Receiver control network and vendor APIs.
- Audio node operating system and local storage.
- Node-to-backend control connection.
- Backend API, database, and show assets.
- Browser clients and selected audio outputs.
- Optional update/licensing services outside the venue.

Compromise of a browser must not grant direct access to Dante, receiver
credentials, or node administration.

## Required controls

- HTTPS for browser access and secure WebRTC media.
- Mutual authentication between node and backend in split deployments.
- Unique node identity; no shared fleet-wide secret.
- Role-based permissions for show edit, activation, live operation, replay,
  credential management, and administration.
- Server-side authorization for every command; hiding a UI control is not an
  authorization mechanism.
- Object-level authorization for every performance, conversation, incident,
  message, attachment, subscription and export; a broad scope or linked ID is
  never sufficient.
- Receiver credentials stored encrypted and released only to the local adapter
  process that needs them.
- SSCv2 for supported EW-DX firmware; legacy unsecured access requires an
  explicit compatibility exception and warning.
- Audit events for login, show activation, binding changes, alert-rule changes,
  credential changes, and software updates.
- Signed update artifacts with a documented rollback path.
- Least-privilege separation between the audio engine, media, replay, adapter,
  supervisor, backend, and updater roles.
- Default-deny host firewall, no IP forwarding, explicit interface binding, and
  WebRTC candidate filtering.
- Offline-capable certificate issuance, rotation, revocation, backup, expiry
  warning, and factory reset.
- Full-disk encryption on supported appliances and bounded, validated imports.
- Quarantined, size/type/decoded-content-bounded attachment processing outside
  privileged services and outside the web root.

## Browser security

- Use a strict Content Security Policy and no inline executable code.
- Protect authenticated state from cross-site request forgery and script
  injection.
- Do not place credentials or long-lived tokens in URLs or logs.
- Keep media authorization short-lived and scoped to one user/node/session.
- Require explicit operator interaction to enable audio and select a non-default
  sink where the browser requires it.

## Data handling

- Show audio, images, voice notes/transcripts, messages, incidents, and device
  inventory are sensitive.
- Default to local-only retention and configurable automatic deletion.
- Exports exclude credentials and identify their schema and sensitivity.
- Diagnostic bundles redact addresses, tokens, credentials, and personal data.
- Cloud analytics and model training are opt-in and documented separately.

## Availability

Security controls must not create an internet dependency during a show. The
active show and existing local sessions need a documented grace/recovery model,
while configuration and privileged operations fail closed when authorization
cannot be established.

An established Live session may retain only the node-scoped show-time controls
listed in its signed lease. New sessions and management mutations require the
backend. The precise behavior and recovery targets are defined in
[failure and degraded modes](../architecture/failure-and-degraded-modes.md).
