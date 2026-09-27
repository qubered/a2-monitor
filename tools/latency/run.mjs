#!/usr/bin/env node
// Same-host listen-path latency harness. See tools/latency/README.md.
//
//   node tools/latency/run.mjs --chain webaudio --seconds 60 --out results.json
//
// Starts the real listen gateway and pulse-media-worker with click-capture.mjs
// as the capture process, plays the stream in Chromium into a PulseAudio null
// sink, records that sink's monitor, and matches every logged burst onset to
// (a) the time Chromium's Web Audio clock says it leaves for the output device
// and (b) the time it actually arrives at the sink.

import { spawn, spawnSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const chain = option("chain", "webaudio");
const seconds = Number(option("seconds", "60"));
const jbt = option("jbt", null);
const mode = option("mode", "clicks"); // clicks | switch
const port = Number(option("port", "3101"));
const worker = resolve(
  option("worker", join(repo, "target/release/pulse-media-worker")),
);
const outPath = option("out", null);
const extra = Number(option("extra", "0"));
// Media-direction impairment through a userspace relay, e.g.
//   --impair loss=1,jitter=2-8,stall=1:60   (1 % loss, 2–8 ms uniform extra
//   delay, 1 % of packets start a stall of up to 60 ms). FIFO order is kept.
const impair = option("impair", null);
const label = option("label", `${chain}${jbt === null ? "" : ` jbt=${jbt}`}`);
const chromiumPath = option(
  "chromium",
  process.env.PULSE_CHROMIUM ??
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
);
const pulseServer = process.env.PULSE_SERVER;
const sink = option("sink", "probe");
const RATE = 48_000;

if (!pulseServer)
  throw new Error("Set PULSE_SERVER to the probe PulseAudio server.");
if (!existsSync(worker)) throw new Error(`No media worker at ${worker}.`);

// playwright-core is not a repository dependency; point PLAYWRIGHT_CORE at an
// installed copy (npm i --prefix /somewhere playwright-core) or install it here.
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE
    ? pathToFileURL(join(process.env.PLAYWRIGHT_CORE, "index.mjs")).href
    : "playwright-core"
);
const work = mkdtempSync(join(tmpdir(), "pulse-latency-"));
const clickLog = join(work, "clicks.jsonl");
writeFileSync(clickLog, "");
const device = `clicks-${process.pid}`;

const gateway = spawn(
  process.execPath,
  [join(repo, "services/listen-gateway/dist/start.js")],
  {
    env: {
      ...process.env,
      A2_LISTEN_PORT: String(port),
      A2_AUDIO_DEVICE: device,
      A2_CAPTURE_BIN: join(here, "click-capture.mjs"),
      A2_MEDIA_WORKER_BIN: worker,
      A2_LIVE_DIR: join(here, "page"),
      PULSE_CLICK_LOG: clickLog,
      PULSE_CLICK_TONE: mode === "switch" ? "1" : "0",
      PULSE_CLICK_BURSTS: mode === "switch" ? "0" : "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

// Sink recorder: every sample is stamped from the arrival time of its chunk.
const onsets = [];
const recorder = spawn(
  "parec",
  [
    `--device=${sink}.monitor`,
    "--rate=48000",
    "--channels=1",
    "--format=float32le",
    "--latency-msec=1",
    "--raw",
  ],
  { env: process.env },
);
let quiet = 0;
let loud = 0;
let pending = Buffer.alloc(0);
let sinkSamples = 0;
let sinkPeak = 0;
recorder.stdout.on("data", (chunk) => {
  const arrived = performance.timeOrigin + performance.now();
  pending = Buffer.concat([pending, chunk]);
  const count = Math.floor(pending.length / 4);
  for (let i = 0; i < count; i += 1) {
    const value = Math.abs(pending.readFloatLE(i * 4));
    sinkSamples += 1;
    if (value > sinkPeak) sinkPeak = value;
    const at = arrived - ((count - i) / RATE) * 1000;
    if (mode === "clicks") {
      // Onset: the first sample above 0.1 after at least 100 ms without one.
      // Opus pre-echo ramps up below that level, so it is not the reference.
      if (value > 0.1) {
        if (quiet > 4800) onsets.push(at);
        quiet = 0;
      } else quiet += 1;
    } else {
      // Switch mode: the first sample of a sustained tone after silence.
      if (value > 0.05) {
        loud += 1;
        if (loud === 1 && quiet > 2400) onsets.push(at);
        if (loud > 1) quiet = 0;
      } else {
        quiet += 1;
        loud = 0;
      }
    }
  }
  pending = pending.subarray(count * 4);
});

async function waitForGateway() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/audio/v0/device`);
      if (r.ok && (await r.json()).status === "ready") return;
    } catch {
      // starting
    }
    await delay(200);
  }
  throw new Error("gateway never became ready");
}

function workerCpuTicks() {
  const found = spawnSync("pgrep", ["-f", `pulse-media-worker.*${device}`], {
    encoding: "utf8",
  }).stdout.trim();
  const pid = found.split("\n")[0];
  if (!pid) return null;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    .split(") ")[1]
    .split(" ");
  const rss = Number(stat[21]) * 4096;
  return { pid, ticks: Number(stat[11]) + Number(stat[12]), rss };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return Number(sorted[Math.max(0, index)].toFixed(1));
}
function summary(values) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Number(Math.max(...values).toFixed(1)) : null,
    min: values.length ? Number(Math.min(...values).toFixed(1)) : null,
  };
}

function startRelay(spec) {
  const profile = Object.fromEntries(
    spec.split(",").map((kv) => kv.split("=")),
  );
  const loss = Number(profile.loss ?? 0) / 100;
  const [jMin, jMax] = (profile.jitter ?? "0-0").split("-").map(Number);
  const [stallPct, stallMax] = (profile.stall ?? "0:0").split(":").map(Number);
  const socket = createSocket("udp4");
  let target = null;
  let browserPeer = null;
  let lastDeparture = 0;
  let stallUntil = 0;
  const counts = { forwarded: 0, dropped: 0 };
  let closed = false;
  socket.on("message", (message, from) => {
    if (target && from.address === target.ip && from.port === target.port) {
      // Node → browser: the media direction gets the impairment.
      if (!browserPeer) return;
      if (Math.random() < loss) {
        counts.dropped += 1;
        return;
      }
      const now = performance.now();
      if (Math.random() < stallPct / 100)
        stallUntil = now + Math.random() * stallMax;
      const departure = Math.max(
        lastDeparture,
        stallUntil,
        now + jMin + Math.random() * (jMax - jMin),
      );
      lastDeparture = departure;
      counts.forwarded += 1;
      setTimeout(() => {
        if (!closed)
          socket.send(message, browserPeer.port, browserPeer.address);
      }, departure - now);
    } else if (target) {
      browserPeer = { address: from.address, port: from.port };
      socket.send(message, target.port, target.ip);
    }
  });
  return {
    close() {
      closed = true;
      socket.close();
    },
    counts,
    setTarget(ip, port) {
      target = { ip, port };
    },
    ready: new Promise((resolve) =>
      socket.bind(0, "0.0.0.0", () => resolve(socket.address().port)),
    ),
  };
}

let browser;
let relay = null;
try {
  await waitForGateway();
  browser = await chromium.launch({
    executablePath: chromiumPath,
    ignoreDefaultArgs: ["--mute-audio"],
    args: ["--autoplay-policy=no-user-gesture-required"],
    env: { ...process.env, PULSE_SERVER: pulseServer },
  });
  const page = await browser.newPage();
  let relayAddress = null;
  if (impair) {
    relay = startRelay(impair);
    const relayPort = await relay.ready;
    const lan = spawnSync(
      "sh",
      [
        "-c",
        "ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    relayAddress = `${lan}:${relayPort}`;
    await page.exposeFunction("relayTarget", (ip, port) =>
      relay.setTarget(ip, port),
    );
  }
  const query = new URLSearchParams({
    chain,
    channel: mode === "switch" ? "0" : "0",
  });
  if (jbt !== null) query.set("jbt", jbt);
  if (extra) query.set("extra", String(extra));
  if (relayAddress) query.set("relay", relayAddress);
  await page.goto(`http://127.0.0.1:${port}/?${query}`);
  await page.waitForFunction(
    () => window.results?.ready || window.results?.errors.length,
    null,
    { timeout: 60_000 },
  );

  // Clock agreement between this process and the page (both wall-clock based).
  const offsets = [];
  for (let i = 0; i < 20; i += 1) {
    const before = performance.timeOrigin + performance.now();
    const pageNow = await page.evaluate(() => window.nowWallMs());
    const after = performance.timeOrigin + performance.now();
    offsets.push({
      offset: pageNow - (before + after) / 2,
      rtt: after - before,
    });
  }
  offsets.sort((a, b) => a.rtt - b.rtt);
  const clockOffsetMs = offsets[0].offset; // page minus harness, best RTT sample

  const readyWallMs = performance.timeOrigin + performance.now();
  const cpuStart = workerCpuTicks();
  const wallStart = performance.now();
  if (mode === "switch") {
    // Alternate silence (input 1) and tone (input 2); the tone's first sample
    // at the sink after each switch request is the switch latency.
    await page.evaluate(() => window.switchTo(0));
    for (let t = 0; t < seconds; t += 2) {
      await delay(1000);
      await page.evaluate(() => window.switchTo(1));
      await delay(1000);
      await page.evaluate(() => window.switchTo(0));
    }
  } else {
    await delay(seconds * 1000);
  }
  const elapsedMs = performance.now() - wallStart;
  const cpuEnd = workerCpuTicks();
  await delay(1500);
  const results = await page.evaluate(() => window.results);

  const clicks = readFileSync(clickLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    // Only bursts captured after the page was listening and settled.
    .filter(({ wallMs }) => wallMs > readyWallMs + 1000);
  const firstAfter = (list, from, within) =>
    list.find((t) => t >= from && t < from + within);

  let sinkLatency = [];
  const series = [];
  let graphLatency = [];
  if (mode === "clicks") {
    for (const click of clicks) {
      const sinkAt = firstAfter(onsets, click.wallMs, 800);
      if (sinkAt !== undefined) {
        sinkLatency.push(sinkAt - click.wallMs);
        series.push([
          Number(((click.wallMs - readyWallMs) / 1000).toFixed(1)),
          Number((sinkAt - click.wallMs).toFixed(1)),
        ]);
      }
      const detection = results.detections.find(
        (d) =>
          d.outputWallMs - clockOffsetMs >= click.wallMs &&
          d.outputWallMs - clockOffsetMs < click.wallMs + 800,
      );
      if (detection)
        graphLatency.push(
          detection.outputWallMs - clockOffsetMs - click.wallMs,
        );
    }
  } else {
    for (const sw of results.switches.filter((s) => s.channel === 1)) {
      const sent = sw.sentWallMs - clockOffsetMs;
      const sinkAt = firstAfter(onsets, sent, 1000);
      if (sinkAt !== undefined) sinkLatency.push(sinkAt - sent);
    }
  }
  const stats = results.stats.at(-1) ?? {};
  const first = results.stats[0] ?? {};
  const emitted =
    stats.jitterBufferEmittedCount - (first.jitterBufferEmittedCount ?? 0);
  const record = {
    label,
    mode,
    chain,
    jitterBufferTarget: jbt,
    worker,
    seconds,
    clicksLogged: clicks.length,
    clockOffsetMs: Number(clockOffsetMs.toFixed(2)),
    connectMs: results.connectMs,
    baseLatencyMs:
      results.baseLatency == null ? null : results.baseLatency * 1000,
    outputLatencyMs:
      results.outputLatency == null ? null : results.outputLatency * 1000,
    sinkSeconds: Number((sinkSamples / RATE).toFixed(1)),
    sinkPeak: Number(sinkPeak.toFixed(2)),
    sinkOnsets: onsets.length,
    latencySeries: series,
    captureToSinkMs: summary(sinkLatency),
    captureToBrowserOutputEstimateMs:
      mode === "clicks" && chain === "webaudio" ? summary(graphLatency) : null,
    meanJitterBufferMs:
      emitted > 0
        ? Number(
            (
              ((stats.jitterBufferDelay - (first.jitterBufferDelay ?? 0)) /
                emitted) *
              1000
            ).toFixed(1),
          )
        : null,
    concealedPercent:
      stats.totalSamplesReceived > 0
        ? Number(
            (
              (stats.concealedSamples / stats.totalSamplesReceived) *
              100
            ).toFixed(3),
          )
        : null,
    packetsLost: stats.packetsLost ?? null,
    listeners: 1 + extra,
    impairment: impair,
    relayCounts: relay?.counts ?? null,
    workerCpuPercentOfOneCore:
      cpuStart && cpuEnd
        ? Number(
            (
              ((cpuEnd.ticks - cpuStart.ticks) / 100 / (elapsedMs / 1000)) *
              100
            ).toFixed(1),
          )
        : null,
    workerRssMb: cpuEnd ? Number((cpuEnd.rss / 1e6).toFixed(1)) : null,
    jitterBufferSeriesMs: results.stats.slice(1).map((s, i) => {
      const prev = results.stats[i];
      const n = s.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
      return n > 0
        ? Math.round(
            ((s.jitterBufferDelay - prev.jitterBufferDelay) / n) * 1000,
          )
        : null;
    }),
    rtpJitterMs: stats.jitter == null ? null : stats.jitter * 1000,
    offeredCodecs: [
      ...new Set(
        (results.offer ?? "")
          .split("\r\n")
          .filter((l) => l.startsWith("a=rtpmap:"))
          .map((l) => l.split(" ")[1]),
      ),
    ],
    errors: results.errors,
  };
  console.log(JSON.stringify(record, null, 2));
  if (outPath) writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
} finally {
  await browser?.close();
  recorder.kill();
  relay?.close();
  gateway.kill("SIGTERM");
  await delay(500);
}
