# Appliance infrastructure

This area will define packaging and deployment for the supported appliance.

Expected responsibilities:

- audio-node and backend service supervision;
- frontend asset serving;
- explicit Dante, receiver-control, and client interface binding;
- local HTTPS and node identity provisioning;
- data directories, retention, backup, and disk-pressure behavior;
- signed offline-capable updates and rollback;
- least-privilege worker identities and sandbox policy;
- default-deny firewall, no IP forwarding, and interface/candidate enforcement;
- local CA, node enrollment, hardware/OS-backed secret storage, and rotation;
- full-disk encryption, UPS behavior, power-safe updates, watchdogs, and
  spare-appliance restore;
- diagnostics export and factory recovery; and
- single-host and split-host installation profiles.

The initial packaging model is selected in ADR 0018: signed MSI on Windows
and a signed, hardened, notarized/stapled flat package on macOS. The audio-node
supervisor starts in the dedicated logged-in show-user session using a Windows
logon task or `SMAppService` LaunchAgent. Boot without that user session is not
reported as audio ready, and the version-one profile requires manual login.
WiX is only the reference MSI authoring implementation after explicit current
commercial/EULA approval.

Application binaries occupy immutable versioned slots; mutable data lives
outside them. A candidate passes signature, compatibility, migration, startup,
selected-device and API health checks before the protected activation selector
changes. The prior compatible slot remains available for rollback, and updates
are blocked during an active performance.

Windows and macOS are both product targets. Their service supervision,
keystore, firewall, update, and recovery profiles may differ while preserving
the same security and availability contract.

The platform-neutral unsigned layout-smoke generator and its closed manifest
contract are documented in [`common/README.md`](common/README.md). It stages
only explicit, already-built inputs into an inactive version slot; it is not an
installer or activation mechanism.

The Darwin-only unsigned flat-package smoke wrapper is documented in
[`macos/README.md`](macos/README.md). The PowerShell boundary that emits a
Windows-consumable unsigned layout, but no MSI, is documented in
[`windows/README.md`](windows/README.md). Neither path installs or activates a
slot.
