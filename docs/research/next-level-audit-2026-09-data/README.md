# Latency harness results, 2026-09-27

Raw JSON records behind [G4 of the 2026-09 audit](../next-level-audit-2026-09.md#g4--the-audio-core).

- **Source:** `tools/latency/run.mjs` (harness as committed in `6d42a96`)
  against the application at `421f319`; one file per run, named as in the
  audit's run table.
- **Regenerate:** follow [tools/latency/README.md](../../../tools/latency/README.md),
  e.g. `node tools/latency/run.mjs --seconds 150 --chain element --out B-element.json`.
  The 5 ms and 2.5 ms runs used a scratch build with `FRAMES_PER_BLOCK` set to
  240 or 120 (and `METER_INTERVAL_BLOCKS` scaled to keep 50 ms meters); that
  change is not committed.
- `L-live-*.json` time the shipped Live app itself (`--live <built Live>
--tap-after 15 --seconds 25`, Live's own UI at build `5e10f51`), measured
  from the tap on the card for input 1.
- **Host:** Linux container, 4 vCPU Intel Xeon 2.8 GHz, 15 GB RAM, kernel
  6.18; Chromium 141.0.7390.37 headless; PulseAudio 16.1 null sink at 48 kHz.
  No physical network: loopback, or the harness's UDP impairment relay.

These are synthetic, same-host measurements. They are not capture-to-ear
results and make no browser, hardware or Wi-Fi support claim.
