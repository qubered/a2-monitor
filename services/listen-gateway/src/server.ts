import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import {
  MediaWorkerManager,
  SessionRejectedError,
  type MediaWorkerOptions,
} from "./media-worker.js";
import { handleWebRequest, type WebHostOptions } from "./web-host.js";
import { ShureFleetMonitor } from "./shure.js";

const MAX_SIGNALING_BODY_BYTES = 64 * 1024;
const SESSION_PATH = /^\/audio\/v0\/listen\/sessions\/([0-9a-f-]{36})$/;
const SESSION_CHANNEL_PATH =
  /^\/audio\/v0\/listen\/sessions\/([0-9a-f-]{36})\/channel$/;

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
 * page go through a CORS preflight this server never approves.
 */
async function readJsonObject(
  request: IncomingMessage,
  keys: readonly string[],
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

  constructor(options: ListenGatewayOptions = {}) {
    this.media =
      options.mediaWorker ??
      new MediaWorkerManager({
        device: options.device,
        workerBinary: options.workerBinary,
        captureBinary: options.captureBinary,
        processFactory: options.processFactory,
      });
    this.shure =
      options.shureMonitor ??
      new ShureFleetMonitor({ backendOrigin: options.backendOrigin });
    this.interfaces = options.interfaces ?? networkInterfaces;
    this.server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/audio/v0/device") {
        sendJson(response, 200, this.media.getState());
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
      const body = await readJsonObject(request, ["channel", "offer"]);
      const state = this.media.getState();
      if (state.status !== "ready") throw new HttpError(503, "audio-not-ready");
      const channel = channelFrom(body.channel, state.device.channelCount);
      if (typeof body.offer !== "string" || body.offer.length === 0) {
        throw new HttpError(400, "invalid-offer");
      }
      const sessionId = randomUUID();
      try {
        const answer = await this.media.openSession({
          sessionId,
          channel,
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
      if (!this.media.selectChannel(channelMatch[1], channel)) {
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

  startCapture(): void {
    this.media.start();
    this.shure.start();
  }

  async close(): Promise<void> {
    this.media.stop();
    this.shure.close();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
