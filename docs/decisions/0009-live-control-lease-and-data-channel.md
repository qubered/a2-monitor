# ADR 0009: Live control lease and WebRTC channel binding

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Project team

## Context

Live needs narrowly scoped control through a backend restart without creating a
second browser HTTPS origin on every node. Proof-of-possession, signed bytes,
retry behavior, time handling and media-control head-of-line behavior must be
identical across implementations.

## Decision

The browser loads only from the backend HTTPS origin. It uses two WebRTC data
channels on the monitored-audio peer connection:

- reliable/ordered `runtime-canonical.v0` for canonical and bounded session
  commands; and
- `runtime-media-control.v0` for coalescible newest-wins listen, gain, pan, dim
  and scrub intent. It is unordered/partially reliable where supported;
  otherwise application coalescing retains at most one pending value per
  control.

Canonical commands never share the media-control application queue. Phase 0B
measures both channels under loss and a saturated scrub/gain stream. The node
exposes no browser-facing HTTPS control origin. Signaling pins its certificate
fingerprint; control opens only after DTLS, SCTP and the lease handshake pass.

### Client key and lease

Live creates a non-exportable WebCrypto P-256 key on a dedicated show device.
The public JWK/RFC 7638 thumbprint are registered through the authenticated
backend session. A backend-signed compact JWS lease contains issuer, exact node,
user, random lease ID, performance/show revision, authority epoch, node boot,
client session, key thumbprint, closed command allow-list, UTC validity,
monotonic maximum boot age, byte/rate/offline-command limits and key ID.

Node restart creates a new random boot ID and invalidates all leases and control
sessions. Nothing persisted resurrects direct browser control.

### Handshake, time and signed bytes

The node sends a one-use 256-bit challenge and random channel ID after the
canonical channel opens. The client signs an RFC 8785 object containing protocol
label, lease hash/ID, client session, node/boot IDs, DTLS fingerprint, challenge,
channel ID, 128-bit client nonce and issued-at time. ES256 uses IEEE-P1363 raw
`r || s`, base64url without padding, and the lease-selected `kid`.

On acceptance the node records a monotonic deadline: the minimum of signed
boot-age allowance and UTC expiry translated through the current wall/monotonic
offset. UTC correction can shorten or invalidate but never extend it. Sleep,
resume ambiguity, monotonic discontinuity or boot change closes the session.

Every canonical command is exactly `{signed,signature}`. `signature` covers the
RFC 8785 bytes of `signed`; all authority, lease, scope, deadline, revision,
idempotency, channel-counter, previous-ACK and closed command-body fields are in
that nonrecursive projection. The initial previous-ACK hash is 64 zeroes.

The node accepts only the next decimal-string u64 counter and expected ACK
chain. A new idempotency key commits once. The same key plus identical signed
command hash returns the stored result/ACK. The same key with a different hash
is a conflict and closes the channel. The node durably commits command, result,
counter and ACK before sending. `ResultQuery` resolves lost ACKs on the direct
or backend route. The ACK hash covers the result envelope excluding `ack_hash`.
Counter exhaustion closes the session.

Ephemeral media-control messages use a separate volatile sequence and cannot
mutate canonical state. Session selections are bounded/recoverable but are not
evidence.

### Route handover and outage

Only one canonical submission route is active. Backend-to-direct handover first
drains or queries all in-flight keys, reads the durable node counter/ACK head,
then opens direct admission. Direct-to-backend handover closes direct admission,
resolves every submitted key and publishes the final head before backend
mutation begins. An asymmetric partition reports `unknown-outcome` and permits
result queries only; it never retries the action under another key.

Backend revocation closes the channel when reachable. During backend loss an
established channel survives only until the earliest lease deadline, boot-age/
command cap, authority/grant change, heartbeat loss or capacity floor. New and
replacement-node sessions require the backend.

## Browser trust and limits

Offline installations provision the production CA through MDM/Configurator or
a documented ceremony; ephemeral self-signed exceptions are unsupported. The
profile records CA version, SAN, expiry and rotation overlap. Proof of possession
does not make compromised same-origin code safe, so Live also requires strict
CSP, Trusted Types where available, no third-party show-mode script, short
leases, least privilege and a dedicated-device profile.

## Validation

- golden lease, handshake, command, result and query vectors in browser/node;
- altered-field/canonicalization, wrong `kid`, signature-format and initial-chain
  cases;
- duplicate/different-payload keys and skipped/reordered/exhausted counters;
- lost ACK and both route handovers under asymmetric partitions;
- wall-clock jumps, suspend/resume, expiry, backend loss and node restart;
- media-control flood proving bounded canonical latency; and
- first-use, renewal, revocation and CA rotation on every supported profile.
