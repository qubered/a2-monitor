# ADR 0012: Cross-platform node process confinement

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
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

On Windows, logon-task children use restricted tokens derived from the show
user's primary token and individual Job Objects with child/process/memory/handle
limits and kill-on-supervisor-close behavior. Service SIDs are used only by a
future process actually launched by the Service Control Manager; they are not
claimed for ordinary scheduled-task children. Prefer inherited/duplicated
handles to named objects. Random named pipes add an owner-only DACL, expected
child PID/token, boot nonce and protocol handshake. AppContainer is a later
strengthening option only after it proves the required UDP and local IPC path.
The audio engine retains only the audio/MMCSS access proven necessary.

On macOS, the signed app bundle registers its user-session LaunchAgents through
`SMAppService`. Network-facing media, gateway and receiver helpers use signed
sandboxed XPC services and App Group-scoped shared memory/sockets where the
packaged Phase 0D spike proves the required access. The plan no longer assumes
separate Unix users that the LaunchAgent does not create. A helper that cannot be
sandboxed receives a documented process-only exception rather than a false
privilege-isolation claim. Capture receives only required Core Audio and Audio
Workgroup access. No show process runs as root; privileged installation/update
is stopped-state administrative work.

Receiver adapters can reach only configured receiver addresses/ports. Gateway
can reach only declared ICE/media peers. Import/image workers have no receiver
or audio-device access. Replay has read-only sealed media plus its bounded output
area. Crash/restart backoff and circuit breakers prevent storms. If an OS cannot
enforce the profile, that feature is disabled or moved to another host.

## Validation

Before ordinary scaffolding, signed development packages prove the real launch,
token/sandbox, App Group and handle-passing topology without requiring ASIO
licence material in the repository. CI checks manifests and IPC schemas; lab
tests enumerate tokens/users, handles, mappings, children and sockets.
Adversarial workers attempt undeclared
file, IPC, process, audio-device and network access; every attempt must fail.
Malformed IPC, worker crash/hang, restart storm and shared-memory corruption must
not interrupt capture or grant canonical authority. Supported OS builds retain
these tests as signed Phase 0B artifacts.

The exact process tree, gateway/sequencer hop and restart ownership are normative
in [the process lifecycle](../architecture/process-and-update-lifecycle.md). The
PCM access model is normative in
[the native IPC ABI](../architecture/media-clock-and-ipc-abi.md).

## Consequences

Sandbox profiles are shipped product configuration, not deployment advice.
Driver or SDK constraints that demand administrator/root execution disqualify
that integration from the supported in-process appliance profile.
