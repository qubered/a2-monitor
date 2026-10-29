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
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
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

export type SimulatedChannel = {
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
  /** SSCv2 subscriptions (default on). Off answers 404, as an older server might. */
  subscriptions?: boolean;
  /** Concurrent subscription sessions before new ones are refused (default 4). */
  maxSessions?: number;
  /** Resource paths the server refuses to subscribe (403, whole request refused). */
  refuseResources?: string[];
  /** Overrides the Content-Location header (hostile-server tests). */
  contentLocation?: (uuid: string) => string;
  /** Overrides the open event's data (hostile-server tests). */
  openEventData?: (uuid: string) => string;
  /** Writes every event in tiny fragments to exercise reassembly. */
  fragmentEvents?: boolean;
  /** Sends one notification per resource instead of combining them. */
  separateNotifications?: boolean;
  /** Holds back the initial values after a subscription list is accepted. */
  initialNotificationDelayMs?: number;
  /** Delays answers to session-status GETs (liveness checks). */
  sessionStatusDelayMs?: number;
  /** Ends each session right after accepting its list, before any value. */
  closeAfterSubscribe?: boolean;
  /** HTTP status used to refuse a resource (default 403; the spec's form is 400). */
  refusalStatus?: number;
};

export type SimulatorBarrier =
  "session-status" | "open-event" | "subscribe-reply";

export type EwdxSimulatorRequest = {
  method: string;
  path: string;
  authorized: boolean | null;
  /** The product code of the chassis that received this request. */
  product: string;
  /** Which TLS connection carried it, numbered from 1 in accept order. */
  connection: number;
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
  /** Changes channel values; subscribed clients are notified of what changed. */
  setChannel(index: number, patch: Partial<SimulatedChannel>): void;
  /** Open subscription sessions. */
  readonly sessions: number;
  /** The most sessions ever open at once. */
  readonly peakSessions: number;
  /**
   * Deterministic barriers for interleaving tests: while held, the receiver
   * accepts the request but withholds its answer (session-status GET reply,
   * a new stream's `open` event, or a subscription-list reply, which is
   * applied at once) until released.
   */
  hold(barrier: SimulatorBarrier): void;
  release(barrier: SimulatorBarrier): void;
  /** How many answers a barrier is withholding right now. */
  held(barrier: SimulatorBarrier): number;
  /** Notifications written, counting each resource once. */
  readonly notificationsSent: number;
  /** Ends every session as the receiver does on a password change. */
  terminateSessions(): void;
  /** Writes raw SSE text to every open session (malformed-stream tests). */
  injectEvent(raw: string): void;
  /** Forgets every session without closing its stream (status GETs then answer 422). */
  forgetSessions(): void;
  dropConnections(): void;
  close(): Promise<void>;
};

const UNAUTHENTICATED = new Set(["/api/ssc/version", "/api/device/identity"]);
const SESSION_PATH =
  /^\/api\/ssc\/state\/subscriptions\/([A-Za-z0-9-]+)(?:\/(add|remove))?$/;
const CHANNEL_RESOURCES = [
  "",
  "/warnings",
  "/signalStrengthIndicator",
  "/signalQualityIndicator",
  "/level",
];
function channelPaths(index: number): string[] {
  return [
    ...CHANNEL_RESOURCES.map((suffix) => `/api/channel/${index}${suffix}`),
    `/api/rf/channels/${index}`,
    `/api/transmitters/${index}`,
    `/api/transmitters/${index}/battery`,
    `/api/transmitters/${index}/warnings`,
  ];
}

type Session = {
  uuid: string;
  response: ServerResponse;
  resources: Set<string>;
  lastSent: Map<string, string>;
};
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

  /** The GET answer for a channel, RF or transmitter resource, or null. */
  function resourceBody(
    url: string,
  ): { status: number; body?: unknown } | null {
    const reply = (status: number, body?: unknown) => ({ status, body });
    const match =
      /^\/api\/(channel|rf\/channels|transmitters)\/(\d+)(?:\/([A-Za-z]+))?$/.exec(
        url,
      );
    const index = match ? Number(match[2]) : -1;
    const channel = channels[index];
    if (!match || !channel) return reply(404);
    if (fault === "server-error") return reply(500);
    if (fault === "wrong-shape") return reply(200, "unexpected");
    const [, family, , resource] = match;
    if (family === "channel") {
      if (resource === undefined)
        return reply(200, {
          name: channel.name,
          mute: false,
          gain: 21,
          outputLevel: 0,
        });
      if (resource === "warnings")
        return reply(200, [
          ...(channel.linked ? [] : ["NoLink"]),
          ...(channel.linked && channel.rssiDbm < -85 ? ["LowSignal"] : []),
        ]);
      if (resource === "signalStrengthIndicator")
        return reply(200, { value: channel.linked ? channel.rssiDbm : -104 });
      if (resource === "signalQualityIndicator")
        return reply(200, { value: channel.linked ? channel.rsqiPercent : 0 });
      if (resource === "level")
        return reply(200, {
          value: channel.linked ? channel.levelDbfs : -138.5,
        });
      return reply(404);
    }
    if (family === "rf/channels" && resource === undefined)
      return reply(200, {
        frequency: channel.frequencyKhz,
        presets: { type: "None" },
      });
    if (family === "transmitters") {
      if (!channel.linked) return reply(422);
      if (resource === undefined)
        return reply(200, {
          type: channel.transmitterType,
          name: channel.name,
          mute: channel.muted,
          version: "0.0.0",
        });
      if (resource === "battery")
        return reply(200, {
          type: "Battery",
          lifetime: channel.lifetimeMinutes,
          gauge: channel.batteryPercent,
        });
      if (resource === "warnings")
        return reply(200, channel.batteryPercent <= 10 ? ["LowBattery"] : []);
    }
    return reply(404);
  }

  const sessions = new Map<string, Session>();
  let peakSessions = 0;
  const barriers = new Map<SimulatorBarrier, Array<() => void> | null>();
  /** Runs now, or later if the barrier is held. */
  const through = (barrier: SimulatorBarrier, action: () => void) => {
    const queue = barriers.get(barrier);
    if (queue) queue.push(action);
    else action();
  };
  const connectionIds = new WeakMap<object, number>();
  let connectionCount = 0;
  let notificationsSent = 0;
  const writeEvent = (target: ServerResponse, text: string) => {
    // A client that stops reading is dropped rather than buffered forever.
    if (target.writableLength > 1024 * 1024) {
      target.destroy();
      return;
    }
    if (!options.fragmentEvents) {
      target.write(text);
      return;
    }
    for (let i = 0; i < text.length;) {
      const size = 1 + Math.floor(Math.random() * 7);
      target.write(text.slice(i, i + size));
      i += size;
    }
  };
  /** Sends each session the current value of every given resource that changed for it. */
  const notify = (session: Session, paths: Iterable<string>, force = false) => {
    const changed: Record<string, unknown> = {};
    for (const path of paths) {
      if (!session.resources.has(path)) continue;
      const resource = resourceBody(path);
      if (!resource || resource.status !== 200) continue;
      const json = JSON.stringify(resource.body);
      if (!force && session.lastSent.get(path) === json) continue;
      session.lastSent.set(path, json);
      changed[path] = resource.body;
    }
    const keys = Object.keys(changed);
    if (!keys.length) return;
    notificationsSent += keys.length;
    if (options.separateNotifications) {
      for (const key of keys)
        writeEvent(
          session.response,
          `data: ${JSON.stringify({ [key]: changed[key] })}\n\n`,
        );
    } else {
      writeEvent(session.response, `data: ${JSON.stringify(changed)}\n\n`);
    }
  };
  const notifyAll = (paths: string[]) => {
    for (const session of sessions.values()) notify(session, paths);
  };
  const allPaths = () => channels.flatMap((_, index) => channelPaths(index));
  const closeSession = (session: Session, sendClose: boolean) => {
    sessions.delete(session.uuid);
    if (sendClose) {
      const data = JSON.stringify({
        path: `/api/ssc/state/subscriptions/${session.uuid}`,
        sessionUUID: session.uuid,
      });
      session.response.write(`event: close\ndata: ${data}\n\n`);
    }
    session.response.end();
  };
  const ticker =
    options.scripted &&
    setInterval(() => {
      script(channels, now());
      notifyAll(allPaths());
    }, 100);
  if (ticker) ticker.unref();

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
          connection: connectionIds.get(request.socket) ?? 0,
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
      const sessionMatch = SESSION_PATH.exec(url);
      const subscriptionsOn = options.subscriptions !== false;
      if (request.method !== "GET" && !(sessionMatch && subscriptionsOn))
        return send(405);
      if (needsAuth && authorized !== true) return send(401);
      if (url === "/api/ssc/state/subscriptions" && request.method === "GET") {
        if (!subscriptionsOn) return send(404);
        if (sessions.size >= (options.maxSessions ?? 4)) return send(503);
        const uuid = randomUUID();
        const path = `/api/ssc/state/subscriptions/${uuid}`;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "content-location": options.contentLocation?.(uuid) ?? path,
        });
        const session: Session = {
          uuid,
          response,
          resources: new Set(),
          lastSent: new Map(),
        };
        sessions.set(uuid, session);
        peakSessions = Math.max(peakSessions, sessions.size);
        response.on("close", () => sessions.delete(uuid));
        through("open-event", () =>
          writeEvent(
            response,
            `event: open\ndata: ${options.openEventData?.(uuid) ?? JSON.stringify({ path, sessionUUID: uuid })}\n\n`,
          ),
        );
        return;
      }
      if (sessionMatch && subscriptionsOn) {
        const session = sessions.get(sessionMatch[1]!);
        if (!session) return send(422);
        const operation = sessionMatch[2];
        if (request.method === "GET" && !operation) {
          const list = [...session.resources];
          const delayMs = options.sessionStatusDelayMs ?? 0;
          if (delayMs > 0) {
            setTimeout(() => send(200, list), delayMs).unref();
            return;
          }
          // A held answer reflects the session as it is when released.
          through("session-status", () =>
            sessions.has(session.uuid)
              ? send(200, [...session.resources])
              : send(422),
          );
          return;
        }
        if (request.method === "DELETE" && !operation) {
          send(200);
          closeSession(session, true);
          return;
        }
        if (request.method !== "PUT") return send(405);
        const chunks: Buffer[] = [];
        let size = 0;
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) {
            send(400);
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        request.on("end", () => {
          let list: unknown;
          try {
            list = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return send(400);
          }
          if (
            !Array.isArray(list) ||
            list.some((item) => typeof item !== "string")
          )
            return send(400);
          const paths = list as string[];
          if (operation === "remove") {
            if (paths.some((path) => !session.resources.has(path)))
              return send(404);
            for (const path of paths) session.resources.delete(path);
            return send(200);
          }
          for (const path of paths) {
            if (options.refuseResources?.includes(path))
              return send(options.refusalStatus ?? 403, {
                path,
                error: 403,
              });
            // 422 (no transmitter linked) is an existing resource; only an
            // unknown path is refused, and refusal is all or nothing.
            const known = resourceBody(path);
            if (!known || known.status === 404)
              return send(404, { path, error: "not found" });
          }
          const added = paths.filter((path) => !session.resources.has(path));
          if (!operation) session.resources = new Set(paths);
          else for (const path of paths) session.resources.add(path);
          through("subscribe-reply", () => send(200));
          if (options.closeAfterSubscribe) {
            closeSession(session, true);
            return;
          }
          const delayMs = options.initialNotificationDelayMs ?? 0;
          if (delayMs > 0)
            setTimeout(() => notify(session, added, true), delayMs).unref();
          else notify(session, added, true);
        });
        return;
      }
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

      const resource = resourceBody(url);
      if (!resource) return send(404);
      return send(resource.status, resource.body);
    },
  );
  server.on("secureConnection", (socket) => {
    connectionIds.set(socket, ++connectionCount);
  });
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
      notifyAll(channelPaths(index));
    },
    setChannel(index, patch) {
      const channel = channels[index];
      if (channel) Object.assign(channel, patch);
      notifyAll(channelPaths(index));
    },
    get sessions() {
      return sessions.size;
    },
    get peakSessions() {
      return peakSessions;
    },
    hold(barrier) {
      if (!barriers.get(barrier)) barriers.set(barrier, []);
    },
    release(barrier) {
      const queue = barriers.get(barrier);
      barriers.set(barrier, null);
      for (const action of queue ?? []) action();
    },
    held(barrier) {
      return barriers.get(barrier)?.length ?? 0;
    },
    get notificationsSent() {
      return notificationsSent;
    },
    forgetSessions() {
      sessions.clear();
    },
    injectEvent(raw) {
      for (const session of sessions.values()) session.response.write(raw);
    },
    terminateSessions() {
      for (const session of [...sessions.values()]) closeSession(session, true);
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
      if (ticker) clearInterval(ticker);
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
