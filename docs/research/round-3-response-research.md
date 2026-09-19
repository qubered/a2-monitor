# Round 3 response research

**Researched:** 2026-09-19

This note records the primary material used to turn review findings into design
decisions. It does not claim implementation validation.

## Proof, canonical bytes, and the browser/node path

- [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html) demonstrates the
  useful proof-of-possession pattern: asymmetric client key, unique `jti`,
  request binding, token hash, short time window, server nonce and replay
  tracking. It also warns that active browser XSS can still invoke/exfiltrate
  proofs. ADR 0009 adapts the pattern but deliberately uses a separate protocol
  name because commands travel over a WebRTC data channel rather than HTTP DPoP.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) defines deterministic
  JSON canonicalization for hashing/signing and recommends strings when integers
  exceed interoperable IEEE-754 precision. Protocol v0 therefore uses JCS and
  string counters/epochs.
- [WebRTC 1.0](https://www.w3.org/TR/webrtc/) specifies that a data channel is
  associated with an `RTCPeerConnection`, uses SCTP over DTLS/UDP, is reliable
  when retransmission limits are not set, and can preserve order. This supports
  one media/control connection without a second browser-trusted node HTTPS
  origin; application authorization, replay and durable ACK semantics remain our
  responsibility.
- Apple states that manually installed certificate profiles are not
  automatically trusted for TLS, while certificates deployed with Apple
  Configurator/MDM are trusted automatically: [Apple certificate trust
  guidance](https://support.apple.com/en-gb/102390). Offline field provisioning
  therefore treats CA installation as deployment, not an in-browser workaround.

## Fencing and durable persistence

- Google's [Chubby lock-service paper](https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/)
  is a useful reminder that distributed locks are advisory unless resource
  access is actually fenced. For this single-device product, the simplest
  version-one fence is externally verifiable power/network/key-path isolation;
  a newer epoch alone cannot reach an isolated old writer.
- SQLite documents that WAL writers sync the WAL at each commit with
  `synchronous=FULL`, whereas `NORMAL` can sacrifice durability after power loss:
  [WAL documentation](https://sqlite.org/wal.html) and
  [`PRAGMA synchronous`](https://sqlite.org/pragma.html#pragma_synchronous).
  ADR 0010 selects FULL as the required candidate profile and still requires
  platform power-cut qualification, corruption checks and measured recovery.

## OS-enforced media parsing

- Microsoft documents that AppContainer/LPAC restricts system, user-data and
  network access unless capability SIDs grant it: [Launch an
  AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
  [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
  manage a process tree and enforce resource/accounting limits. The Windows
  image worker uses both: LPAC/AppContainer for access and a non-breakaway job
  for lifetime/resources.
- Apple describes App Sandbox as kernel-enforced least privilege for filesystem,
  network and other resources: [Configuring the macOS App
  Sandbox](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox).
  Apple's entitlement guidance identifies XPC services as the preferred
  privilege-separation mechanism: [Enabling App
  Sandbox](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html).
  The macOS decoder is therefore a separately sandboxed, no-network XPC worker.

## Resulting constraints

Research supports mechanisms, not the product claim. Every selection remains
behind machine-readable manifests, named OS/hardware/filesystem/browser tuples,
fault injection and signed evidence. Unsupported or unprovable capability fails
closed: mutation stops, image ingestion disappears, or a client cannot become
show-ready while capture/listening and conventional intercom fallback remain.
