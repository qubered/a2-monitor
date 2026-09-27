#!/usr/bin/env node
// Stand-in for `pulse-device-capture` used only by the latency harness.
//
// It speaks the same stdout contract (one JSON header line, then interleaved
// Float32LE frames at 48 kHz) and paces 128-frame chunks against the wall clock
// the way a device callback with a 128-frame buffer would. Channel 1 carries a
// 4 ms 2 kHz burst at a randomised interval; channel 2 carries a steady 1 kHz
// tone for switch timing. Every burst onset is logged to $PULSE_CLICK_LOG with
// the wall-clock time at which the chunk holding it was written to the pipe.
//
// Nothing here is evidence about a real audio interface: driver, DVS and ADC
// buffering happen before this reference point and are not included.

import { appendFileSync, writeSync } from "node:fs";

const RATE = 48_000;
const CHANNELS = 2;
const CHUNK = 128;
const BURST_FRAMES = Math.round(0.004 * RATE);
const logPath = process.env.PULSE_CLICK_LOG;
const toneOn = process.env.PULSE_CLICK_TONE !== "0";
const burstsOn = process.env.PULSE_CLICK_BURSTS !== "0";
const intervalS = Number(process.env.PULSE_CLICK_INTERVAL_MS ?? "1000") / 1000;

const device = process.argv[process.argv.indexOf("--device") + 1] ?? "clicks";
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 0, deviceName: device, sampleRateHz: RATE, channelCount: CHANNELS })}\n`,
);

const wall = () => performance.timeOrigin + performance.now();
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const samples = new Float32Array(CHUNK * CHANNELS);
const bytes = Buffer.from(samples.buffer);

let frame = 0;
let nextOnset = burstsOn ? RATE : -1; // first burst after one second
let burstStart = -1;
const start = performance.now();
for (;;) {
  const due = start + ((frame + CHUNK) / RATE) * 1000;
  const wait = due - performance.now();
  if (wait > 0) Atomics.wait(sleeper, 0, 0, wait);

  let onsetInChunk = -1;
  for (let i = 0; i < CHUNK; i += 1) {
    const f = frame + i;
    if (f === nextOnset) {
      burstStart = f;
      onsetInChunk = i;
      // ±10 % around the interval, never phase-locked to the 10 ms Opus block.
      nextOnset =
        f + Math.round(RATE * intervalS * (0.9 + Math.random() * 0.2));
    }
    const inBurst = burstStart >= 0 && f - burstStart < BURST_FRAMES;
    samples[i * CHANNELS] = inBurst
      ? 0.5 * Math.sin((2 * Math.PI * 2000 * (f - burstStart)) / RATE)
      : 0;
    samples[i * CHANNELS + 1] = toneOn
      ? 0.25 * Math.sin((2 * Math.PI * 1000 * f) / RATE)
      : 0;
  }
  writeSync(1, bytes);
  if (onsetInChunk >= 0 && logPath) {
    // The onset sample was the (CHUNK - onsetInChunk)th-from-last in the chunk
    // just handed over; a device callback would deliver it at the same moment.
    appendFileSync(
      logPath,
      `${JSON.stringify({ frame: burstStart, wallMs: wall() })}\n`,
    );
  }
  frame += CHUNK;
}
