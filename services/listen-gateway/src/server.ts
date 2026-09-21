import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  CaptureManager,
  type CaptureAudioChunk,
  type CaptureManagerOptions,
} from "./capture.js";

const MAX_CLIENTS = 32;
const MAX_BUFFERED_BYTES = 256 * 1024;

type Listener = {
  socket: WebSocket;
  channel: number;
};

export type ListenGatewayOptions = CaptureManagerOptions & {
  captureManager?: CaptureManager;
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
  readonly server: Server;
  private readonly webSockets: WebSocketServer;
  private readonly listeners = new Set<Listener>();

  constructor(options: ListenGatewayOptions = {}) {
    this.capture =
      options.captureManager ??
      new CaptureManager({
        device: options.device,
        captureBinary: options.captureBinary,
        processFactory: options.processFactory,
      });
    this.webSockets = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: 1024,
    });
    this.server = createServer((request, response) => {
      if (request.method !== "GET" || request.url !== "/audio/v0/device") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "not-found" }));
        return;
      }

      const body = JSON.stringify(this.capture.getState());
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      response.end(body);
    });

    this.server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "", "http://listen-gateway.local");
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
      if (this.capture.getState().status === "ready") return;
      for (const listener of this.listeners) {
        listener.socket.close(1011, "audio capture unavailable");
      }
    });
  }

  startCapture(): void {
    this.capture.start();
  }

  async close(): Promise<void> {
    this.capture.stop();
    for (const listener of this.listeners) listener.socket.terminate();
    this.listeners.clear();
    await new Promise<void>((resolve, reject) => {
      this.webSockets.close(() => {
        this.server.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
}
