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

Do not add infrastructure automation before the supported OS and packaging
model are selected through an ADR.

Windows and macOS are both product targets. Their service supervision,
keystore, firewall, update, and recovery profiles may differ while preserving
the same security and availability contract.
