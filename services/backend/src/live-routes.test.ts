import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAlertLog,
  parseLiveState,
  parseMicChecks,
  type LiveState,
} from "@rvlt/pulse-protocol/http";
import { MemoryAlertPersistence } from "./alerts.js";
import { LiveMonitor } from "./live-monitor.js";
import {
  FakeNodeSource,
  levelsWith,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import { MemoryProductionStore } from "./productions.js";
import { buildServer } from "./server.js";

const servers = new Set<ReturnType<typeof buildServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function monitoredServer(options: { batteryPercent?: number } = {}) {
  let clock = Date.parse("2026-09-23T01:00:00Z");
  const now = () => clock;
  const nodeSource = new FakeNodeSource();
  const productionStore = new MemoryProductionStore();
  const base = showfileWith({ revision: 0 });
  await productionStore.saveActive({
    ...base,
    channels: base.channels.map((channel, index) =>
      index === 0 ? { ...channel, imageUrl: PIXEL_PNG } : channel,
    ),
  });
  const persistence = new MemoryAlertPersistence();
  const liveMonitor = new LiveMonitor({
    productionStore,
    nodeSource,
    alertPersistence: persistence,
    now,
    tickMs: 60_000,
  });
  const server = buildServer({ productionStore, liveMonitor });
  servers.add(server);
  const observe = () =>
    nodeSource.observe(
      clock,
      levelsWith([-12, -30]),
      telemetryWith([{ batteryChargePercent: options.batteryPercent ?? 90 }]),
    );
  observe();
  await server.ready();
  const advance = async (ms: number) => {
    clock += ms;
    observe();
    await liveMonitor.tick();
  };
  return { server, liveMonitor, persistence, advance };
}

describe("live monitoring routes", () => {
  it("serves the shared live state as a validated contract", async () => {
    const { server } = await monitoredServer();
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/live/state",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const state = parseLiveState(response.json());
    expect(state.show).toEqual({
      name: "The Winter Circus",
      showfileRevision: 1,
      overlayExpiryMs: 300_000,
    });
    expect(state.node.status).toBe("ready");
    expect(state.channels.map(({ id, hasImage }) => [id, hasImage])).toEqual([
      ["ch-marguerite", true],
      ["ch-talkback", false],
    ]);
    expect(state.summary).toEqual({
      active: 0,
      outstanding: 0,
      outstandingCritical: 0,
    });
  });

  it("raises, acknowledges and logs an alert across the shared state", async () => {
    const { server, advance, persistence } = await monitoredServer({
      batteryPercent: 8,
    });
    await advance(6_000);

    const raised = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(raised.summary).toEqual({
      active: 1,
      outstanding: 1,
      outstandingCritical: 1,
    });
    const alert = raised.alerts[0]!;
    expect(alert).toMatchObject({
      kind: "battery-critical",
      severity: "critical",
      channelId: "ch-marguerite",
      channelNumber: 1,
      channelName: "Marguerite",
      acknowledgedAtUtc: null,
    });

    const acknowledged = await server.inject({
      method: "POST",
      url: `/api/v1/alerts/${alert.id}/acknowledge`,
      payload: { operator: "Sam (A2)" },
    });
    expect(acknowledged.statusCode).toBe(200);
    const after = parseLiveState(acknowledged.json());
    expect(after.alerts[0]).toMatchObject({
      id: alert.id,
      acknowledgedBy: "Sam (A2)",
    });
    expect(after.summary).toEqual({
      active: 1,
      outstanding: 0,
      outstandingCritical: 0,
    });

    const log = parseAlertLog(
      (await server.inject({ method: "GET", url: "/api/v1/alerts" })).json(),
    );
    expect(log.active.map(({ id }) => id)).toEqual([alert.id]);

    await server.close();
    servers.clear();
    expect(persistence.saved?.active[0]?.alert.acknowledgedBy).toBe("Sam (A2)");
  });

  it("refuses to acknowledge an alert that is not active", async () => {
    const { server } = await monitoredServer();
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/alerts/alert-000404/acknowledge",
      payload: { operator: "Sam" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "alert-not-active" });
  });

  it("serves a channel photo from the showfile without shipping it in the state", async () => {
    const { server } = await monitoredServer();
    const photo = await server.inject({
      method: "GET",
      url: "/api/v1/channels/ch-marguerite/image",
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(photo.rawPayload.subarray(1, 4).toString()).toBe("PNG");

    const cached = await server.inject({
      method: "GET",
      url: "/api/v1/channels/ch-marguerite/image",
      headers: { "if-none-match": String(photo.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);

    const missing = await server.inject({
      method: "GET",
      url: "/api/v1/channels/ch-talkback/image",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("streams state events to a subscriber and ends them on shutdown", async () => {
    const { server, advance } = await monitoredServer();
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;

    const events: LiveState[] = [];
    const response = await new Promise<import("node:http").IncomingMessage>(
      (resolve, reject) => {
        request(
          { host: "127.0.0.1", port, path: "/api/v1/live/events" },
          resolve,
        )
          .on("error", reject)
          .end();
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    let buffer = "";
    const received = new Promise<void>((resolve) => {
      response.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (data) events.push(parseLiveState(JSON.parse(data.slice(6))));
          if (events.length >= 2) resolve();
          boundary = buffer.indexOf("\n\n");
        }
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await advance(1_000);
    await received;
    expect(events[1]!.revision).toBeGreaterThan(events[0]!.revision);

    const ended = once(response, "end");
    await server.close();
    servers.clear();
    await ended;
  });
});

describe("channel reset route", () => {
  it("clears a switched-off channel's alerts and re-arms it when signal returns", async () => {
    let clock = Date.parse("2026-09-23T01:00:00Z");
    let peaks: number[] = [-12, -30];
    const nodeSource = new FakeNodeSource();
    const productionStore = new MemoryProductionStore();
    await productionStore.saveActive(showfileWith({ revision: 0 }));
    const liveMonitor = new LiveMonitor({
      productionStore,
      nodeSource,
      now: () => clock,
      tickMs: 60_000,
    });
    const server = buildServer({ productionStore, liveMonitor });
    servers.add(server);
    await server.ready();
    const advance = async (ms: number) => {
      clock += ms;
      nodeSource.observe(
        clock,
        levelsWith(peaks),
        telemetryWith([{ batteryChargePercent: 90 }]),
      );
      await liveMonitor.tick();
    };
    const state = async () =>
      parseLiveState(
        (
          await server.inject({ method: "GET", url: "/api/v1/live/state" })
        ).json(),
      );
    const silence = async () => {
      peaks = [-120, -30];
      for (let step = 0; step < 40; step += 1) await advance(2_000);
    };

    await advance(1_000);
    await silence();
    const faulted = await state();
    expect(
      faulted.alerts.map(({ kind, channelId }) => [kind, channelId]),
    ).toEqual([["no-audio", "ch-marguerite"]]);
    expect(faulted.channels[0]!.statuses.audio).toBe("fault");

    const reset = await server.inject({
      method: "POST",
      url: "/api/v1/channels/ch-marguerite/reset",
    });
    expect(reset.statusCode).toBe(200);
    const cleared = parseLiveState(reset.json());
    expect(cleared.alerts).toEqual([]);
    // Back to the not-yet-used look, not "not applicable".
    expect(cleared.channels[0]!.statuses.audio).toBe("unknown");
    expect(liveMonitor.alertLog().history[0]).toMatchObject({
      kind: "no-audio",
      clearedAtUtc: expect.any(String),
    });

    // Still switched off: nothing comes back.
    for (let step = 0; step < 40; step += 1) await advance(2_000);
    expect((await state()).alerts).toEqual([]);

    // Signal returns, then goes silent again: the channel is armed once more.
    peaks = [-12, -30];
    await advance(1_000);
    await silence();
    expect((await state()).alerts.map(({ kind }) => kind)).toEqual([
      "no-audio",
    ]);
  });

  it("refuses a channel the show does not have", async () => {
    const { server } = await monitoredServer();
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/channels/ch-missing/reset",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "channel-not-found" });
  });
});

describe("showfile validation for monitoring", () => {
  it("rejects duplicate channel ids and an incoherent alert policy", async () => {
    const server = buildServer();
    servers.add(server);
    const base = showfileWith({ revision: 0 });
    const duplicate = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...base,
        channels: base.channels.map((channel) => ({ ...channel, id: "same" })),
      },
    });
    expect(duplicate.statusCode).toBe(400);

    const incoherent = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...base,
        alertPolicy: {
          batteryCautionPercent: 10,
          batteryCriticalPercent: 25,
          rfCautionDbm: -80,
          rfCriticalDbm: -90,
          qualityCautionPercent: 40,
          qualityCriticalPercent: 20,
          silenceFloorDbfs: -70,
          silenceAfterSeconds: 30,
          clipAlerts: true,
          overlayExpiryMinutes: 5,
        },
      },
    });
    expect(incoherent.statusCode).toBe(400);
  });

  it("mints ids for channels saved without one and keeps existing ids", async () => {
    const server = buildServer();
    servers.add(server);
    const base = showfileWith({ revision: 0 });
    const saved = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...base,
        channels: [base.channels[0], { inputIndex: 1, name: "New channel" }],
      },
    });
    expect(saved.statusCode).toBe(200);
    const [kept, minted] = saved.json().channels;
    expect(kept.id).toBe("ch-marguerite");
    expect(minted.id).toMatch(/^ch-[0-9a-f]{8}$/);
  });
});

describe("guided mic check routes", () => {
  it("records verdicts that every client sees in the Check cell, and resets them", async () => {
    const { server } = await monitoredServer();
    const put = (dimension: string, verdict: string, by = "Sam (A2)") =>
      server.inject({
        method: "PUT",
        url: `/api/v1/checks/ch-marguerite/dimensions/${dimension}`,
        payload: { verdict, by },
      });

    expect((await put("physical-identity", "pass")).statusCode).toBe(200);
    const waiting = await put("captured-audio", "waiting");
    expect(parseMicChecks(waiting.json()).checks[0]?.dimensions).toHaveLength(
      2,
    );

    const inProgress = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(inProgress.channels[0]?.statuses.check).toBe("caution");
    expect(inProgress.channels[0]?.check).toMatchObject({
      passed: 1,
      waiting: 1,
      total: 8,
      stale: false,
    });

    await put("battery-window", "fail");
    const failed = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(failed.channels[0]?.statuses.check).toBe("fault");

    const missing = await server.inject({
      method: "PUT",
      url: "/api/v1/checks/ch-nope/dimensions/rf-link",
      payload: { verdict: "pass", by: "Sam" },
    });
    expect(missing.statusCode).toBe(404);
    const badDimension = await server.inject({
      method: "PUT",
      url: "/api/v1/checks/ch-marguerite/dimensions/vibes",
      payload: { verdict: "pass", by: "Sam" },
    });
    expect(badDimension.statusCode).toBe(400);

    const reset = await server.inject({
      method: "DELETE",
      url: "/api/v1/checks/ch-marguerite",
    });
    expect(parseMicChecks(reset.json()).checks).toEqual([]);
    const cleared = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(cleared.channels[0]?.statuses.check).toBe("unknown");
    expect(cleared.channels[0]?.check).toBeNull();
  });
});

describe("A1 fault report routes", () => {
  it("files a report, lets the A2 claim and resolve it, and refuses invalid transitions", async () => {
    const { server } = await monitoredServer();
    const filed = await server.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: {
        channelId: "ch-marguerite",
        faults: ["crackling", "clothing-noise"],
        requestedBy: "Morgan (A1)",
      },
    });
    expect(filed.statusCode).toBe(201);
    const report = parseLiveState(filed.json()).reports[0]!;
    expect(report).toMatchObject({
      channelName: "Marguerite",
      status: "open",
      requestedBy: "Morgan (A1)",
    });

    const act = (action: string, by: string) =>
      server.inject({
        method: "POST",
        url: `/api/v1/reports/${report.id}/actions`,
        payload: { action, by },
      });
    const claimed = parseLiveState((await act("claim", "Sam (A2)")).json());
    expect(claimed.reports[0]).toMatchObject({
      status: "claimed",
      claimedBy: "Sam (A2)",
    });
    const resolved = parseLiveState((await act("resolve", "Sam (A2)")).json());
    expect(resolved.reports[0]?.status).toBe("closed");
    expect((await act("claim", "Sam (A2)")).statusCode).toBe(409);

    const unknownChannel = await server.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: {
        channelId: "ch-nope",
        faults: ["popping"],
        requestedBy: "Morgan",
      },
    });
    expect(unknownChannel.statusCode).toBe(404);
    const noFaults = await server.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: {
        channelId: "ch-marguerite",
        faults: [],
        requestedBy: "Morgan",
      },
    });
    expect(noFaults.statusCode).toBe(400);
    expect(noFaults.json()).toEqual({ error: "invalid-request" });
    const missing = await server.inject({
      method: "POST",
      url: "/api/v1/reports/report-999999/actions",
      payload: { action: "claim", by: "Sam" },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("live state with an unreadable production library", () => {
  it("keeps publishing node state under an honest show name instead of failing", async () => {
    const productionStore = new MemoryProductionStore();
    let broken = true;
    const loadActive = productionStore.loadActive.bind(productionStore);
    productionStore.loadActive = async () => {
      if (broken) throw new Error("productions.json is not valid JSON");
      return loadActive();
    };
    const errors: unknown[] = [];
    const nodeSource = new FakeNodeSource();
    nodeSource.observe(Date.now(), levelsWith([-12, -30]), null);
    const liveMonitor = new LiveMonitor({
      productionStore,
      nodeSource,
      tickMs: 60_000,
      onError: (error) => errors.push(error),
    });
    const server = buildServer({ productionStore, liveMonitor });
    servers.add(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/live/state",
    });
    expect(response.statusCode).toBe(200);
    const state = parseLiveState(response.json());
    expect(state.show.name).toBe("Showfile could not be read");
    expect(state.channels).toEqual([]);
    expect(state.node.status).toBe("ready");
    expect(errors).toHaveLength(1);

    broken = false;
    liveMonitor.invalidateShowfile();
    await liveMonitor.tick();
    const recovered = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(recovered.show.name).toBe("Untitled show");
  });
});
