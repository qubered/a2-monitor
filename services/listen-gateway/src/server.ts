import { Buffer } from "node:buffer";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  CaptureManager,
  type CaptureAudioChunk,
  type CaptureManagerOptions,
} from "./capture.js";
import type { NodeLevels } from "@rvlt/pulse-protocol/http";
import { handleWebRequest, type WebHostOptions } from "./web-host.js";
import { LEVEL_WINDOW_MS, LevelMeter } from "./levels.js";
import { ShureFleetMonitor } from "./shure.js";

const MAX_CLIENTS = 32;
const MAX_METER_CLIENTS = 64;
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_METER_BUFFERED_BYTES = 64 * 1024;
const MAX_DETAIL_LENGTH = 240;

type Listener = {
  socket: WebSocket;
  channel: number;
};

export type ListenGatewayOptions = CaptureManagerOptions &
  WebHostOptions & {
    captureManager?: CaptureManager;
    shureMonitor?: ShureFleetMonitor;
  };

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = `${reason}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
}

function parseChannel(url: URL): number | undefined {
  if (url.searchParams.size !== 1) return undefined;
  const raw = url.searchParams.get("channel");
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return undefined;
  const channel = Number(raw);
  return Number.isSafeInteger(channel) ? channel : undefined;
}

function sendJson(response: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function boundedDetail(detail: string): string {
  const trimmed = detail.trim() || "Capture state is unknown.";
  return trimmed.length > MAX_DETAIL_LENGTH
    ? `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : trimmed;
}

function extractMono(chunk: CaptureAudioChunk, channel: number): Buffer {
  const sampleBytes = Float32Array.BYTES_PER_ELEMENT;
  const frameBytes = chunk.channelCount * sampleBytes;
  const mono = Buffer.allocUnsafe(chunk.frameCount * sampleBytes);
  for (let frame = 0; frame < chunk.frameCount; frame += 1) {
    const sourceOffset = frame * frameBytes + channel * sampleBytes;
    chunk.interleaved.copy(
      mono,
      frame * sampleBytes,
      sourceOffset,
      sourceOffset + sampleBytes,
    );
  }
  return mono;
}

export class ListenGateway {
  readonly capture: CaptureManager;
  readonly shure: ShureFleetMonitor;
  readonly server: Server;
  private readonly webSockets: WebSocketServer;
  private readonly listeners = new Set<Listener>();
  private readonly meterSockets = new Set<WebSocket>();
  private meter: LevelMeter | undefined;

  constructor(options: ListenGatewayOptions = {}) {
    this.capture =
      options.captureManager ??
      new CaptureManager({
        device: options.device,
        captureBinary: options.captureBinary,
        processFactory: options.processFactory,
        simulatedChannels: options.simulatedChannels,
      });
    this.shure =
      options.shureMonitor ??
      new ShureFleetMonitor({ backendOrigin: options.backendOrigin });
    this.webSockets = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: 1024,
    });
    this.server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/audio/v0/device") {
        sendJson(response, this.capture.getState());
        return;
      }
      if (request.method === "GET" && request.url === "/audio/v0/levels") {
        sendJson(response, this.getLevels());
        return;
      }
      if (request.method === "GET" && request.url === "/audio/v0/shure") {
        sendJson(response, this.shure.getState());
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

    this.server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "", "http://listen-gateway.local");
      if (request.method === "GET" && url.pathname === "/audio/v0/meters") {
        if (this.meterSockets.size >= MAX_METER_CLIENTS) {
          rejectUpgrade(socket, 503, "Meter Capacity Reached");
          return;
        }
        this.webSockets.handleUpgrade(request, socket, head, (webSocket) => {
          this.meterSockets.add(webSocket);
          webSocket.on("message", () => {
            webSocket.close(1008, "meter stream is receive-only");
          });
          webSocket.on("close", () => this.meterSockets.delete(webSocket));
          webSocket.on("error", () => this.meterSockets.delete(webSocket));
        });
        return;
      }
      if (request.method !== "GET" || url.pathname !== "/audio/v0/listen") {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }

      const state = this.capture.getState();
      if (state.status !== "ready") {
        rejectUpgrade(socket, 503, "Audio Not Ready");
        return;
      }
      const channel = parseChannel(url);
      if (channel === undefined || channel >= state.device.channelCount) {
        rejectUpgrade(socket, 400, "Invalid Channel");
        return;
      }
      if (this.listeners.size >= MAX_CLIENTS) {
        rejectUpgrade(socket, 503, "Listener Capacity Reached");
        return;
      }

      this.webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        const listener = { socket: webSocket, channel };
        this.listeners.add(listener);
        webSocket.binaryType = "arraybuffer";
        webSocket.on("message", () => {
          webSocket.close(1008, "listen stream is receive-only");
        });
        webSocket.on("close", () => this.listeners.delete(listener));
        webSocket.on("error", () => this.listeners.delete(listener));
      });
    });

    this.capture.on("audio", (chunk: CaptureAudioChunk) => {
      this.meter?.process(chunk);
      const monoByChannel = new Map<number, Buffer>();
      for (const listener of this.listeners) {
        if (
          listener.socket.readyState !== WebSocket.OPEN ||
          listener.socket.bufferedAmount > MAX_BUFFERED_BYTES
        ) {
          continue;
        }
        let mono = monoByChannel.get(listener.channel);
        if (!mono) {
          mono = extractMono(chunk, listener.channel);
          monoByChannel.set(listener.channel, mono);
        }
        listener.socket.send(mono, { binary: true });
      }
    });

    this.capture.on("state", () => {
      const state = this.capture.getState();
      if (state.status === "ready") {
        this.meter = new LevelMeter({
          sampleRateHz: state.device.sampleRateHz,
          channelCount: state.device.channelCount,
        });
        this.meter.on("frame", (frame) => this.broadcastMeters(frame));
        return;
      }
      this.meter?.removeAllListeners();
      this.meter = undefined;
      for (const listener of this.listeners) {
        listener.socket.close(1011, "audio capture unavailable");
      }
    });
  }

  /** The capture state plus the trailing per-input level summary the backend evaluates alerts from. */
  getLevels(): NodeLevels {
    const state = this.capture.getState();
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
                simulated: this.capture.simulated,
              }
            : null,
      },
      windowMs: LEVEL_WINDOW_MS,
      inputs:
        state.status === "ready" && this.meter
          ? this.meter.summary(LEVEL_WINDOW_MS)
          : [],
    };
  }

  private broadcastMeters(frame: unknown): void {
    if (this.meterSockets.size === 0) return;
    const message = JSON.stringify(frame);
    for (const socket of this.meterSockets) {
      if (
        socket.readyState !== WebSocket.OPEN ||
        socket.bufferedAmount > MAX_METER_BUFFERED_BYTES
      ) {
        continue;
      }
      socket.send(message);
    }
  }

  startCapture(): void {
    this.capture.start();
    this.shure.start();
  }

  async close(): Promise<void> {
    this.capture.stop();
    this.shure.close();
    for (const listener of this.listeners) listener.socket.terminate();
    this.listeners.clear();
    for (const socket of this.meterSockets) socket.terminate();
    this.meterSockets.clear();
    await new Promise<void>((resolve, reject) => {
      this.webSockets.close(() => {
        this.server.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
}
