import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const resources = resolve(dirname(fileURLToPath(import.meta.url)));
const appRoot = resolve(resources, "app");
const captureBinary = resolve(resources, "bin/pulse-device-capture");
const logPath = resolve(
  process.env.HOME ?? "/tmp",
  "Library/Logs/Pulse/mvp.log",
);

function runAppleScript(script, args = []) {
  return execFileSync("/usr/bin/osascript", ["-e", script, ...args], {
    encoding: "utf8",
  }).trim();
}

function showError(message) {
  try {
    runAppleScript(
      'on run argv\ndisplay alert "Pulse could not start" message (item 1 of argv) as critical\nend run',
      [message],
    );
  } catch {
    // The user may dismiss the alert.
  }
}

// Reserved name the listen gateway maps to its built-in simulated source.
const SIMULATED_DEVICE = "Pulse test signal";

function listDevices() {
  const raw = execFileSync(captureBinary, ["--list"], { encoding: "utf8" });
  const payload = JSON.parse(raw);
  return payload.devices
    .filter((device) =>
      device.configs.some(
        (config) =>
          config.minSampleRateHz <= 48_000 && config.maxSampleRateHz >= 48_000,
      ),
    )
    .map((device) => device.deviceName)
    .concat(SIMULATED_DEVICE);
}

function chooseDevice(devices) {
  const configured = process.env.A2_AUDIO_DEVICE;
  if (configured) {
    if (!devices.includes(configured)) {
      throw new Error(`The configured device was not found: ${configured}`);
    }
    return configured;
  }
  if (devices.length === 0)
    throw new Error("No 48 kHz input devices were found.");
  return runAppleScript(
    'on run argv\nset picked to choose from list argv with title "Pulse" with prompt "Choose the 48 kHz audio input device to share." without multiple selections allowed and empty selection allowed\nif picked is false then return ""\nreturn item 1 of picked\nend run',
    devices,
  );
}

function chooseHost() {
  const configured = process.env.A2_BIND_HOST;
  if (configured) {
    if (configured !== "127.0.0.1" && configured !== "0.0.0.0") {
      throw new Error("A2_BIND_HOST must be 127.0.0.1 or 0.0.0.0.");
    }
    return configured;
  }
  const choice = runAppleScript(
    'set picked to choose from list {"This Mac only", "Local network"} with title "Pulse" with prompt "Who can open the listening page? Local network has no authentication in this MVP." default items {"This Mac only"} without multiple selections allowed and empty selection allowed\nif picked is false then return ""\nreturn item 1 of picked',
  );
  return choice === "Local network" ? "0.0.0.0" : choice ? "127.0.0.1" : "";
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}

function waitForStop(message) {
  return new Promise((resolvePromise) => {
    activeDialog = execFile(
      "/usr/bin/osascript",
      [
        "-e",
        'on run argv\ndisplay dialog (item 1 of argv) with title "Pulse" buttons {"Stop Server"} default button "Stop Server" with icon caution\nend run',
        message,
      ],
      () => {
        activeDialog = undefined;
        resolvePromise();
      },
    );
    activeDialog.on("error", resolvePromise);
  });
}

let activeDialog;
let resolveShellStop;

async function waitUntilReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4173/audio/v0/device");
      const state = await response.json();
      if (state.status === "ready") return;
      if (state.status === "error") throw new Error(state.detail);
    } catch (error) {
      if (error instanceof Error && !error.message.includes("fetch failed"))
        throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("The audio server did not become ready within 20 seconds.");
}

async function stopChildren(children) {
  const running = children.filter(
    (child) => child.exitCode === null && child.signalCode === null,
  );
  for (const child of running) child.kill("SIGTERM");
  await Promise.race([
    Promise.all(
      running.map(
        (child) =>
          new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      ),
    ),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ]);
  for (const child of running) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
}

async function main() {
  const devices = listDevices();
  const device = chooseDevice(devices);
  if (!device) return;
  const host = chooseHost();
  if (!host) return;

  mkdirSync(dirname(logPath), { recursive: true });
  const log = openSync(logPath, "a", 0o600);
  const common = { cwd: appRoot, stdio: ["ignore", log, log] };
  const backend = spawn(process.execPath, ["services/backend/dist/start.js"], {
    ...common,
    env: {
      ...process.env,
      A2_DATA_DIR: resolve(
        process.env.HOME ?? "/tmp",
        "Library/Application Support/Pulse",
      ),
      // The backend reads normalized levels and receiver telemetry from the
      // gateway on loopback, whichever network scope the gateway serves.
      A2_NODE_ORIGIN: "http://127.0.0.1:4173",
    },
  });
  const gateway = spawn(
    process.execPath,
    ["services/listen-gateway/dist/start.js"],
    {
      ...common,
      env: {
        ...process.env,
        A2_AUDIO_DEVICE: device,
        A2_CAPTURE_BIN: captureBinary,
        A2_LISTEN_HOST: host,
        A2_LISTEN_PORT: "4173",
        A2_LIVE_DIR: resolve(appRoot, "apps/live/dist"),
        A2_MANAGER_DIR: resolve(appRoot, "apps/manager/dist"),
        A2_BACKEND_ORIGIN: "http://127.0.0.1:3000",
      },
    },
  );
  const children = [backend, gateway];
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopChildren(children);
  };
  const stopFromSignal = () => {
    activeDialog?.kill();
    resolveShellStop?.();
    void stop();
  };
  process.once("SIGINT", stopFromSignal);
  process.once("SIGTERM", stopFromSignal);

  try {
    await waitUntilReady();
    execFile("/usr/bin/open", ["http://127.0.0.1:4173"]);
    const addresses = host === "0.0.0.0" ? lanAddresses() : [];
    const access = addresses.length
      ? addresses.map((address) => `http://${address}:4173`).join("\n")
      : "http://127.0.0.1:4173";
    const warning =
      host === "0.0.0.0"
        ? "\n\nThis MVP has no authentication. Use a trusted local network only."
        : "";
    if (process.env.A2_APP_SHELL === "app") {
      await new Promise((resolvePromise) => {
        resolveShellStop = resolvePromise;
      });
    } else {
      await waitForStop(
        `Listening from “${device}”.\n\nOpen on another device:\n${access}${warning}`,
      );
    }
  } finally {
    await stop();
  }
}

try {
  await main();
} catch (error) {
  showError(
    error instanceof Error
      ? `${error.message}\n\nLog: ${logPath}`
      : "Unknown error",
  );
  process.exitCode = 1;
}
