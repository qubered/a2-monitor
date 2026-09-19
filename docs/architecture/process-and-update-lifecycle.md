# Process, session, and update lifecycle

**Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).

## Process ownership

The standard appliance uses two independently supervised user-session trees.
Loss of the management tree cannot restart or stop the native node tree.

| Process | Account/session | Authority and resources | Supervised by | Failure effect |
| --- | --- | --- | --- | --- |
| Node supervisor | dedicated logged-in show user | creates node boot ID; launches native workers; owns their lifecycle handles | OS logon task / `SMAppService` LaunchAgent | node becomes unavailable; backend remains diagnostic-only |
| Audio engine | show user; highest permitted audio priority | only process that opens the selected audio device; owns capture clock and producer rings | node supervisor | all live capture stops; no fallback device is opened |
| Canonical sequencer | restricted native child | sole node-ledger writer and holder of the boot authority grant/append handle | node supervisor | control becomes read-only; capture and existing media continue where safe |
| Media worker | restricted/sandboxed native child | UDP, ICE/DTLS/SRTP/SCTP, Opus and peer state; no ledger append or audio-device handle | node supervisor logically; launchd hosts an XPC service on macOS | all peers on that shard enter `interrupted`; capture continues |
| Client gateway | restricted/sandboxed native child | verifies direct-client lease/proof/signature and forwards bounded canonical commands | node supervisor logically; launchd hosts an XPC service on macOS | direct outage control unavailable; media may continue |
| Replay worker | restricted/sandboxed native child | bounded replay mappings and replay store only | node supervisor, or launchd if the macOS sandbox spike requires XPC | replay unavailable; capture/live media continue |
| Receiver adapter worker | one restricted/sandboxed child per vendor/failure shard | approved receiver interface and normalized telemetry/control contract | node supervisor logically; launchd hosts an XPC service on macOS where sandboxed | affected vendor telemetry/control stale; capture continues |
| Backend supervisor | dedicated logged-in show user | starts one pinned Node runtime/backend; owns restart budget only for that tree | separate OS logon task / LaunchAgent | backend restarts without touching node workers |
| Fastify backend | show user with restricted filesystem/network policy | HTTPS, auth, show DB, signaling, static Manager/Live assets | backend supervisor | Manager/collaboration unavailable; existing authorized media continues |
| Storage worker | Node worker thread initially | sole backend database connection/writer queue; event-loop isolation, not OS crash isolation | Fastify backend | backend fails/restarts on native crash; audio node unaffected |

The storage worker description is deliberate: a Node worker thread protects the
HTTP event loop from synchronous SQLite work, but a native-addon process crash
can still terminate the backend. No document calls it an operating-system
security boundary. A separate storage process is introduced only if measured
backend recovery or native-addon risk requires it.

## Browser control path

The media worker necessarily terminates the WebRTC data channel. It treats every
message as untrusted bytes and forwards only a bounded envelope to the client
gateway. The gateway validates the closed command type, lease, proof of
possession, node boot/authority epoch, replay/idempotency identity and signature.
It then forwards the canonical bytes to the sequencer. Only the sequencer can
append and acknowledge a canonical runtime mutation.

No media-worker, gateway, backend or receiver worker receives the sequencer's
database append handle. The supervisor passes each child only the handles and
secrets required for its role.

“Supervised” means health, restart budget, generation and quarantine ownership.
On Windows the node supervisor also creates the processes. For a macOS XPC
service, launchd creates/restarts the process while the node supervisor owns the
connection generation, readiness and circuit-breaker policy; it does not fight
launchd with a second process manager.

## Platform launch and confinement

### Windows 11

- The installer registers separate logon-triggered tasks for the node and
  backend supervisors under the dedicated show account.
- Workers use restricted tokens derived from the supervisor token and individual
  Job Objects with process, memory, handle, CPU-notification and
  kill-on-supervisor-close policy.
- The audio engine is not placed in a restriction profile that prevents ASIO,
  WASAPI or MMCSS; it is still denied unrelated network/database handles by
  construction.
- Named kernel objects are avoided. Shared mapping and event handles are
  duplicated into the intended child. Random named pipes use an owner-only DACL,
  expected child PID/token, boot nonce and protocol handshake.
- Service SIDs are used only if a future component is actually launched by the
  Service Control Manager. They are not claimed for scheduled-task children.

### macOS

- A signed application bundle registers separate node and backend LaunchAgents
  through `SMAppService`. `requires_user_approval` and `disabled_by_user` are
  explicit readiness states.
- The audio engine and node supervisor run in the logged-in audio session with
  hardened runtime and the minimum device entitlements proven by Phase 0D.
- Network-facing media, gateway and receiver helpers are signed XPC services
  with App Sandbox/App Group entitlements where the platform spike passes.
- App Group names scope shared memory, Unix sockets and permitted storage. The
  supervisor remains the only source of per-boot resource names and capabilities.
- If an exact helper cannot operate in App Sandbox, its exception is recorded and
  evidence proves a reduced process-only boundary. Separate Unix users are not
  asserted without a launch/privilege design that actually creates them.

## Session and readiness state

The version-one reference profile uses manual login. It does not store a show-
account password for automatic login.

Readiness states include:

1. `machine_booting`;
2. `login_required`;
3. `session_starting`;
4. `node_workers_starting`;
5. `device_preflight_required`;
6. `audio_ready`; and independently
7. `backend_starting` / `backend_ready` / `backend_degraded`.

Power-to-login-prompt and login-to-audio-ready are separate measurements. The
initial 120-second recovery target starts when the supported show user completes
login. A future unattended appliance profile requires its own physical-security,
full-disk-encryption, credential-recovery and autologin ADR.

Locking the existing session does not deliberately stop capture, but logout does.
The UI never equates a booted machine, registered LaunchAgent or healthy backend
with an open and verified audio device.

## Restart policy

- Each worker has a bounded exponential restart budget and a circuit breaker.
- Audio-engine restart always creates a new capture epoch and requires explicit
  device verification; no default device is opened.
- Sequencer restart performs ledger integrity/head checks before accepting
  mutations.
- Media-worker restart creates fresh WebRTC sessions. Clients become
  `interrupted`; latched listen is cancelled and gain/source restoration follows
  the safe reconnect contract.
- Backend restart never restarts the node tree.
- Repeated parser/receiver failure quarantines only the responsible worker.

## Immutable application slots

Mutable databases, replay, assets, logs, certificates and evidence are outside
the application slots. A slot contains only signed executables, the pinned Node
runtime, compiled JS/static assets, native libraries/addons and its manifest.

The installation owns:

- `current`: an ACL-protected activation record naming one immutable slot;
- `previous`: the last health-confirmed compatible slot;
- `pending`: a fully verified but inactive slot; and
- a monotonic installed-release counter used by rollback policy.

The stable signed bootstrap reads the activation record and refuses an invalid
signature, unsupported schema range, incomplete executable inventory or older
release that violates the rollback policy.

## Offline update transaction

Updates are administrative, offline-capable and forbidden during an active
performance.

1. Verify package signature, release counter, hashes, SBOM and compatibility
   against the currently active data/schema versions.
2. Create and verify a backup plus projection-rebuild point.
3. Install into a new immutable slot without modifying `current`.
4. Run read-only compatibility/preflight checks.
5. Stop the two process trees through their documented shutdown protocol.
6. Apply expand/migrate steps that remain readable by `previous` or declare the
   maintenance point irreversible before proceeding.
7. Atomically replace the activation record.
8. Start and health-check node/backend without opening an unapproved device.
9. Mark the slot healthy only after process, ledger, schema and package checks.
10. On failure, restore the previous activation record and compatible data state;
    retain evidence of the failed attempt.

Windows Installer rollback protects the package transaction, but it is not used
as a substitute for product/data rollback. macOS package installation follows
the same slot/activation contract. Power-cut tests target every numbered
boundary on both filesystems.

No updater/CDN is selected yet. The same state machine applies whether a future
release arrives by removable media, managed deployment or a signed local update
service.
