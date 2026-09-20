# A2 media clock

This zero-external-dependency crate implements deterministic clock arithmetic
for the current 48 kHz media profile.

It derives RTP timestamps from source-frame positions, preserves gaps, handles
RTP wrap, validates bounded adjacent discontinuities, and rejects source-frame
overflow. RTCP projections bind RTP and NTP to the same source frame and fence
anchors by node boot, source epoch, media-session epoch and worker generation.
NTP era and uncertainty growth remain explicit.

Callers supply random RTP bases/SSRCs and measured wall anchors. This crate does
not access clocks, generate randomness, encode Opus, implement WebRTC, or prove
browser/network behavior.

Run focused checks with:

```sh
cargo test -p a2-media --locked
cargo clippy -p a2-media --all-targets --locked -- -D warnings
```
