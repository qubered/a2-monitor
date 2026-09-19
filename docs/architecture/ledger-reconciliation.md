# Control-ledger reconciliation and pruning

**Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).

The schemas this document referenced are withdrawn. The design below is
retained for its reasoning; it must be re-derived against a working runtime
rather than restored as written.

## Chunk and order

The node closes immutable chunks at a bounded count/size or performance
boundary. The signed header binds node/boot/performance/authority IDs,
first/last sequence, prior-chunk hash, event Merkle root, schema IDs, time and
bytes. No machine-readable contract exists: the `schema/v0` tree was withdrawn
because its chunk schema accepted arbitrary event objects and represented
neither per-event hash nor inclusion order.
Open chunks are recoverable but never prunable. Canonical global position is
`(authority_epoch, authority_sequence)`; UTC never resolves order.

The node fsyncs an independent local head after every accepted event and before
ACK. Sealed heads are also anchored by backend-signed import receipts. Before
mutation after reconnect/restore, backend and node compare their last heads. A
node behind the backend anchor enters `rollback-suspected` read-only state until
explicit recovery or re-enrollment. Restoring an appliance image resets node
identity. Version one does not claim offline detection if an attacker restores
both ledger and every OS-protected local anchor; hardware monotonic anchoring is
a future profile. Power-loss/WAL and connected rollback detection are mandatory.

## Import protocol

1. Backend requests from its durable cursor and verifies authority, global
   position, signature/hash chain, Merkle contents and schemas.
2. One transaction inserts raw events idempotently, advances the cursor,
   updates projections and writes outbox rows. Any failure rolls it all back.
3. Backend signs an exact `ImportReceipt` with chunk/range, projection version
   and backup generation.
4. Only after that generation is verified in backup/evidence storage may it sign
   an exact `PrunePermit`.
5. Node records permit and compaction marker before payload removal, retaining
   header/hash/permit/result for audit.

All retries are idempotent. Receipt without verified backup cannot prune. Crash
during compaction either retains payload or proves exact permit/marker. A
performance close requires no open canonical transaction, lease closure, sealed
final chunk and final receipt. Old-epoch/post-fence tails import to quarantine
only.

Projection changes use a checked `MigrationManifest` binding source
head/schema, target schema/version and migration binary. Rebuild
writes a parallel projection, verifies counts and hashes, then atomically selects
it. It never rewrites raw events.

## Resource contract

Canonical writes have measured supported-profile floors for disk bytes, write
IOPS and p99 fsync latency above replay/collaboration. These are SLOs, not an OS
promise of hard shared-disk reservation. A tuple that misses them moves replay
or backend to separate storage/host, or disables lower-priority work. Mutation
stops at the ledger safety floor rather than evicting an accepted event.

Writer/readers have separate queues. Phase 1A permits at most two readers, one
outstanding seek/client and newest-seek-wins cancellation. Admission closes on
disk latency or writer backlog thresholds.

## Phase placement

Phase 0B proves sealing/import, receipt comparison and crash idempotency. Phase
1A.1 ships minimum live import, head comparison and projection rebuild before
offline identity mutation. Exact pruning, backup barrier, compaction recovery,
migration and restore hardening remain Phase 1A.3.
