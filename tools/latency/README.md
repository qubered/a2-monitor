# Listen-path latency harness

Measures the shipped listen path — `pulse-media-worker` → str0m → Opus →
Chromium — from the moment a capture chunk reaches the worker's pipe to the
moment the sample arrives at an audio sink. It exists so latency claims come
with a method, not an estimate. Results and their interpretation live in
[the 2026-09 audit](../../docs/research/next-level-audit-2026-09.md#g4--the-audio-core).

## What it measures, and what it does not

```
click-capture.mjs ──pipe──▶ pulse-media-worker ──UDP/SRTP──▶ Chromium ──▶ PulseAudio null sink ──▶ parec
 (reference: chunk                (real)          [optional     (Live's      (Chrome's real            (stamped on
  written to pipe)                                 impairment    listen        output stack)            arrival)
                                                   relay]        chain)
```

- **Reference point:** the wall-clock time `click-capture.mjs` hands the
  128-frame chunk holding a burst onset to the pipe, i.e. where a device
  callback would deliver it. ADC, driver and Dante/DVS buffering happen
  _before_ this point and are **not** included.
- **End point:** the burst's first sample above 0.1 at the PulseAudio sink,
  stamped from the arrival time of `parec`'s chunk. The page also records
  Chromium's own estimate (`AudioContext.getOutputTimestamp()`); the two agree
  to about 1 ms in every run so far.
- **Not included:** the output device after the sink (DAC, USB, Bluetooth,
  headphone amp). On this harness Chromium reports `outputLatency` for the
  Pulse sink; a real device reports its own. **This is not a capture-to-ear
  number.** It is the part of capture-to-ear that Pulse controls, measured.

The physical method in [latency.md](../../docs/architecture/latency.md#test-method)
(impulse into the Dante source, source and headphone output recorded on one
interface) remains the gate for any capture-to-ear claim.

## Running it (Linux)

Needs Node ≥ 24, a release `pulse-media-worker`, a built listen gateway,
PulseAudio, and `playwright-core` with a Chromium binary.

```sh
cargo build --locked --release --bin pulse-media-worker
npm run build --workspace @rvlt/pulse-listen-gateway

# A throwaway PulseAudio with a 48 kHz null sink.
cat > /tmp/pa.pa <<'EOF'
load-module module-null-sink sink_name=probe rate=48000
load-module module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulse.sock
set-default-sink probe
EOF
pulseaudio -n -F /tmp/pa.pa --exit-idle-time=-1 --daemonize=no &
export PULSE_SERVER=unix:/tmp/pulse.sock

npm i --prefix /tmp/pw playwright-core
export PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core

node tools/latency/run.mjs --seconds 150 --out /tmp/webaudio.json
```

Options:

| Option                                  | Meaning                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--chain webaudio`                      | Live's chain: muted `<audio>` + `MediaStreamAudioSourceNode` → gain → destination (default).                                                                                   |
| `--chain element`                       | Plain unmuted `<audio>`, no Web Audio.                                                                                                                                         |
| `--jbt <ms>`                            | Set `RTCRtpReceiver.jitterBufferTarget`.                                                                                                                                       |
| `--mode switch`                         | Input 1 silent, input 2 a steady tone; alternate every second and time `PUT …/channel` → first tone sample at the sink.                                                        |
| `--impair loss=1,jitter=2-8,stall=1:60` | Route media through a FIFO-preserving UDP relay: % loss, uniform extra delay in ms, % of packets starting a stall of up to N ms. Not a model of any named access point.        |
| `--extra <n>`                           | Open `n` more listen sessions (played muted) for CPU scaling.                                                                                                                  |
| `--worker <path>`                       | Media worker binary (default `target/release/pulse-media-worker`).                                                                                                             |
| `--live <dir> --tap-after <s>`          | Serve a built Live (e.g. `apps/live/dist`) instead of the probe page; open it, wait, tap input 1's card as a user gesture, and time bursts from the tap. No autoplay override. |
| `--chromium <path>`                     | Browser binary (or `PULSE_CHROMIUM`).                                                                                                                                          |

Each run prints and optionally writes one JSON record: capture→sink
percentiles, Chromium's estimate, a per-burst latency series against time since
the page started listening, the per-second mean jitter-buffer delay, concealed
samples, packets lost, the negotiated/offered codecs, and the worker's CPU and
RSS. Bursts are 4 ms of 2 kHz on input 1 at 0.9–1.1 s intervals, never
phase-locked to the 10 ms Opus block.
