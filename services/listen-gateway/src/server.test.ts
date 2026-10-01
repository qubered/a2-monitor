import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseHostOutput,
  parseRecordingState,
  parseMeterFrame,
  parseNodeLevels,
} from "@rvlt/pulse-protocol/http";
import {
  MediaWorkerManager,
  SIMULATED_DEVICE_NAME,
  type WorkerProcess,
} from "./media-worker.js";
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

async function startGateway(
  device = "Test Device",
  output?: { outputDevice: string; outputChannels: number[] },
  recordingDirectory?: string,
) {
  const worker = new ScriptedWorker();
  const media = new MediaWorkerManager({
    device,
    processFactory: () => worker,
    recordingDirectory,
    ...output,
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
    deviceName: device,
    sampleRateHz: 48_000,
    channelCount: 2,
  });
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const { port } = gateway.server.address() as AddressInfo;
  return { worker, gateway, base: `http://127.0.0.1:${port}` };
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
      sources: [{ channel: 1, gain: 1 }],
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
      sources: [{ channel: 0, gain: 1 }],
    });

    // Several inputs mix node-side into this one stream, each at its trim.
    const mixed = await fetch(
      `${base}/audio/v0/listen/sessions/${sessionId}/sources`,
      {
        method: "PUT",
        headers: json,
        body: JSON.stringify({
          sources: [
            { channel: 0, trimDb: 0 },
            { channel: 1, trimDb: -6 },
          ],
        }),
      },
    );
    expect(mixed.status).toBe(204);
    expect(worker.commands.at(-1)).toEqual({
      type: "select",
      sessionId,
      sources: [
        { channel: 0, gain: 1 },
        { channel: 1, gain: expect.closeTo(10 ** (-6 / 20), 5) },
      ],
    });

    for (const sources of [
      [],
      [
        { channel: 0, trimDb: 0 },
        { channel: 0, trimDb: 0 },
      ],
      [{ channel: 2, trimDb: 0 }],
      [{ channel: 0, trimDb: 30 }],
      [{ channel: 0 }],
      [{ channel: 0, trimDb: 0, gain: 1 }],
    ]) {
      const bad = await fetch(
        `${base}/audio/v0/listen/sessions/${sessionId}/sources`,
        { method: "PUT", headers: json, body: JSON.stringify({ sources }) },
      );
      expect(bad.status).toBe(400);
    }

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

    const both = await fetch(`${base}/audio/v0/listen/sessions`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        channel: 0,
        sources: [{ channel: 0, trimDb: 0 }],
        offer: "v=0",
      }),
    });
    expect(both.status).toBe(400);
    expect(worker.commands).toEqual([]);
  });

  it("opens a session on a mix of inputs", async () => {
    const { worker, base } = await startGateway();
    const created = await fetch(`${base}/audio/v0/listen/sessions`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        sources: [
          { channel: 1, trimDb: 6 },
          { channel: 0, trimDb: 0 },
        ],
        offer: "v=0 offer",
      }),
    });
    expect(created.status).toBe(201);
    expect(worker.commands[0]).toMatchObject({
      type: "open",
      sources: [
        { channel: 1, gain: expect.closeTo(10 ** (6 / 20), 5) },
        { channel: 0, gain: 1 },
      ],
    });
  });
});

describe("ListenGateway metering", () => {
  it("reports capture state and no levels before a device is configured", async () => {
    const gateway = new ListenGateway({});
    gateways.add(gateway);
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    const { port } = gateway.server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/audio/v0/levels`);
    expect(parseNodeLevels(await response.json())).toMatchObject({
      capture: { status: "configuration-required", device: null },
      windowMs: 1_000,
      inputs: [],
    });
  });

  it("reports audio the node lost as counts in its level summary", async () => {
    const { worker, base } = await startGateway(SIMULATED_DEVICE_NAME);
    worker.emit({
      type: "stats",
      sessions: 1,
      droppedCaptureBlocks: 2,
      droppedCaptureCallbacks: 5,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const levels = parseNodeLevels(
      await (await fetch(`${base}/audio/v0/levels`)).json(),
    );
    expect(levels.capture.dropouts).toEqual({ callbacks: 5, blocks: 2 });
  });

  it("streams worker meter readings as SSE and summarises them for the backend", async () => {
    const { worker, base } = await startGateway(SIMULATED_DEVICE_NAME);
    await new Promise((resolve) => setImmediate(resolve));

    const before = parseNodeLevels(
      await (await fetch(`${base}/audio/v0/levels`)).json(),
    );
    // Ready but nothing measured yet: unknown, never silent.
    expect(before.inputs.map((input) => input.peakDbfs)).toEqual([null, null]);

    const stream = await fetch(`${base}/audio/v0/meters`);
    expect(stream.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = stream.body!.getReader();
    worker.emit({
      type: "meters",
      sequence: 0,
      intervalMs: 50,
      peakDbfs: [-18, -120],
      rmsDbfs: [-21, -120],
      clippedSamples: [0, 0],
    });

    let text = "";
    while (!text.includes("\n\n")) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    const [eventLine, dataLine] = text.split("\n");
    expect(eventLine).toBe("event: meters");
    expect(
      parseMeterFrame(JSON.parse(dataLine!.slice("data: ".length))),
    ).toEqual({
      schemaVersion: "0",
      sequence: 0,
      intervalMs: 50,
      peakDbfs: [-18, -120],
      rmsDbfs: [-21, -120],
      clipped: [false, false],
    });

    const levels = parseNodeLevels(
      await (await fetch(`${base}/audio/v0/levels`)).json(),
    );
    expect(levels.capture).toEqual({
      status: "ready",
      detail: "Capture is ready.",
      device: {
        name: SIMULATED_DEVICE_NAME,
        sampleRateHz: 48_000,
        channelCount: 2,
        simulated: true,
      },
      dropouts: { callbacks: 0, blocks: 0 },
    });
    expect(levels.inputs).toEqual([
      { index: 0, peakDbfs: -18, rmsDbfs: -21, clippedSamples: 0 },
      { index: 1, peakDbfs: -120, rmsDbfs: -120, clippedSamples: 0 },
    ]);
  });
});

describe("ListenGateway shutdown", () => {
  it("closes while a browser holds a proxied live-state stream open", async () => {
    // A backend that opens an event stream and never ends it.
    const backend = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(": open\n\n");
    });
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const backendPort = (backend.address() as AddressInfo).port;

    const gateway = new ListenGateway({
      backendOrigin: `http://127.0.0.1:${backendPort}`,
    });
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    const { port } = gateway.server.address() as AddressInfo;

    const stream = await fetch(`http://127.0.0.1:${port}/api/v1/live/events`);
    const reader = stream.body!.getReader();
    await reader.read();

    await gateway.close();
    await expect(reader.read()).rejects.toThrow();
    backend.closeAllConnections();
    backend.close();
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

describe("ListenGateway shared host output", () => {
  const output = { outputDevice: "DVS", outputChannels: [3] };

  async function patch(base: string, body: unknown, feed = "default") {
    return fetch(`${base}/audio/v0/output/feeds/${feed}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify(body),
    });
  }

  async function readOutput(base: string) {
    return parseHostOutput(
      await (await fetch(`${base}/audio/v0/output`)).json(),
    );
  }

  it("reports no output when no output device is configured and refuses changes", async () => {
    const { base } = await startGateway();
    const state = await readOutput(base);
    expect(state.output).toBeNull();
    expect(state.feeds).toEqual([]);
    const refused = await patch(base, { muted: true });
    expect(refused.status).toBe(409);
  });

  it("applies one client's change for everyone in the feed and drives its mix", async () => {
    const { worker, base } = await startGateway("Test Device", output);
    worker.emit({
      type: "output-ready",
      deviceName: "DVS",
      channelCount: 64,
      outputRoutes: [[3]],
    });
    await vi.waitFor(async () => {
      const state = await readOutput(base);
      expect(state.output).toMatchObject({ status: "ready", channelCount: 64 });
    });

    const events = await fetch(`${base}/audio/v0/output/events`);
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const nextDocument = async () => {
      while (!text.includes("\n\n")) {
        const { value } = await reader.read();
        text += decoder.decode(value);
      }
      const [message, ...rest] = text.split("\n\n");
      text = rest.join("\n\n");
      const data = message!
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice(6);
      return parseHostOutput(JSON.parse(data));
    };
    const first = await nextDocument();
    expect(first.feeds).toMatchObject([
      { id: "default", name: "Host output", outputChannels: [3] },
    ]);
    expect(first.feeds[0]!.monitor.input).toBeNull();

    const selected = await patch(base, {
      channelId: "ch-lead",
      input: 1,
      changedBy: "Sam (A2)",
    });
    expect(selected.status).toBe(200);
    const pushed = (await nextDocument()).feeds[0]!;
    expect(pushed.monitor).toMatchObject({
      channelId: "ch-lead",
      input: 1,
      muted: false,
      gainDb: 0,
      changedBy: "Sam (A2)",
    });
    expect(pushed.revision).toBe(1);
    expect(worker.commands.at(-1)).toEqual({
      type: "monitor",
      mix: 0,
      channel: 1,
      gain: 1,
    });

    await patch(base, { dimmed: true, gainDb: -6 });
    expect((await nextDocument()).feeds[0]!.monitor).toMatchObject({
      input: 1,
      dimmed: true,
      gainDb: -6,
      changedBy: null,
    });
    expect(worker.commands.at(-1)).toMatchObject({ mix: 0, channel: 1 });
    expect(worker.commands.at(-1)?.gain).toBeCloseTo(10 ** (-18 / 20), 6);

    await patch(base, { muted: true });
    expect(worker.commands.at(-1)).toEqual({
      type: "monitor",
      mix: 0,
      channel: 1,
      gain: 0,
    });
    await reader.cancel();
  });

  it("keeps feeds independent, each on its own mix and outputs", async () => {
    const { worker, base, gateway } = await startGateway("Test Device", output);
    gateway.hostFeeds.configure(
      [
        { id: "feed-a", name: "Comms A", outputChannels: [1] },
        { id: "feed-b", name: "Comms B", outputChannels: [2] },
      ],
      [3],
    );
    expect(worker.commands).toContainEqual({
      type: "output-routes",
      routes: [[1], [2]],
    });

    await patch(base, { channelId: "ch-a", input: 0 }, "feed-a");
    await patch(base, { channelId: "ch-b", input: 1, muted: true }, "feed-b");
    expect(worker.commands.slice(-2)).toEqual([
      { type: "monitor", mix: 0, channel: 0, gain: 1 },
      { type: "monitor", mix: 1, channel: 1, gain: 0 },
    ]);
    const state = await readOutput(base);
    expect(
      state.feeds.map(({ id, monitor }) => [id, monitor.input, monitor.muted]),
    ).toEqual([
      ["feed-a", 0, false],
      ["feed-b", 1, true],
    ]);
    expect((await patch(base, { muted: true }, "feed-missing")).status).toBe(
      404,
    );
  });

  it("rejects out-of-range inputs, unpaired selections and unsafe gain", async () => {
    const { base } = await startGateway("Test Device", output);
    for (const body of [
      { channelId: "ch", input: 2 },
      { input: 0 },
      { channelId: "ch" },
      { gainDb: 25 },
      { muted: "yes" },
      { changedBy: "Sam" },
      { volume: 1 },
      {},
    ]) {
      expect((await patch(base, body)).status, JSON.stringify(body)).toBe(400);
    }
    const cleared = await patch(base, { channelId: null, input: null });
    expect(cleared.status).toBe(200);
  });

  it("re-sends the routes and every shared mix after the worker restarts", async () => {
    const { worker, base } = await startGateway("Test Device", output);
    await patch(base, { channelId: "ch", input: 0 });
    worker.commands.length = 0;
    worker.emit({
      type: "ready",
      deviceName: "Test Device",
      sampleRateHz: 48_000,
      channelCount: 2,
    });
    await vi.waitFor(() =>
      expect(worker.commands).toEqual([
        { type: "output-routes", routes: [[3]] },
        { type: "monitor", mix: 0, channel: 0, gain: 1 },
      ]),
    );
  });

  it("opens the host output on the production's saved feeds at start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schemaVersion: "0",
          revision: 1,
          updatedAtUtc: null,
          show: { name: "Show" },
          hostOutput: {
            feeds: [
              { id: "feed-a", name: "Comms A", outputChannels: [12] },
              { id: "feed-b", name: "Comms B", outputChannels: [13, 14] },
            ],
          },
          device: null,
          shureReceivers: [],
          channels: [],
        }),
      ),
    );
    const worker = new ScriptedWorker();
    const factory = vi.fn(() => worker);
    const gateway = new ListenGateway({
      device: "Test Device",
      outputDevice: "DVS",
      outputChannels: [1],
      processFactory: factory,
      backendOrigin: "http://backend.invalid/",
    });
    gateways.add(gateway);
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    gateway.startCapture();
    expect(factory).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    const args = factory.mock.calls[0]![1] as string[];
    expect(args[args.indexOf("--output-routes") + 1]).toBe("12;13,14");
    vi.unstubAllGlobals();
  });
  it("applies a channel's showfile trim under the operators' level on a host feed", async () => {
    const realFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schemaVersion: "0",
          revision: 1,
          updatedAtUtc: null,
          show: { name: "Show" },
          hostOutput: {
            feeds: [{ id: "feed-a", name: "Comms A", outputChannels: [3] }],
          },
          device: null,
          shureReceivers: [],
          channels: [
            { id: "ch", inputIndex: 0, name: "Lead", trimDb: 6 },
            { id: "ch2", inputIndex: 1, name: "Talkback" },
          ],
        }),
      ),
    );
    const worker = new ScriptedWorker();
    const factory = vi.fn(() => worker);
    const gateway = new ListenGateway({
      device: "Test Device",
      outputDevice: "DVS",
      outputChannels: [1],
      processFactory: factory,
      backendOrigin: "http://backend.invalid/",
    });
    gateways.add(gateway);
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    gateway.startCapture();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    worker.emit({
      type: "ready",
      deviceName: "Test Device",
      sampleRateHz: 48_000,
      channelCount: 2,
    });
    const port = (gateway.server.address() as AddressInfo).port;
    const send = (body: unknown) =>
      realFetch(`http://127.0.0.1:${port}/audio/v0/output/feeds/feed-a`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify(body),
      });

    // -6 dB level under a +6 dB trim is unity; an untrimmed input is not.
    expect((await send({ channelId: "ch", input: 0, gainDb: -6 })).status).toBe(
      200,
    );
    await vi.waitFor(() =>
      expect(worker.commands.at(-1)).toMatchObject({
        type: "monitor",
        channel: 0,
        gain: expect.closeTo(1, 5),
      }),
    );
    expect((await send({ channelId: "ch2", input: 1 })).status).toBe(200);
    await vi.waitFor(() =>
      expect(worker.commands.at(-1)).toMatchObject({
        type: "monitor",
        channel: 1,
        gain: expect.closeTo(10 ** (-6 / 20), 5),
      }),
    );
    vi.unstubAllGlobals();
  });
});

describe("ListenGateway recording", () => {
  const put = (base: string, body: unknown) =>
    fetch(`${base}/audio/v0/recording`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify(body),
    });

  it("is unavailable without a recording directory", async () => {
    const { base } = await startGateway();
    const state = parseRecordingState(
      await (await fetch(`${base}/audio/v0/recording`)).json(),
    );
    expect(state.available).toBe(false);
    expect(
      (await put(base, { enabled: true, retentionMinutes: 10 })).status,
    ).toBe(409);
  });

  it("forwards a valid change to the node and rejects invalid ones", async () => {
    const { base, worker } = await startGateway(
      "Test Device",
      undefined,
      "/rec",
    );
    const accepted = await put(base, { enabled: true, retentionMinutes: 45 });
    expect(accepted.status).toBe(200);
    expect(parseRecordingState(await accepted.json())).toMatchObject({
      available: true,
      enabled: true,
      retentionMinutes: 45,
    });
    expect(worker.commands.at(-1)).toEqual({
      type: "recording",
      enabled: true,
      retentionMinutes: 45,
    });
    for (const body of [
      { enabled: true, retentionMinutes: 61 },
      { enabled: true, retentionMinutes: 0 },
      { enabled: "yes", retentionMinutes: 10 },
      { enabled: true },
    ]) {
      expect((await put(base, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("ListenGateway replay", () => {
  async function open(base: string, worker: ScriptedWorker) {
    const created = await fetch(`${base}/audio/v0/listen/sessions`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ channel: 0, offer: "v=0 offer" }),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };
    worker.commands.length = 0;
    return sessionId;
  }
  const replay = (base: string, sessionId: string, body: unknown) =>
    fetch(`${base}/audio/v0/listen/sessions/${sessionId}/replay`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify(body),
    });

  it("starts replay at a recorded time and reports when nothing was recorded", async () => {
    const { base, worker } = await startGateway(
      "Test Device",
      undefined,
      "/rec",
    );
    const sessionId = await open(base, worker);
    const at = "2026-10-01T10:00:00.000Z";

    const accepted = replay(base, sessionId, {
      channel: 1,
      atUtc: at,
      gain: 1,
    });
    await vi.waitFor(() =>
      expect(worker.commands.at(-1)).toEqual({
        type: "replay",
        sessionId,
        channel: 1,
        gain: 1,
        atUtcMs: Date.parse(at),
      }),
    );
    worker.emit({ type: "replay-started", sessionId });
    expect((await accepted).status).toBe(204);

    const refused = replay(base, sessionId, { channel: 1, atUtc: at, gain: 1 });
    await vi.waitFor(() => expect(worker.commands.length).toBe(2));
    worker.emit({ type: "replay-rejected", sessionId, detail: "nothing" });
    expect((await refused).status).toBe(409);
  });

  it("validates the request and needs recording", async () => {
    const { base, worker } = await startGateway(
      "Test Device",
      undefined,
      "/rec",
    );
    const sessionId = await open(base, worker);
    for (const body of [
      { channel: 1, atUtc: "not a date", gain: 1 },
      { channel: 1, atUtc: "2026-10-01T10:00:00Z", gain: 99 },
      { channel: 1, atUtc: "2026-10-01T10:00:00Z" },
    ]) {
      expect((await replay(base, sessionId, body)).status).toBe(400);
    }
    expect(
      (
        await replay(base, "00000000-0000-0000-0000-000000000000", {
          channel: 1,
          atUtc: "2026-10-01T10:00:00Z",
          gain: 1,
        })
      ).status,
    ).toBe(404);

    const plain = await startGateway();
    const plainSession = await open(plain.base, plain.worker);
    expect(
      (
        await replay(plain.base, plainSession, {
          channel: 1,
          atUtc: "2026-10-01T10:00:00Z",
          gain: 1,
        })
      ).status,
    ).toBe(409);
  });
});
