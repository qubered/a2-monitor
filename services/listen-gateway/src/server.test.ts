import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaWorkerManager, type WorkerProcess } from "./media-worker.js";
import { ListenGateway, candidateAddressFor } from "./server.js";

class ScriptedWorker implements WorkerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stop = vi.fn();
  readonly commands: Array<Record<string, unknown>> = [];

  constructor() {
    this.stdin.on("data", (data: Buffer) => {
      for (const line of data.toString("utf8").split("\n")) {
        if (!line) continue;
        const command = JSON.parse(line) as Record<string, unknown>;
        this.commands.push(command);
        if (command.type === "open") {
          this.emit({
            type: "answer",
            sessionId: command.sessionId,
            answer: `answer for ${String(command.offer)}`,
          });
        }
      }
    });
  }

  onError(): void {}

  onExit(): void {}

  emit(event: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

const gateways = new Set<ListenGateway>();

afterEach(async () => {
  await Promise.all([...gateways].map((gateway) => gateway.close()));
  gateways.clear();
});

async function startGateway() {
  const worker = new ScriptedWorker();
  const media = new MediaWorkerManager({
    device: "Test Device",
    processFactory: () => worker,
  });
  const gateway = new ListenGateway({
    mediaWorker: media,
    interfaces: () => ({
      en0: [
        {
          address: "192.168.1.20",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: false,
          cidr: "192.168.1.20/24",
        },
      ],
    }),
  });
  gateways.add(gateway);
  gateway.startCapture();
  worker.emit({
    type: "ready",
    deviceName: "Test",
    sampleRateHz: 48_000,
    channelCount: 2,
  });
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const { port } = gateway.server.address() as AddressInfo;
  return { worker, base: `http://127.0.0.1:${port}` };
}

const json = { "Content-Type": "application/json" };

describe("ListenGateway WebRTC signaling", () => {
  it("exchanges SDP, switches input without renegotiation and closes", async () => {
    const { worker, base } = await startGateway();

    const created = await fetch(`${base}/audio/v0/listen/sessions`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ channel: 1, offer: "v=0 offer" }),
    });
    expect(created.status).toBe(201);
    const { sessionId, answer } = (await created.json()) as {
      sessionId: string;
      answer: string;
    };
    expect(answer).toBe("answer for v=0 offer");
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // A loopback page load advertises the LAN address browsers can pair with.
    expect(worker.commands[0]).toMatchObject({
      type: "open",
      channel: 1,
      candidateAddress: "192.168.1.20",
    });

    const switched = await fetch(
      `${base}/audio/v0/listen/sessions/${sessionId}/channel`,
      { method: "PUT", headers: json, body: JSON.stringify({ channel: 0 }) },
    );
    expect(switched.status).toBe(204);
    expect(worker.commands.at(-1)).toEqual({
      type: "select",
      sessionId,
      channel: 0,
    });

    const outOfRange = await fetch(
      `${base}/audio/v0/listen/sessions/${sessionId}/channel`,
      { method: "PUT", headers: json, body: JSON.stringify({ channel: 2 }) },
    );
    expect(outOfRange.status).toBe(400);

    const closed = await fetch(
      `${base}/audio/v0/listen/sessions/${sessionId}`,
      {
        method: "DELETE",
      },
    );
    expect(closed.status).toBe(204);
    expect(worker.commands.at(-1)).toEqual({ type: "close", sessionId });

    const again = await fetch(`${base}/audio/v0/listen/sessions/${sessionId}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  it("requires JSON and exact fields so cross-origin forms cannot open sessions", async () => {
    const { worker, base } = await startGateway();

    const form = await fetch(`${base}/audio/v0/listen/sessions`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ channel: 0, offer: "v=0" }),
    });
    expect(form.status).toBe(415);

    const extra = await fetch(`${base}/audio/v0/listen/sessions`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ channel: 0, offer: "v=0", gain: 1 }),
    });
    expect(extra.status).toBe(400);
    expect(worker.commands).toEqual([]);
  });
});

describe("candidateAddressFor", () => {
  const interfaces = {
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  };

  it("prefers the address the browser reached", () => {
    expect(candidateAddressFor("::ffff:10.0.0.5", interfaces)).toBe("10.0.0.5");
  });

  it("falls back to loopback only without a LAN interface", () => {
    expect(candidateAddressFor("127.0.0.1", interfaces)).toBe("127.0.0.1");
  });
});
