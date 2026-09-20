# A2 native IPC

This crate owns codec-neutral local-control framing and the Phase 0T codec
comparison harness. It does not own transport sockets, runtime routing, shared
PCM rings, or show-domain authority decisions.

Each control frame is exactly a network-order (`u32` big-endian) payload length
followed by that many payload bytes. A decoder rejects a declared length above
its configured message-class limit before allocating payload storage. After a
protocol error, the decoder remains failed because the connection must close.

`CanonicalJsonCodec` and `ProtobufCodec` encode the same project-owned semantic
messages. They are comparison candidates, not a codec-selection decision. The
harness records encoded size and checks semantic round trips. Version 2 worker
ready and heartbeat messages carry a 128-bit boot ID, worker ID, typed role,
generation, and typed readiness evidence or heartbeat sequence. JSON renders a
boot ID as exactly 32 lowercase hexadecimal characters; Protobuf carries the
same value as exactly 16 big-endian bytes. Both candidates reject zero boot IDs,
generations and heartbeat sequences, reject role/evidence mismatches, and fail
closed on version 1 worker messages. The original version 1 health-probe golden
vector remains accepted so the comparison can measure that unchanged baseline;
health probes may also use version 2.

JSON rejects unknown fields; Protobuf ignores unknown fields as required for
additive wire compatibility. The Protobuf v1 worker-ready nested fields remain
occupied and are rejected rather than reinterpreted as v2 identity fields.
Neither codec carries PCM, and neither changes the RFC 8785 canonical
representation used by signed public commands. These in-memory codec vectors do
not select a codec, integrate a local transport, or prove runtime supervision.

Run the focused checks with:

```sh
cargo test -p a2-ipc
cargo clippy -p a2-ipc --all-targets -- -D warnings
```
