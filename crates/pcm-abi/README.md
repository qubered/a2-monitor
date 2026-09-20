# A2 shared PCM ABI model

This zero-dependency crate owns the checked, little-endian descriptor/region
layout, consumer-control-page bytes, and deterministic state-machine model for
page-separated shared PCM rings. ABI minor 2 defines candidate producer-state,
consumer-claim, 64-byte slot-header and 64-byte exact-loss-ledger fields for an
ordinary-PCM ownership protocol. Non-ledger diagnostic-page bytes remain
unfrozen.

The model allocates all storage during construction. Publication performs no
allocation, lock, wait, I/O or logging. Producer-owned sequence numbers select
slots; consumer-controlled bytes can report progress but never address memory.
Invalid version, generation, epoch or cursor state produces a bounded fault or
remap result. Capacity pressure produces explicit overwrite, drop or fence
outcomes, and publication identities never wrap.

This is not an OS shared-memory implementation. Three deliberately separate
models exist:

- `SharedPcmRing` is the legacy minor-1, single-threaded serialized model;
- `ConcurrentPcmRing` stores every metadata and sample word atomically as a
  concurrent reference; and
- `OrdinaryPcmRing` is the minor-2 candidate that uses ordinary metadata/PCM
  only after a full-sequence producer-intent/consumer-claim handshake grants
  exclusive access.

The ordinary model reserves `u64::MAX` as the no-claim/uncommitted sentinel and
never wraps publication identities. The producer publishes overwrite intent
before touching a victim; an exact consumer conflict terminally drops the
incoming source block instead of waiting. Separate bounded producer-owned
overwrite and dropped-input journals prevent a delayed drop record from hiding
an older overwrite; the consumer merges eligible heads by publication order.
Dropped-input records become eligible only after older retained publications.
Saturation of either journal fences the mapping and
rejects the incoming block rather than hiding loss. Claims are cleared by RAII for in-
process unwinds, but that is not process-crash recovery: a crashed/hung peer
requires supervisor-confirmed death and a fresh mapping generation.

None of the models proves cross-process Rust/C/C++ atomic layout, object
lifetime, lock-freedom, cache coherency or crash behavior. Platform code must
separately provide OS mappings, authenticated handles, least-write views,
alignment checks, cleanup and confinement before these candidate bytes can be
used between processes.

Run the focused checks with:

```sh
cargo test -p a2-pcm-abi --locked
cargo clippy -p a2-pcm-abi --all-targets --locked -- -D warnings
```
