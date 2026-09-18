# Threat model and security architecture

**Status:** Proposed; required before an external pilot

## Assets

- live and replay audio;
- show identity, mappings, notes, images, messages, voice notes, tasks,
  incidents, and audit history;
- receiver credentials and device-control capability;
- node, user, update, and signing identities;
- availability of capture, listening, and operational history; and
- integrity of the active show revision and source bindings.

## Threat actors and entry points

Consider an unauthenticated person on client Wi-Fi, a hostile device on a
receiver/audio network, a compromised operator browser, a malicious or
mistaken authenticated user, stolen appliance, malicious receiver response,
tampered update/import/diagnostic bundle, compromised dependency, and physical
operator with local access.

Entry points include HTTPS/WebSocket, WebRTC/ICE/DTLS/SRTP, node enrollment,
vendor discovery/control, audio drivers, show import, image upload, diagnostics,
offline update media, database restore, and local service interfaces.

## Process and privilege boundaries

The audio-node deployment component is split into supervised processes:

1. **audio engine:** opens the one audio device and owns the real-time callback,
   mix matrices, sample clock, and bounded shared-memory/ring handoffs;
2. **media worker:** owns WebRTC, Opus, session networking, and resampling;
3. **replay worker:** owns the local ring and replay readers;
4. **adapter workers:** own vendor-network parsers and receiver sessions; and
5. **node supervisor:** owns enrollment, local policy, capability aggregation,
   worker lifecycle, and bounded IPC routing.

An unprivileged client-control gateway terminates browser-to-node control,
validates secure transport and lease proof of possession, enforces canonical
schemas/rates/replay state and forwards only typed bounded IPC. It cannot access
the audio device, receiver credentials or general node administration.

Workers run without administrator/root privileges after setup, have separate
filesystem/network access, bounded messages and queues, and cannot open the
audio device unless their role requires it. Adapter and media crashes cannot
terminate the audio engine. The final sandbox and IPC mechanisms require an
OS-specific ADR and adversarial tests.

## Network policy

The standard appliance uses explicit audio, receiver-control, and client/control
interfaces where hardware permits. Enforcement includes:

- IP forwarding and OS bridging disabled;
- host firewall default deny with a documented port/direction matrix;
- each service bound to approved interfaces only;
- multicast discovery confined to the relevant receiver interface;
- receiver endpoints allowlisted after operator approval;
- no browser route or credential path to audio or receiver networks;
- WebRTC host candidates limited to the client/control interface;
- no public STUN/TURN in the standard offline deployment;
- an explicit bounded UDP media-port range; and
- fail-closed startup if interface identity is ambiguous.

Shure TCP 2202 remains a plaintext local-network exception. It is contained in
an unprivileged adapter worker and monitoring is read-only unless a separately
approved control capability is enabled.

## Local identity and sessions

- Initial administrator creation requires local appliance-console access and a
  single-use bootstrap secret. Remote first-admin creation is disabled.
- Roles separately grant administration, show edit, cast/inventory edit, image
  management, activation, cue control, emergency swap, live operation,
  replay/export, credential enrollment, service-account management, and update
  authority.
- Password storage, rate limits, session lifetime, lockout, optional MFA, and
  recovery codes follow a later identity ADR and are tested offline.
- Privileged sessions are shorter than ordinary Live sessions.
- Show-time node leases are signed, scoped, nonce-bound, replay protected, and
  bound to the authenticated media/client key.
- Emergency cast/microphone scopes can reference only alternatives and spares
  in the signed activated performance manifest; arbitrary IDs and image/upload
  operations are forbidden at the node.
- Audit records capture actor, action, target, show revision, result, source
  address, and correlation ID without secrets.

## Certificates and node enrollment

The first appliance creates or imports a local deployment CA. Node enrollment
requires a single-use token and physical or console confirmation. Node keys are
non-exportable where TPM, Secure Enclave, or an appropriate OS keystore permits;
software fallback is declared in the deployment profile.

The system supports offline issuance, rotation, revocation, backup of the CA
under separate administrator control, clock-skew checks, and expiry warnings.
Activation is blocked when a required certificate will expire during the
planned show window. Factory reset destroys node keys and enrollment.

## Receiver secret custody

Receiver credentials are encrypted to a node-owned public key in the Manager
client and can transit the backend only as a sealed envelope. The node decrypts
and stores them in its protected keystore; plaintext is never persisted by the
browser or backend. Secret export is disabled by default. Rotation, replacement,
restore, theft response, redaction, and zeroization require explicit workflows.

## Updates and recovery

- Builds are reproducible where practical and include an SBOM and provenance.
- Update manifests and packages are signed by separately controlled release
  keys and verified offline.
- Installation is atomic/A-B or otherwise power-fail safe, followed by health
  confirmation and automatic rollback.
- Anti-rollback prevents installation below a security floor while allowing a
  tested data-compatible operational rollback.
- Offline trust-root rotation, interrupted-update recovery, database migration,
  OS patching, factory recovery, and spare-appliance restore are release gates.
- No update is installed automatically during an active show.

## Data protection

Supported appliances use full-disk encryption. Replay is excluded from normal
backups and diagnostics. Show exports, imports, images, and archives are size-
bounded, content-validated, protected from path traversal/decompression bombs,
and processed outside privileged services. Retention and deletion are explicit
and auditable.

Headshots, costume/placement photographs and incident images are sensitive
personal/production data. Image ingestion decodes and re-encodes approved
formats, strips EXIF/GPS, enforces byte/pixel limits, generates safe variants,
and never serves user-controlled public filesystem paths.

Performance chat can expose performer condition, faults, locations and
production decisions. Conversation membership, direct messages, exports,
search and attachments are separately authorized. Retention is configurable;
incident-selected evidence may have a different retention class. Corrections
and privileged removal are visible and audited. The product makes no end-to-end
encryption claim: authorized backend services necessarily process messages.

Voice notes follow bounded upload, decode/transcode, malware/content validation
and retention rules. Optional transcription stays inside the approved local
deployment. Message rendering treats all content as untrusted, and mentions,
priority pages, reactions and attachment endpoints have anti-spam and resource
limits. Presence is privacy-minimized, expires quickly and is not safety truth.

Broad scopes never authorize an object by themselves. Performance membership,
conversation/incident relationship, direct participants, owning attachment
relationship and requested operation are checked on every request and
subscription. Context links grant no access. Revocation closes live streams and
invalidates attachment URLs. Browser-managed messages, voice/detail assets and
unsent drafts are not persistently cached; active-show headshot/grid caches are
namespaced and purged on logout, user switch, show removal or revocation.

On a co-located appliance, CPU/memory/thread/socket/queue limits and disk
reservations enforce the order capture, live media/control, replay, essential
state, text collaboration, then attachment/transcription work. Media decoders
run without network access in low-priority bounded workers. Admission rejects
work before exhaustion; transcription is off during active performances until
validated. See [ADR 0007](../decisions/0007-appliance-resource-isolation.md).

## Required abuse tests

- parser fuzzing and malformed/fragmented/coalesced receiver traffic;
- authorization-denial matrix and privilege-escalation tests;
- CSRF, XSS, CSP, upload, import, and archive-bomb tests;
- unauthorized conversation/direct-message access, stored-message XSS,
  mention/page flooding, correction/tombstone and chat-export tests;
- token replay, session theft, expired/revoked certificate, and clock-skew tests;
- stolen node lease, proof-of-possession misuse, clock rollback, node restart,
  nonce exhaustion and stale authority-epoch tests;
- hostile discovery, connection storm, LAN flood, and resource-exhaustion tests;
- secret/log/diagnostic leakage tests;
- update tamper, downgrade, interruption, and recovery tests; and
- physical disk theft and factory-reset verification.
