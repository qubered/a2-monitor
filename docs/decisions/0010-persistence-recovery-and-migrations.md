# ADR 0010: Persistence, recovery, and migration contract

- **Status:** Accepted as a required profile; implementation remains Phase 0B
- **Date:** 2026-09-19
- **Owners:** Project team
- **Supersedes:** None

## Context

Acknowledged show mutations, ledger reconciliation, evidence, attachments and
upgrades need one testable durability meaning. “Durable” without filesystem,
flush, corruption and recovery assumptions is not a contract.

## Decision

The reference backend and node control-ledger profile uses SQLite on a local,
fixed, supported filesystem in WAL mode with `synchronous=FULL`, foreign keys
enabled, application IDs and explicit schema/user versions. Database files and
WALs are not hosted on SMB/NFS, cloud-sync folders or removable media. Automatic
WAL checkpointing is disabled; a storage worker performs measured checkpoints
outside the real-time path.

Every shipped process uses a pinned bundled SQLite containing the WAL-reset fix:
SQLite 3.51.3 or newer. Startup records and asserts `sqlite_version()` plus
compile options. It never silently substitutes an older operating-system
library. The backend uses one owner/writer queue through the ADR 0015 storage
worker; the node owns a different database through bundled `rusqlite`. No two
components share one database file. Extension loading is disabled.

An accepted canonical command is acknowledged only after its transaction has
committed under this profile. Node and backend each reserve control-ledger space,
write latency and IOPS independently of replay, assets and logs. A UPS reduces
risk but does not replace flush semantics. Phase 0B power-cut tests may reject
SQLite, a filesystem or a drive; this ADR specifies the semantics, not a waiver.

Each durable event stores schema ID, original bytes, JCS SHA-256, prior event
hash and transaction/result identity. Startup performs quick integrity and hash-
chain checks before mutation; scheduled deep scrubs run outside performances.
Any unexplained break makes the affected authority read-only and raises a
recovery incident.

### Recovery objectives

- **Node ledger:** RPO 0 for any acknowledged canonical command; 99th-percentile
  crash restart to read-only inspection within 30 seconds and mutation-ready
  within 60 seconds on a named supported profile.
- **Backend live service:** RPO 0 for acknowledged database commands; ordinary
  process crash recovery within 120 seconds.
- **Disaster restore:** configuration/event backup RPO at most 24 hours and RTO
  at most 60 minutes on the reference appliance. Node-ledger import after a show
  narrows the effective performance RPO.
- **Published media blob:** RPO 0 after its `ready` event. Before `ready`, the
  upload may be safely retried or garbage-collected.

### Backup and migration

Backups use the SQLite online-backup API or a documented closed-copy procedure,
then hash every database/blob, record schema/application versions and sign the
manifest. Restore is verified monthly and before an irreversible migration.

Schema changes use expand/migrate/contract. Releases declare minimum/maximum
read and write schema versions and old/new node-backend protocol pairs. Startup
refuses unsafe writers. Contract steps and irreversible transforms require a
verified backup, a projection-rebuild tool, a rollback plan and a maintenance
gate; rollback never runs old code against a newer write schema by hope.

Blob publication is a saga: create upload intent, quarantine bytes, verify hash
and media policy, durably place a content-addressed blob, commit metadata, then
publish `ready`. Every step is idempotent. Orphan collection observes a minimum
age and backup/evidence pins; deletion uses a tombstone before physical purge.

## Validation

- kill/power-cut at every database, WAL, checkpoint, backup, migration and blob-
  saga boundary on each supported OS/filesystem/storage tuple;
- corrupt pages, WAL frames, event bytes, manifests and blobs and prove detection;
- fill disk and exhaust reserved IOPS while capture/live media continue;
- restore current and previous release backups and rebuild projections; and
- measure every RPO/RTO instead of accepting a successful process exit.
- concurrently write/checkpoint with multiple readers and verify the shipped
  SQLite version against the upstream WAL-reset regression case.
