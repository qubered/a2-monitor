import process from "node:process";
import { fileURLToPath } from "node:url";
import { ListenGateway } from "./server.js";

const host = process.env.A2_LISTEN_HOST ?? "127.0.0.1";
const rawPort = process.env.A2_LISTEN_PORT ?? "3001";
const port = Number(rawPort);
const defaultCaptureBinary = fileURLToPath(
  new URL("../../../target/debug/pulse-device-capture", import.meta.url),
);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("A2_LISTEN_PORT must be an integer from 1 to 65535.");
}

const gateway = new ListenGateway({
  device: process.env.A2_AUDIO_DEVICE,
  captureBinary: process.env.A2_CAPTURE_BIN ?? defaultCaptureBinary,
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
