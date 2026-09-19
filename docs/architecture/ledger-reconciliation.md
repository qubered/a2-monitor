# Control-ledger reconciliation and pruning

**Status:** Normative design baseline for protocol v0

## Chunk format

The node closes immutable chunks at a bounded event count/byte size or
performance boundary. A chunk header contains node/boot/performance/authority
IDs, first/last sequence, prior-chunk hash, event Merkle root, schema IDs,
created time and byte count. The node signs the JCS header and provides each raw
event, event hash and inclusion order. Open chunks are recoverable but cannot be
pruned.

## Import protocol

1. Backend requests from its last durable cursor and validates authority,
   sequence continuity, chunk/signature/hash chain and schemas.
2. In one backend transaction it inserts raw events idempotently, advances the
   import cursor, updates projections and inserts outbox records. Projection or
   outbox failure rolls the entire transaction back.
3. After commit, the backend builds a signed `ImportReceipt` containing chunk
   hash, imported range, projection version and backup generation.
4. The backup barrier is satisfied only after that generation is present and
   verified in the evidence/backup store. The backend then issues a signed
   `PrunePermit` for an exact closed chunk hash and range.
5. The node durably records the permit and a compaction marker before removing
   chunk payload. It retains header/hash/permit/result through audit retention.

Retries at every step are idempotent. A backend receipt without backup generation
cannot authorize pruning. A node crash during compaction either retains the
chunk or proves the exact permit/marker on recovery.

Performance close is a command, not inferred inactivity. It requires no open
canonical transaction, lease closure, sealed final chunk and a final import
receipt. An old-epoch or post-fence tail is imported only into a quarantine
store; it never updates projections until the ADR 0008 classification records a
canonical decision.

## Resource contract

Canonical ledger writes have reserved disk bytes, write IOPS and 99th-percentile
fsync latency above replay and collaboration. Chunking, hashing, upload and
compaction execute on storage workers, not the callback. Reconciliation backs
off under capture stress; mutation stops at the ledger safety floor rather than
evicting an accepted event.

Replay writer and readers have separate queues and budgets. The writer owns its
reserved sequential bandwidth. Readers use bounded prefetch/cache, a maximum of
two admitted concurrent readers in Phase 1A, one outstanding seek per client and
newest-seek-wins cancellation. Admission closes when measured disk latency or
writer backlog crosses the profile threshold.
