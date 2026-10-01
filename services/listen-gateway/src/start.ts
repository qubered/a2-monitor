import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseOutputChannels } from "./media-worker.js";
import { ListenGateway } from "./server.js";

const host = process.env.A2_LISTEN_HOST ?? "127.0.0.1";
const rawPort = process.env.A2_LISTEN_PORT ?? "3001";
const port = Number(rawPort);
const defaultCaptureBinary = fileURLToPath(
  new URL("../../../target/debug/pulse-device-capture", import.meta.url),
);
const defaultWorkerBinary = fileURLToPath(
  new URL("../../../target/debug/pulse-media-worker", import.meta.url),
);
const defaultOutputBinary = fileURLToPath(
  new URL("../../../target/debug/pulse-device-output", import.meta.url),
);
// Host monitor output (ADR 0031) is off unless an exact output device is named.
const outputDevice = process.env.A2_OUTPUT_DEVICE || undefined;
const outputChannels = outputDevice
  ? parseOutputChannels(process.env.A2_OUTPUT_CHANNELS ?? "1")
  : undefined;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("A2_LISTEN_PORT must be an integer from 1 to 65535.");
}

const gateway = new ListenGateway({
  device: process.env.A2_AUDIO_DEVICE,
  workerBinary: process.env.A2_MEDIA_WORKER_BIN ?? defaultWorkerBinary,
  captureBinary: process.env.A2_CAPTURE_BIN ?? defaultCaptureBinary,
  outputDevice,
  outputChannels,
  outputBinary: process.env.A2_OUTPUT_BIN ?? defaultOutputBinary,
  // Recorded audio stays on this machine. Recording is unavailable unless set.
  recordingDirectory: process.env.A2_RECORDING_DIR || undefined,
  webRoot: process.env.A2_LIVE_DIR,
  managerRoot: process.env.A2_MANAGER_DIR,
  backendOrigin: process.env.A2_BACKEND_ORIGIN,
});

gateway.startCapture();
gateway.server.listen(port, host, () => {
  process.stdout.write(
    `a2-listen-gateway listening on http://${host}:${port}\n`,
  );
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await gateway.close();
  } catch (error) {
    process.stderr.write(
      `a2-listen-gateway shutdown failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
