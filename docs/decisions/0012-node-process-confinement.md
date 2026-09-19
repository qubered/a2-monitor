# ADR 0012: Cross-platform node process confinement

- **Status:** Accepted for Phase 0B implementation
- **Date:** 2026-09-19
- **Owners:** Security/platform and audio-runtime owners

## Decision

The foreground appliance is a supervisor plus least-privilege workers. The
capture process alone opens the selected audio device. It has no Internet or
vendor-network client, database, image decoder or browser parser. Its callback
writes fixed-size shared-memory frames and counters only. The canonical
sequencer alone holds the boot grant and append handle. Media gateway, receiver
adapters, replay, importer and image decoder never receive them.

IPC endpoints and shared-memory objects are created by the supervisor with
random names, authenticated peer identity, explicit owner ACLs and fixed maximum
sizes. Messages use closed schemas and length-prefix bounds. Shared rings have a
single declared writer/reader, generation, boot ID and corruption counters; a
worker cannot substitute its own mapping. Child processes cannot inherit device,
ledger, signing or listening sockets unless explicitly listed.

On Windows, workers run under distinct service SIDs/restricted tokens with
deny-only administrative groups, low-integrity/AppContainer where compatible,
job-object child/process/memory limits, explicit named-pipe/file-mapping ACLs,
Windows Firewall egress rules and no interactive desktop. Capture uses only the
minimum audio/MMCSS rights proven necessary.

On macOS, workers run as separate unprivileged users or hardened helper
identities with sandbox profiles, hardened runtime/library validation, explicit
Mach/shared-memory/file permissions and per-worker network allow-lists. Capture
receives only required Core Audio and Audio Workgroup access. No component runs
as root after supervisor setup; privileged installation/update is a separate,
non-show service.

Receiver adapters can reach only configured receiver addresses/ports. Gateway
can reach only declared ICE/media peers. Import/image workers have no receiver
or audio-device access. Replay has read-only sealed media plus its bounded output
area. Crash/restart backoff and circuit breakers prevent storms. If an OS cannot
enforce the profile, that feature is disabled or moved to another host.

## Validation

CI checks manifests and IPC schemas; lab tests enumerate tokens, SIDs/users,
handles, mappings, children and sockets. Adversarial workers attempt undeclared
file, IPC, process, audio-device and network access; every attempt must fail.
Malformed IPC, worker crash/hang, restart storm and shared-memory corruption must
not interrupt capture or grant canonical authority. Supported OS builds retain
these tests as signed Phase 0B artifacts.

## Consequences

Sandbox profiles are shipped product configuration, not deployment advice.
Driver or SDK constraints that demand administrator/root execution disqualify
that integration from the supported in-process appliance profile.
