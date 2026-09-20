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
harness records encoded size and checks semantic round trips. Both candidates
reject every protocol version except the explicitly supported version 1. JSON rejects
unknown fields; Protobuf ignores unknown fields as required for additive wire
compatibility. Neither codec carries PCM, and neither changes the RFC 8785
canonical representation used by signed public commands.

Run the focused checks with:

```sh
cargo test -p a2-ipc
cargo clippy -p a2-ipc --all-targets -- -D warnings
```
