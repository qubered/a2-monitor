import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:https";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Development-only Sennheiser EW-DX EM 2 Dante double for exercising the
 * SSCv2 adapter without receiver hardware. It serves a small, original subset
 * of the read-only resources in the EW-DX 3rd-party OpenAPI release 1.7 over
 * HTTPS with Basic auth (user `api`). It is not the vendor schema and nothing
 * here is evidence about a physical receiver.
 *
 * Scripted behaviour, repeating:
 * - channel 1 (handheld) is healthy and drains slowly;
 * - channel 2 (bodypack) dips in RF and loses its transmitter for 15 s of
 *   every 60 s when `scripted` is on.
 */

export type SimulatorCertificate = {
  key: string;
  cert: string;
  /** Lower-case hex SHA-256 of the DER certificate, as Manager stores it. */
  fingerprint256: string;
};

/** Generates a throwaway self-signed certificate; nothing is written to the repository. */
export function generateSimulatorCertificate(): SimulatorCertificate {
  const directory = mkdtempSync(path.join(tmpdir(), "pulse-ewdx-sim-"));
  try {
    const keyPath = path.join(directory, "key.pem");
    const certPath = path.join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=pulse-ewdx-simulator",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    const key = readFileSync(keyPath, "utf8");
    const cert = readFileSync(certPath, "utf8");
    const fingerprint256 = new X509Certificate(cert).fingerprint256
      .replaceAll(":", "")
      .toLowerCase();
    return { key, cert, fingerprint256 };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

type SimulatedChannel = {
  name: string;
  transmitterType: string;
  linked: boolean;
  rssiDbm: number;
  rsqiPercent: number;
  levelDbfs: number;
  batteryPercent: number;
  lifetimeMinutes: number;
  muted: boolean;
  frequencyKhz: number;
};

export type EwdxSimulatorOptions = {
  host?: string;
  port?: number;
  password?: string;
  certificate?: SimulatorCertificate;
  product?: string;
  firmware?: string;
  serial?: string;
  /** Drive the repeating development script instead of steady values. */
  scripted?: boolean;
  now?: () => number;
};

export type EwdxSimulatorRequest = {
  method: string;
  path: string;
  authorized: boolean | null;
  /** The product code of the chassis that received this request. */
  product: string;
};

export type EwdxSimulator = {
  port: number;
  fingerprint256: string;
  requests: EwdxSimulatorRequest[];
  setLinked(channel: number, linked: boolean): void;
  setHung(hung: boolean): void;
  setSerial(serial: string): void;
  /** Makes every channel, RF and transmitter resource answer badly. */
  setFault(fault: "server-error" | "wrong-shape" | null): void;
  /** Calls back on every request as it arrives, before it is answered. */
  onRequest(callback: () => void): void;
  /**
   * Replaces the chassis at this address: new serial and a different
   * transmitter on channel 1. "idle" swaps now and drops every connection;
   * a number swaps after answering that many more requests, closing that
   * response's connection, so the swap lands in the middle of a poll.
   */
  swapChassis(swap: {
    afterRequests: number | "idle";
    serial: string;
    transmitterType: string;
    product?: string;
  }): void;
  /** Index into `requests` of the first request the replacement chassis saw. */
  readonly swappedAtRequest: number | null;
  dropConnections(): void;
  close(): Promise<void>;
};

const UNAUTHENTICATED = new Set(["/api/ssc/version", "/api/device/identity"]);
const MAX_RECORDED_REQUESTS = 10_000;

function initialChannels(): SimulatedChannel[] {
  return [
    {
      name: "VOX 1",
      transmitterType: "EW_DX_SKM",
      linked: true,
      rssiDbm: -58,
      rsqiPercent: 98,
      levelDbfs: -28,
      batteryPercent: 92,
      lifetimeMinutes: 420,
      muted: false,
      frequencyKhz: 550_125,
    },
    {
      name: "VOX 2",
      transmitterType: "EW_DX_SK",
      linked: true,
      rssiDbm: -66,
      rsqiPercent: 90,
      levelDbfs: -35,
      batteryPercent: 64,
      lifetimeMinutes: 260,
      muted: false,
      frequencyKhz: 552_350,
    },
  ];
}

function script(channels: SimulatedChannel[], nowMs: number): void {
  const seconds = nowMs / 1000;
  const wave = (period: number) => Math.sin((2 * Math.PI * seconds) / period);
  const [one, two] = channels;
  if (one) {
    one.rssiDbm = Math.round(-58 + 4 * wave(17));
    one.rsqiPercent = Math.round(96 + 3 * wave(11));
    one.levelDbfs = Math.round(-28 + 8 * wave(3));
    one.batteryPercent = Math.max(5, 92 - (Math.floor(seconds / 120) % 80));
    one.lifetimeMinutes = Math.round(one.batteryPercent * 4.5);
  }
  if (two) {
    const phase = seconds % 60;
    two.linked = phase < 45;
    two.rssiDbm = Math.round(-70 + 18 * wave(23));
    two.rsqiPercent = Math.max(0, Math.round(70 + 28 * wave(19)));
    two.levelDbfs = Math.round(-40 + 10 * wave(5));
    two.muted = phase >= 38 && phase < 42;
  }
}

/** Starts the synthetic receiver. Binds 127.0.0.1 unless told otherwise. */
export async function startEwdxSimulator(
  options: EwdxSimulatorOptions = {},
): Promise<EwdxSimulator> {
  const certificate = options.certificate ?? generateSimulatorCertificate();
  const password = options.password ?? "pulse-simulator";
  const expectedAuth = `Basic ${Buffer.from(`api:${password}`).toString("base64")}`;
  const channels = initialChannels();
  const requests: EwdxSimulatorRequest[] = [];
  const sockets = new Set<Socket>();
  const now = options.now ?? Date.now;
  let hung = false;
  let fault: "server-error" | "wrong-shape" | null = null;
  const requestCallbacks: Array<() => void> = [];
  let pendingSwap: {
    remaining: number;
    serial: string;
    transmitterType: string;
    product?: string;
  } | null = null;
  let swappedAtRequest: number | null = null;
  const applySwap = (swap: {
    serial: string;
    transmitterType: string;
    product?: string;
  }) => {
    serial = swap.serial;
    if (swap.product) product = swap.product;
    if (channels[0]) channels[0].transmitterType = swap.transmitterType;
    swappedAtRequest = requests.length;
  };
  let serial = options.serial ?? "1000000001";
  let product = options.product ?? "EWDX2CHDS";

  const server: Server = createServer(
    { key: certificate.key, cert: certificate.cert },
    (request, response) => {
      const url = request.url ?? "/";
      const authorization = request.headers.authorization;
      const needsAuth = !UNAUTHENTICATED.has(url);
      const authorized =
        authorization === undefined ? null : authorization === expectedAuth;
      if (requests.length < MAX_RECORDED_REQUESTS)
        requests.push({
          method: request.method ?? "",
          path: url,
          authorized,
          product,
        });
      for (const callback of requestCallbacks) callback();
      if (pendingSwap) {
        if (pendingSwap.remaining <= 0) {
          const swap = pendingSwap;
          pendingSwap = null;
          response.setHeader("connection", "close");
          response.on("finish", () => applySwap(swap));
        } else {
          pendingSwap.remaining -= 1;
        }
      }
      if (hung) return;
      const send = (status: number, body?: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(body === undefined ? undefined : JSON.stringify(body));
      };
      if (request.method !== "GET") return send(405);
      if (needsAuth && authorized !== true) return send(401);
      if (options.scripted) script(channels, now());

      if (url === "/api/ssc/version")
        return send(200, { protocol: "2.3", schema: "1.7" });
      if (url === "/api/device/identity")
        return send(200, {
          product,
          hardwareRevision: "0000000-00",
          serial,
          vendor: "Sennheiser electronic SE & Co. KG",
        });
      if (url === "/api/firmware/update/state")
        return send(200, {
          deviceVersion: options.firmware ?? "4.1.2",
          danteVersion: "0.0.0",
          state: "Idle",
          progress: 0,
          lastStatus: "None",
        });
      if (url === "/api/device/site")
        return send(200, { deviceName: "EWDXEM2", location: "", position: "" });
      if (url === "/api/device/state")
        return send(200, { state: "Normal", warnings: [] });

      const match =
        /^\/api\/(channel|rf\/channels|transmitters)\/(\d+)(?:\/([A-Za-z]+))?$/.exec(
          url,
        );
      const index = match ? Number(match[2]) : -1;
      const channel = channels[index];
      if (!match || !channel) return send(404);
      if (fault === "server-error") return send(500);
      if (fault === "wrong-shape") return send(200, "unexpected");
      const [, family, , resource] = match;
      if (family === "channel") {
        if (resource === undefined)
          return send(200, {
            name: channel.name,
            mute: false,
            gain: 21,
            outputLevel: 0,
          });
        if (resource === "warnings")
          return send(200, [
            ...(channel.linked ? [] : ["NoLink"]),
            ...(channel.linked && channel.rssiDbm < -85 ? ["LowSignal"] : []),
          ]);
        if (resource === "signalStrengthIndicator")
          return send(200, { value: channel.linked ? channel.rssiDbm : -104 });
        if (resource === "signalQualityIndicator")
          return send(200, { value: channel.linked ? channel.rsqiPercent : 0 });
        if (resource === "level")
          return send(200, {
            value: channel.linked ? channel.levelDbfs : -138.5,
          });
        return send(404);
      }
      if (family === "rf/channels" && resource === undefined)
        return send(200, {
          frequency: channel.frequencyKhz,
          presets: { type: "None" },
        });
      if (family === "transmitters") {
        if (!channel.linked) return send(422);
        if (resource === undefined)
          return send(200, {
            type: channel.transmitterType,
            name: channel.name,
            mute: channel.muted,
            version: "0.0.0",
          });
        if (resource === "battery")
          return send(200, {
            type: "Battery",
            lifetime: channel.lifetimeMinutes,
            gauge: channel.batteryPercent,
          });
        if (resource === "warnings")
          return send(200, channel.batteryPercent <= 10 ? ["LowBattery"] : []);
      }
      return send(404);
    },
  );
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    fingerprint256: certificate.fingerprint256,
    requests,
    setLinked(index, linked) {
      const channel = channels[index];
      if (channel) channel.linked = linked;
    },
    setHung(value) {
      hung = value;
    },
    setSerial(value) {
      serial = value;
    },
    setFault(value) {
      fault = value;
    },
    onRequest(callback) {
      requestCallbacks.push(callback);
    },
    swapChassis({ afterRequests, ...swap }) {
      if (afterRequests === "idle") {
        applySwap(swap);
        for (const socket of sockets) socket.destroy();
        return;
      }
      pendingSwap = { remaining: afterRequests, ...swap };
    },
    get swappedAtRequest() {
      return swappedAtRequest;
    },
    dropConnections() {
      for (const socket of sockets) socket.destroy();
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

/**
 * Keeps one simulator identity across development runs in an ignored state
 * directory: its certificate (so the seeded pin stays valid) and a
 * node-style secret file with the synthetic password, both mode 0600.
 */
export function prepareSimulatorState(
  directory: string,
  receiverId: string,
  password: string,
): SimulatorCertificate {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(directory, "simulator-key.pem");
  const certPath = path.join(directory, "simulator-cert.pem");
  let certificate: SimulatorCertificate;
  if (existsSync(keyPath) && existsSync(certPath)) {
    const cert = readFileSync(certPath, "utf8");
    certificate = {
      key: readFileSync(keyPath, "utf8"),
      cert,
      fingerprint256: new X509Certificate(cert).fingerprint256
        .replaceAll(":", "")
        .toLowerCase(),
    };
  } else {
    certificate = generateSimulatorCertificate();
    writeFileSync(keyPath, certificate.key, { mode: 0o600 });
    writeFileSync(certPath, certificate.cert, { mode: 0o600 });
  }
  writeFileSync(
    path.join(directory, "ewdx-secrets.json"),
    JSON.stringify({
      schemaVersion: "0",
      receivers: { [receiverId]: { password } },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(directory, "fingerprint.txt"),
    `${certificate.fingerprint256}\n`,
  );
  return certificate;
}

if (isEntryPoint) {
  const host = process.env.EWDX_SIM_HOST ?? "127.0.0.1";
  const port = Number(process.env.EWDX_SIM_PORT ?? "8443");
  const password = process.env.EWDX_SIM_PASSWORD ?? "pulse-simulator";
  const stateDirectory = process.env.EWDX_SIM_STATE_DIR;
  const certificate = stateDirectory
    ? prepareSimulatorState(
        stateDirectory,
        process.env.EWDX_SIM_RECEIVER_ID ?? "sim-ewdx",
        password,
      )
    : undefined;
  if (process.argv.includes("--prepare")) process.exit(0);
  const simulator = await startEwdxSimulator({
    host,
    port,
    password,
    certificate,
    scripted: true,
  });
  process.stdout.write(
    `Simulated Sennheiser EW-DX EM 2 Dante (2 channels) on https://${host}:${simulator.port}. Certificate SHA-256 ${simulator.fingerprint256}. Development only.\n`,
  );
  const stop = () => void simulator.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
