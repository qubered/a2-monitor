import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type {
  HostOutput,
  MeterFrame,
  NodeLevels,
  Showfile,
} from "@rvlt/pulse-protocol/http";
import {
  hostOutputDocument,
  type HostMonitor,
  MonitorChangeError,
  monitorCommand,
  parseMonitorChange,
  HostOutputFeeds,
} from "./host-output.js";
import { LEVEL_WINDOW_MS, LevelBank, type MeterReading } from "./levels.js";
import {
  MediaWorkerManager,
  MAX_RECORDING_MINUTES,
  SessionRejectedError,
  type ListenSource,
  type MediaWorkerOptions,
} from "./media-worker.js";
import { handleWebRequest, type WebHostOptions } from "./web-host.js";
import { ShureFleetMonitor } from "./shure.js";

const MAX_SIGNALING_BODY_BYTES = 64 * 1024;
const MAX_METER_CLIENTS = 64;
const MAX_OUTPUT_CLIENTS = 64;
/** How long capture waits for the production's host output channels at start. */
const SHOWFILE_WAIT_MS = 2_000;
const MAX_METER_BUFFERED_BYTES = 64 * 1024;
const METER_KEEPALIVE_MS = 15_000;
const MAX_DETAIL_LENGTH = 240;
const FEED_OUTPUT_PATH = /^\/audio\/v0\/output\/feeds\/([^/]{1,192})$/;
const SESSION_PATH = /^\/audio\/v0\/listen\/sessions\/([0-9a-f-]{36})$/;
const SESSION_CHANNEL_PATH =
  /^\/audio\/v0\/listen\/sessions\/([0-9a-f-]{36})\/channel$/;
const SESSION_SOURCES_PATH =
  /^\/audio\/v0\/listen\/sessions\/([0-9a-f-]{36})\/sources$/;
/** The most inputs one listener can hear at once (the worker's limit). */
const MAX_LISTEN_SOURCES = 16;
/** Channel trim bounds, as in the showfile. */
const MAX_TRIM_DB = 24;

export type ListenGatewayOptions = MediaWorkerOptions &
  WebHostOptions & {
    mediaWorker?: MediaWorkerManager;

    shureMonitor?: ShureFleetMonitor;
    interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

/**
 * Reads a small JSON object. Requiring `application/json` makes any cross-origin
 * page go through a CORS preflight this server never approves. With `keys`, the
 * object must have exactly those fields.
 */
async function readJsonObject(
  request: IncomingMessage,
  keys?: readonly string[],
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, "json-required");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    if (length > MAX_SIGNALING_BODY_BYTES) {
      throw new HttpError(413, "body-too-large");
    }
    chunks.push(bytes);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid-json");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "invalid-body");
  }
  const record = value as Record<string, unknown>;
  if (keys === undefined) return record;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new HttpError(400, "invalid-body");
  }
  return record;
}

function boundedDetail(detail: string): string {
  const trimmed = detail.trim() || "Capture state is unknown.";
  return trimmed.length > MAX_DETAIL_LENGTH
    ? `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : trimmed;
}

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.");
}

/**
 * Chooses the address advertised as the node's ICE candidate. The address the browser
 * already reached this server on is routable from it, so it is preferred. A loopback
 * page load still advertises a LAN address when one exists: Firefox ignores loopback
 * candidates and browsers pair from their own LAN interfaces. Only the ICE credentials
 * and DTLS fingerprint returned over this HTTP exchange can use the media port.
 */
export function candidateAddressFor(
  localAddress: string | undefined,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string {
  const address = (localAddress ?? "").replace(/^::ffff:/i, "");
  const linkLocal = /^fe80:/i.test(address);
  if (address && !isLoopback(address) && !linkLocal) return address;
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

/**
 * A listener's mix: `[{channel, trimDb}]`, distinct inputs, each trim within
 * the showfile's ±24 dB, sent to the worker as linear gains.
 */
function sourcesFrom(value: unknown, channelCount: number): ListenSource[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_LISTEN_SOURCES
  ) {
    throw new HttpError(400, "invalid-sources");
  }
  const seen = new Set<number>();
  return value.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Object.keys(entry).sort().join(",") !== "channel,trimDb"
    ) {
      throw new HttpError(400, "invalid-sources");
    }
    const { channel: rawChannel, trimDb } = entry as Record<string, unknown>;
    const channel = channelFrom(rawChannel, channelCount);
    if (
      seen.has(channel) ||
      typeof trimDb !== "number" ||
      !Number.isFinite(trimDb) ||
      Math.abs(trimDb) > MAX_TRIM_DB
    ) {
      throw new HttpError(400, "invalid-sources");
    }
    seen.add(channel);
    return { channel, gain: Number((10 ** (trimDb / 20)).toFixed(6)) };
  });
}

function channelFrom(value: unknown, channelCount: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= channelCount
  ) {
    throw new HttpError(400, "invalid-channel");
  }
  return value;
}

export class ListenGateway {
  readonly media: MediaWorkerManager;
  readonly shure: ShureFleetMonitor;
  readonly server: Server;
  private readonly interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  private readonly meterClients = new Set<ServerResponse>();
  private readonly outputClients = new Set<ServerResponse>();
  readonly hostFeeds: HostOutputFeeds;
  private readonly waitForShowfile: boolean;
  private startMediaOnce: () => void = () => undefined;
  private readonly keepalive: NodeJS.Timeout;
  private levels: LevelBank | undefined;
  /** Monitor trim in dB by patched input index, from the active showfile (ADR 0033). */
  private inputTrimDb = new Map<number, number>();

  private sendMonitor(mix: number, monitor: HostMonitor): void {
    const trimDb =
      monitor.input === null ? 0 : (this.inputTrimDb.get(monitor.input) ?? 0);
    this.media.setMonitor(mix, monitorCommand(monitor, trimDb));
  }

  /** Follows the showfile's per-channel trims and re-renders every feed when one changes. */
  private setInputTrims(showfile: Showfile): void {
    const next = new Map<number, number>();
    for (const { inputIndex, trimDb } of showfile.channels) {
      if (inputIndex !== null && trimDb && !next.has(inputIndex)) {
        next.set(inputIndex, trimDb);
      }
    }
    const same =
      next.size === this.inputTrimDb.size &&
      [...next].every(([input, db]) => this.inputTrimDb.get(input) === db);
    if (same) return;
    this.inputTrimDb = next;
    this.hostFeeds
      .list()
      .forEach(({ monitor }, mix) => this.sendMonitor(mix, monitor.get()));
  }

  constructor(options: ListenGatewayOptions = {}) {
    this.media =
      options.mediaWorker ??
      new MediaWorkerManager({
        device: options.device,
        workerBinary: options.workerBinary,
        captureBinary: options.captureBinary,
        outputDevice: options.outputDevice,
        outputChannels: options.outputChannels,
        outputBinary: options.outputBinary,
        recordingDirectory: options.recordingDirectory,
        processFactory: options.processFactory,
      });
    this.hostFeeds = new HostOutputFeeds(this.media.getDefaultOutputChannels());
    this.waitForShowfile =
      options.shureMonitor === undefined &&
      options.backendOrigin !== undefined &&
      this.media.getOutputState() !== null;
    this.media.on("state", () => {
      this.resetLevels();
      const state = this.media.getState();
      if (state.status === "ready") {
        this.hostFeeds.constrain(state.device.channelCount);
      }
    });
    this.media.on("output", () => this.broadcastOutput());
    this.hostFeeds.on("monitor", (mix: number) => {
      const feed = this.hostFeeds.list()[mix];
      if (feed) this.sendMonitor(mix, feed.monitor.get());
      this.broadcastOutput();
    });
    this.hostFeeds.on("feeds", () => {
      // Routes first, so the worker has one mix per feed before the mixes.
      this.media.setOutputRoutes(this.hostFeeds.routes());
      this.hostFeeds
        .list()
        .forEach(({ monitor }, mix) => this.sendMonitor(mix, monitor.get()));
      this.broadcastOutput();
    });
    this.media.on("meters", (reading: MeterReading) =>
      this.levels?.ingest(reading),
    );
    this.keepalive = setInterval(() => {
      for (const client of this.meterClients) client.write(": keepalive\n\n");
      for (const client of this.outputClients) client.write(": keepalive\n\n");
    }, METER_KEEPALIVE_MS);
    this.keepalive.unref();
    this.shure =
      options.shureMonitor ??
      new ShureFleetMonitor({
        backendOrigin: options.backendOrigin,
        // The active production's host output feeds (ADR 0031).
        onShowfile: (showfile) => {
          this.setInputTrims(showfile);
          this.hostFeeds.configure(
            showfile.hostOutput?.feeds,
            this.media.getDefaultOutputChannels(),
          );
          this.startMediaOnce();
        },
      });
    this.interfaces = options.interfaces ?? networkInterfaces;
    this.server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/audio/v0/device") {
        sendJson(response, 200, this.media.getState());
        return;
      }
      if (request.method === "GET" && request.url === "/audio/v0/levels") {
        sendJson(response, 200, this.getLevels());
        return;
      }
      if (request.method === "GET" && request.url === "/audio/v0/meters") {
        this.openMeterStream(response);
        return;
      }
      if (
        request.url === "/audio/v0/output" ||
        request.url?.startsWith("/audio/v0/output/feeds/")
      ) {
        this.handleOutput(request, response).catch((error: unknown) => {
          if (response.headersSent) return;
          if (error instanceof HttpError) {
            sendJson(response, error.status, { error: error.code });
          } else {
            sendJson(response, 500, { error: "internal-error" });
          }
        });
        return;
      }
      if (
        request.method === "GET" &&
        request.url === "/audio/v0/output/events"
      ) {
        this.openOutputStream(response);
        return;
      }
      if (request.url === "/audio/v0/recording") {
        this.handleRecording(request, response).catch((error: unknown) => {
          if (response.headersSent) return;
          if (error instanceof HttpError) {
            sendJson(response, error.status, { error: error.code });
          } else {
            sendJson(response, 500, { error: "internal-error" });
          }
        });
        return;
      }
      if (request.method === "GET" && request.url === "/audio/v0/shure") {
        sendJson(response, 200, this.shure.getState());
        return;
      }
      if (request.url?.startsWith("/audio/v0/listen/")) {
        this.handleListen(request, response).catch((error: unknown) => {
          if (response.headersSent) return;
          if (error instanceof HttpError) {
            sendJson(response, error.status, { error: error.code });
          } else {
            sendJson(response, 500, { error: "internal-error" });
          }
        });
        return;
      }

      void handleWebRequest(request, response, options)
        .then((handled) => {
          if (handled) return;
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "not-found" }));
        })
        .catch(() => {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "internal-error" }));
        });
    });
  }

  /**
   * WHEP-style signaling: one POST exchanges SDP without trickle ICE (the node is
   * ICE-lite), PUT changes the monitored input without renegotiation, DELETE ends it.
   */
  private async handleListen(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const path = request.url ?? "";
    if (path === "/audio/v0/listen/sessions" && request.method === "POST") {
      // One input (`channel`), or a mix (`sources`), never both.
      const body = await readJsonObject(request);
      const keys = Object.keys(body).sort().join(",");
      if (keys !== "channel,offer" && keys !== "offer,sources") {
        throw new HttpError(400, "invalid-body");
      }
      const state = this.media.getState();
      if (state.status !== "ready") throw new HttpError(503, "audio-not-ready");
      const sources =
        "sources" in body
          ? sourcesFrom(body.sources, state.device.channelCount)
          : [
              {
                channel: channelFrom(body.channel, state.device.channelCount),
                gain: 1,
              },
            ];
      if (typeof body.offer !== "string" || body.offer.length === 0) {
        throw new HttpError(400, "invalid-offer");
      }
      const sessionId = randomUUID();
      try {
        const answer = await this.media.openSession({
          sessionId,
          sources,
          offer: body.offer,
          candidateAddress: candidateAddressFor(
            request.socket.localAddress,
            this.interfaces(),
          ),
        });
        sendJson(response, 201, { sessionId, answer });
      } catch (error) {
        if (error instanceof SessionRejectedError) {
          throw new HttpError(
            error.capacity ? 503 : 400,
            error.capacity ? "listener-capacity-reached" : "offer-rejected",
          );
        }
        throw new HttpError(503, "media-worker-unavailable");
      }
      return;
    }

    const channelMatch = SESSION_CHANNEL_PATH.exec(path);
    if (channelMatch?.[1] && request.method === "PUT") {
      const body = await readJsonObject(request, ["channel"]);
      const state = this.media.getState();
      if (state.status !== "ready") throw new HttpError(503, "audio-not-ready");
      const channel = channelFrom(body.channel, state.device.channelCount);
      if (!this.media.selectSources(channelMatch[1], [{ channel, gain: 1 }])) {
        throw new HttpError(404, "unknown-session");
      }
      response.writeHead(204, { "Cache-Control": "no-store" }).end();
      return;
    }

    const sourcesMatch = SESSION_SOURCES_PATH.exec(path);
    if (sourcesMatch?.[1] && request.method === "PUT") {
      const body = await readJsonObject(request, ["sources"]);
      const state = this.media.getState();
      if (state.status !== "ready") throw new HttpError(503, "audio-not-ready");
      const sources = sourcesFrom(body.sources, state.device.channelCount);
      if (!this.media.selectSources(sourcesMatch[1], sources)) {
        throw new HttpError(404, "unknown-session");
      }
      response.writeHead(204, { "Cache-Control": "no-store" }).end();
      return;
    }

    const sessionMatch = SESSION_PATH.exec(path);
    if (sessionMatch?.[1] && request.method === "DELETE") {
      if (!this.media.closeSession(sessionMatch[1])) {
        throw new HttpError(404, "unknown-session");
      }
      response.writeHead(204, { "Cache-Control": "no-store" }).end();
      return;
    }

    throw new HttpError(404, "not-found");
  }

  /** The `host-output` document: output device state plus every feed's shared mix. */
  getOutput(): HostOutput {
    return hostOutputDocument(this.media.getOutputState(), this.hostFeeds);
  }

  /**
   * Shared host monitor output (ADR 0031). `GET /audio/v0/output` reads it;
   * `PATCH /audio/v0/output/feeds/{id}` changes any subset of one feed's
   * monitor for everyone in it and returns the new document.
   */
  private async handleOutput(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const path = request.url ?? "";
    if (path === "/audio/v0/output") {
      if (request.method !== "GET") {
        throw new HttpError(405, "method-not-allowed");
      }
      sendJson(response, 200, this.getOutput());
      return;
    }
    const match = FEED_OUTPUT_PATH.exec(path);
    if (!match?.[1]) throw new HttpError(404, "not-found");
    if (request.method !== "PATCH") {
      throw new HttpError(405, "method-not-allowed");
    }
    if (this.media.getOutputState() === null) {
      throw new HttpError(409, "host-output-not-configured");
    }
    const feed = this.hostFeeds.find(decodeURIComponent(match[1]));
    if (!feed) throw new HttpError(404, "unknown-output-feed");
    const body = await readJsonObject(request);
    const state = this.media.getState();
    try {
      feed.monitor.apply(
        parseMonitorChange(
          body,
          state.status === "ready" ? state.device.channelCount : null,
        ),
      );
    } catch (error) {
      if (error instanceof MonitorChangeError) {
        throw new HttpError(
          error.code === "audio-not-ready" ? 503 : 400,
          error.code,
        );
      }
      throw error;
    }
    sendJson(response, 200, this.getOutput());
  }

  /**
   * `GET /audio/v0/recording` reads the node's recording state; `PUT` sets
   * `{enabled, retentionMinutes}` and returns the new state. The node keeps
   * the setting, so Manager changes it here and the node needs no backend.
   */
  private async handleRecording(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method === "GET") {
      sendJson(response, 200, this.media.getRecordingState());
      return;
    }
    if (request.method !== "PUT")
      throw new HttpError(405, "method-not-allowed");
    if (!this.media.getRecordingState().available) {
      throw new HttpError(409, "recording-not-available");
    }
    const { enabled, retentionMinutes } = await readJsonObject(request, [
      "enabled",
      "retentionMinutes",
    ]);
    if (
      typeof enabled !== "boolean" ||
      typeof retentionMinutes !== "number" ||
      !Number.isInteger(retentionMinutes) ||
      retentionMinutes < 1 ||
      retentionMinutes > MAX_RECORDING_MINUTES
    ) {
      throw new HttpError(400, "invalid-recording");
    }
    if (!this.media.setRecording(enabled, retentionMinutes)) {
      throw new HttpError(503, "audio-not-ready");
    }
    sendJson(response, 200, this.media.getRecordingState());
  }

  /** Server-Sent Events: the `host-output` document on connect and after every change. */
  private openOutputStream(response: ServerResponse): void {
    if (this.outputClients.size >= MAX_OUTPUT_CLIENTS) {
      sendJson(response, 503, { error: "output-capacity-reached" });
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    response.write(
      `event: output\ndata: ${JSON.stringify(this.getOutput())}\n\n`,
    );
    this.outputClients.add(response);
    response.on("close", () => this.outputClients.delete(response));
  }

  private broadcastOutput(): void {
    if (this.outputClients.size === 0) return;
    const message = `event: output\ndata: ${JSON.stringify(this.getOutput())}\n\n`;
    for (const client of this.outputClients) client.write(message);
  }

  /** The capture state plus the trailing per-input level summary the backend evaluates alerts from. */
  getLevels(): NodeLevels {
    const state = this.media.getState();
    return {
      schemaVersion: "0",
      generatedAtUtc: new Date().toISOString(),
      capture: {
        status: state.status,
        detail: boundedDetail(state.detail),
        device:
          state.status === "ready"
            ? {
                name: state.device.name.slice(0, 512),
                sampleRateHz: state.device.sampleRateHz,
                channelCount: state.device.channelCount,
                simulated: this.media.simulated,
              }
            : null,
        ...(state.status === "ready"
          ? { dropouts: this.media.getDropouts() }
          : {}),
      },
      windowMs: LEVEL_WINDOW_MS,
      inputs:
        state.status === "ready" && this.levels
          ? this.levels.summary(LEVEL_WINDOW_MS)
          : [],
    };
  }

  /**
   * Receive-only Server-Sent Events stream of 20 Hz `meter-frame` payloads for Live's
   * card traces. A slow client skips frames instead of growing a buffer.
   */
  private openMeterStream(response: ServerResponse): void {
    if (this.meterClients.size >= MAX_METER_CLIENTS) {
      sendJson(response, 503, { error: "meter-capacity-reached" });
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    this.meterClients.add(response);
    response.on("close", () => this.meterClients.delete(response));
  }

  private broadcastMeters(frame: MeterFrame): void {
    if (this.meterClients.size === 0) return;
    const message = `event: meters\ndata: ${JSON.stringify(frame)}\n\n`;
    for (const client of this.meterClients) {
      if (client.writableLength > MAX_METER_BUFFERED_BYTES) continue;
      client.write(message);
    }
  }

  private resetLevels(): void {
    this.levels?.removeAllListeners();
    this.levels = undefined;
    const state = this.media.getState();
    if (state.status !== "ready") return;
    this.levels = new LevelBank({ channelCount: state.device.channelCount });
    this.levels.on("frame", (frame) => this.broadcastMeters(frame));
  }

  /**
   * Starts receivers and capture. With a backend and a host output, capture
   * waits briefly for the active production's output channels so the output
   * opens on them rather than on the default first (ADR 0031).
   */
  startCapture(): void {
    this.shure.start();
    if (!this.waitForShowfile) {
      this.media.start();
      return;
    }
    const timer = setTimeout(() => this.startMediaOnce(), SHOWFILE_WAIT_MS);
    timer.unref?.();
    this.startMediaOnce = () => {
      clearTimeout(timer);
      this.startMediaOnce = () => undefined;
      this.media.start();
    };
  }

  async close(): Promise<void> {
    clearInterval(this.keepalive);
    this.media.stop();
    this.shure.close();
    for (const client of this.meterClients) client.end();
    this.meterClients.clear();
    for (const client of this.outputClients) client.end();
    this.outputClients.clear();
    const closed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    // Long-lived streams (the proxied live-state events, keep-alive sockets)
    // would otherwise hold shutdown open until every browser disconnects.
    this.server.closeAllConnections();
    await closed;
  }
}
