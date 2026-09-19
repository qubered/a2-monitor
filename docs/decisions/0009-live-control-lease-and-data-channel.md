# ADR 0009: Live control lease and WebRTC data-channel binding

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** The underspecified browser/node path in protocol v0

## Context

Live must retain narrowly scoped control during a backend restart without adding
an independently trusted browser HTTPS/WebSocket origin on every node. The prior
plan named proof of possession and anti-replay without defining the claims,
signed bytes or restart behavior.

## Decision

The browser loads only from the backend's HTTPS origin. Direct node control uses
one reliable, ordered WebRTC `RTCDataChannel` named `runtime-control.v0` on the
same `RTCPeerConnection` as monitored audio. The node exposes no browser-facing
HTTPS control origin in version one. Signaling pins the node certificate
fingerprint; control becomes usable only after DTLS, SCTP and the lease handshake
all succeed.

### Client key and lease

On a dedicated show device, Live creates a non-exportable WebCrypto P-256 signing
key. The public JWK and its RFC 7638 thumbprint are registered through the
authenticated backend session. A backend-signed compact JWS lease contains:

| Claim | Meaning |
| --- | --- |
| `iss`, `aud` | backend installation ID; exact node ID |
| `sub` | user ID |
| `jti` | 128-bit random lease ID |
| `performance_id`, `show_revision_id` | activated scope |
| `authority_epoch`, `node_boot_id` | exact authority and process boot |
| `client_session_id`, `cnf.jkt` | Live session and client-key thumbprint |
| `commands` | closed allow-list of command types |
| `iat`, `nbf`, `exp`, `max_boot_age_s` | UTC validity and monotonic boot-age cap |
| `limits` | bytes, command rates and offline canonical-command count |

Node restart creates a new random boot ID and invalidates every prior lease and
control session. A fresh backend-issued lease is required; persisted clock logic
is therefore not used to resurrect browser control after restart.

### Channel handshake and command proof

The node sends a 256-bit random challenge after the data channel opens. The
client signs an RFC 8785 JCS object containing protocol label, lease SHA-256,
lease ID, client session ID, node ID, boot ID, DTLS certificate fingerprint,
challenge, a 128-bit client nonce and issued-at time. The JWS header is
`{"alg":"ES256","typ":"show-control+jws","jwk":...}`. The node validates
the lease signature and scope, client-key thumbprint, proof signature, challenge,
fingerprint and a 30-second proof window, then consumes the challenge exactly
once.

Every canonical command carries a decimal-string `channel_counter`, idempotency
key and JCS payload hash. The client signs the JCS object:

`{lease_id,node_boot_id,channel_id,channel_counter,previous_ack_hash,command}`.

The node accepts only the next counter on this reliable ordered channel, the
expected acknowledgement-chain hash and an unused idempotency key. It durably
commits the canonical command/result/counter before acknowledging. A lost ACK is
resolved by querying the idempotency key; it is never guessed. Counters are
decimal strings and have a maximum of `2^64-1`; exhaustion closes the session.

Ephemeral listen, gain, pan, dim and replay-scrub messages are authenticated by
the established DTLS/data-channel session, use a separate volatile sequence and
may be coalesced. They cannot mutate canonical state. Session-state commands
such as selected sources are bounded and recoverable but not evidence.

Backend revocation closes the channel when reachable. During a backend outage,
an established channel remains valid only until the earliest of lease expiry,
boot-age cap, command-count cap, authority change, heartbeat loss or local
capacity floor. New sessions and replacement-node sessions require the backend.

This profile follows the replay-resistant structure of DPoP—unique proof ID,
key binding, signed request context and server nonce—but is a distinct protocol,
not an assertion of RFC 9449 interoperability.

## Browser trust bootstrap

The backend has a production DNS name and certificate trusted on field devices.
Offline private deployments install the production CA through MDM/Apple
Configurator (preferred) or a documented manual ceremony; ephemeral self-signed
exceptions are unsupported. Provisioning records CA version, SAN, expiry and
rotation overlap. Phase 0B captures DNS, HTTPS, signaling, ICE, DTLS and data-
channel traffic on a freshly provisioned offline device and proves the bounded
UDP range and intended interface selection.

## Security limits

Proof of possession limits token theft; it cannot make an actively compromised
browser/XSS safe because malicious same-origin code can ask the key to sign.
Live therefore also requires strict CSP, Trusted Types where supported, no
third-party show-mode script, short leases, least privilege and a dedicated
device profile.

## Validation

- golden lease/handshake/command vectors, altered-field and canonicalization
  tests in browser and node implementations;
- duplicate, skipped, reordered, exhausted and concurrent counters;
- stolen lease without key, stolen proof, reused challenge and wrong DTLS
  fingerprint;
- backend loss before/after channel establishment and node restart;
- revocation delay, expiry, capacity floor and takeover tests; and
- offline first-use/renewal/CA-rotation tests on each supported field profile.
