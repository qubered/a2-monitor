import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ALERT_POLICY } from "./alert-policy.js";
import { LiveMonitor } from "./live-monitor.js";
import {
  FakeNodeSource,
  levelsWith,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import { NodeObserver } from "./node-observer.js";
import { MemoryProductionStore } from "./productions.js";

void DEFAULT_ALERT_POLICY;
const servers: Server[] = [];
const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
});

async function fakeNode(options: {
  stream: boolean;
  shureDelayMs?: number;
  shureDoc?: unknown;
  fleet?: unknown;
}) {
  let streamClient: ServerResponse | null = null;
  let shureGets = 0;
  const server = createServer((request, response) => {
    if (request.url === "/audio/v0/levels") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(levelsWith([-12, -30])));
      return;
    }
    if (request.url === "/audio/v0/shure") {
      shureGets += 1;
      const body = JSON.stringify(options.shureDoc ?? telemetryWith([{}]));
      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        response.end(body);
      }, options.shureDelayMs ?? 0);
      return;
    }
    if (request.url === "/audio/v0/receivers/events" && options.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `event: fleet\ndata: ${JSON.stringify(options.fleet ?? telemetryWith([{}]))}\n\n`,
      );
      streamClient = response;
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    shureGets: () => shureGets,
    connected: () => streamClient !== null,
    push(event: string, data: unknown) {
      streamClient?.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition not reached.");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("NodeObserver receiver telemetry stream", () => {
  it("applies a pushed receiver change within 50 ms and tells listeners", async () => {
    const node = await fakeNode({ stream: true });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 60_000 });
    let notified = 0;
    observer.onTelemetry(() => (notified += 1));
    observer.start();
    stops.push(() => observer.stop());
    await waitFor(() => node.connected() && observer.current().shure !== null);
    const changed = telemetryWith([{ rfLevelDbm: -91 }]).receivers[0]!;
    const before = notified;
    const t0 = performance.now();
    node.push("receiver", changed);
    await waitFor(
      () =>
        observer.current().shure?.receivers[0]?.channels[0]?.rfLevelDbm === -91,
    );
    expect(performance.now() - t0).toBeLessThan(50);
    expect(notified).toBeGreaterThan(before);
  });

  it("ignores a receiver event that breaks the contract and keeps the last good document", async () => {
    const node = await fakeNode({ stream: true });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 60_000 });
    observer.start();
    stops.push(() => observer.stop());
    await waitFor(() => node.connected() && observer.current().shure !== null);
    node.push("receiver", { id: "rack-a", password: "x" });
    node.push("receiver", telemetryWith([{ rfLevelDbm: -70 }]).receivers[0]);
    await waitFor(
      () =>
        observer.current().shure?.receivers[0]?.channels[0]?.rfLevelDbm === -70,
    );
    expect(JSON.stringify(observer.current().shure)).not.toContain("password");
  });

  it("polls /audio/v0/shure only while no stream is available", async () => {
    const node = await fakeNode({ stream: false });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 100 });
    observer.start();
    stops.push(() => observer.stop());
    await waitFor(() => node.shureGets() >= 2);
    const streamed = await fakeNode({ stream: true });
    const streaming = new NodeObserver({
      origin: streamed.origin,
      pollMs: 100,
    });
    streaming.start();
    stops.push(() => streaming.stop());
    await waitFor(
      () => streamed.connected() && streaming.current().shure !== null,
    );
    const gets = streamed.shureGets();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(streamed.shureGets()).toBe(gets);
  });
});

describe("LiveMonitor publication", () => {
  async function monitored() {
    const nodeSource = new FakeNodeSource();
    const productionStore = new MemoryProductionStore();
    await productionStore.saveActive(showfileWith({ revision: 0 }));
    const liveMonitor = new LiveMonitor({
      productionStore,
      nodeSource,
      tickMs: 60_000,
    });
    nodeSource.observe(Date.now(), levelsWith([-12, -30]), telemetryWith([{}]));
    await liveMonitor.start();
    stops.push(() => liveMonitor.stop());
    return { nodeSource, liveMonitor };
  }

  it("publishes a telemetry change within 100 ms instead of waiting for its tick", async () => {
    const { nodeSource, liveMonitor } = await monitored();
    let published = 0;
    let level: number | null = null;
    liveMonitor.on("state", ({ state }) => {
      published += 1;
      level = state.channels[0]?.rf.levelDbm ?? null;
    });
    const t0 = performance.now();
    nodeSource.observe(
      Date.now(),
      levelsWith([-12, -30]),
      telemetryWith([{ rfLevelDbm: -88 }]),
    );
    nodeSource.telemetryChanged();
    await waitFor(() => level === -88, 1_000);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(published).toBeGreaterThan(0);
  });

  it("coalesces a burst of telemetry into a bounded number of publications", async () => {
    const { nodeSource, liveMonitor } = await monitored();
    let published = 0;
    liveMonitor.on("state", () => (published += 1));
    for (let i = 0; i < 100; i += 1) {
      nodeSource.observe(
        Date.now(),
        levelsWith([-12, -30]),
        telemetryWith([{ rfLevelDbm: -60 - (i % 20) }]),
      );
      nodeSource.telemetryChanged();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    // ~100+ ms of bursts at no more than one publication per 50 ms.
    expect(published).toBeGreaterThan(0);
    expect(published).toBeLessThanOrEqual(6);
  });
});

describe("NodeObserver stream lifecycle", () => {
  it("does not let a slow poll that started first overwrite newer streamed telemetry", async () => {
    const node = await fakeNode({
      stream: true,
      shureDelayMs: 300,
      shureDoc: telemetryWith([{ rfLevelDbm: -50 }]),
    });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 60_000 });
    observer.start();
    stops.push(() => observer.stop());
    await waitFor(() => node.connected() && observer.current().shure !== null);
    node.push("receiver", telemetryWith([{ rfLevelDbm: -91 }]).receivers[0]);
    await waitFor(
      () =>
        observer.current().shure?.receivers[0]?.channels[0]?.rfLevelDbm === -91,
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(
      observer.current().shure?.receivers[0]?.channels[0]?.rfLevelDbm,
    ).toBe(-91);
  });

  it("keeps polling when the stream's fleet document breaks the contract", async () => {
    const node = await fakeNode({
      stream: true,
      fleet: { schemaVersion: "9" },
    });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 100 });
    observer.start();
    stops.push(() => observer.stop());
    await waitFor(() => node.connected());
    const gets = node.shureGets();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(node.shureGets()).toBeGreaterThan(gets + 1);
  });

  it("falls back to polling when an open stream goes quiet", async () => {
    const node = await fakeNode({ stream: true });
    const observer = new NodeObserver({
      origin: node.origin,
      pollMs: 100,
      streamQuietMs: 300,
    });
    observer.start();
    stops.push(() => observer.stop());
    await waitFor(() => node.connected() && observer.current().shure !== null);
    const gets = node.shureGets();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(node.shureGets()).toBeGreaterThan(gets);
  });

  it("publishes nothing from a stream after stop", async () => {
    const node = await fakeNode({ stream: true });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 60_000 });
    let notified = 0;
    observer.onTelemetry(() => (notified += 1));
    observer.start();
    await waitFor(() => node.connected() && observer.current().shure !== null);
    observer.stop();
    const after = notified;
    node.push("receiver", telemetryWith([{ rfLevelDbm: -99 }]).receivers[0]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(notified).toBe(after);
    expect(
      observer.current().shure?.receivers[0]?.channels[0]?.rfLevelDbm,
    ).not.toBe(-99);
  });
});

describe("LiveMonitor evaluation queue", () => {
  it("coalesces requested passes that have not started yet", async () => {
    const nodeSource = new FakeNodeSource();
    const productionStore = new MemoryProductionStore();
    await productionStore.saveActive(showfileWith({ revision: 0 }));
    const liveMonitor = new LiveMonitor({
      productionStore,
      nodeSource,
      tickMs: 60_000,
    });
    nodeSource.observe(Date.now(), levelsWith([-12, -30]), telemetryWith([{}]));
    await liveMonitor.start();
    stops.push(() => liveMonitor.stop());
    let published = 0;
    liveMonitor.on("state", () => (published += 1));
    await Promise.all(Array.from({ length: 50 }, () => liveMonitor.tick()));
    expect(published).toBeLessThanOrEqual(2);
    expect(published).toBeGreaterThan(0);
  });
});

describe("NodeObserver run generations", () => {
  it("drops a poll that was still in flight when it was stopped", async () => {
    const node = await fakeNode({
      stream: false,
      shureDelayMs: 300,
      shureDoc: telemetryWith([{ rfLevelDbm: -44 }]),
    });
    const observer = new NodeObserver({ origin: node.origin, pollMs: 60_000 });
    observer.start();
    await waitFor(() => node.shureGets() === 1);
    observer.stop();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(observer.current().shure).toBeNull();
  });
});
