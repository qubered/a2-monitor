import { afterEach, describe, expect, it } from "vitest";
import type { LiveSnapshot } from "@rvlt/pulse-protocol/http";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";
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

function trackedServer(...parameters: Parameters<typeof buildServer>) {
  const server = buildServer(...parameters);
  servers.add(server);
  return server;
}

describe("backend health and Live snapshot", () => {
  it("serves a validated health response", async () => {
    const response = await trackedServer().inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "pulse-backend",
      version: "0.0.0",
    });
  });

  it("serves the bounded fabricated Live snapshot", async () => {
    const response = await trackedServer().inject({
      method: "GET",
      url: "/api/v1/live/snapshot",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(fabricatedLiveSnapshot);
  });

  it("saves and returns a revisioned local showfile", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/showfile",
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().revision).toBe(0);

    const saved = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...initial.json(),
        show: { name: "Q3 All-Hands" },
        device: { name: "USB Interface", channelCount: 2 },
        channels: [
          { inputIndex: 0, name: "Alice" },
          { inputIndex: 1, name: "Bob" },
        ],
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      revision: 1,
      show: { name: "Q3 All-Hands" },
      channels: [{ name: "Alice" }, { name: "Bob" }],
    });
    expect(saved.json().updatedAtUtc).toBeTruthy();
  });

  it("fails closed when a provider adds an undeclared response field", async () => {
    const invalidSnapshot = {
      ...fabricatedLiveSnapshot,
      unsupported: true,
    } as LiveSnapshot;
    const response = await trackedServer({
      snapshotProvider: () => invalidSnapshot,
    }).inject({
      method: "GET",
      url: "/api/v1/live/snapshot",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("unsupported");
  });

  it("rejects required fields inherited through the prototype", async () => {
    const inheritedSnapshot = Object.create(
      fabricatedLiveSnapshot,
    ) as LiveSnapshot;
    const response = await trackedServer({
      snapshotProvider: () => inheritedSnapshot,
    }).inject({
      method: "GET",
      url: "/api/v1/live/snapshot",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toBe("{}");
  });

  it("rejects a toJSON hook that changes the serialized contract", async () => {
    const transformedSnapshot = { ...fabricatedLiveSnapshot } as LiveSnapshot;
    Object.defineProperty(transformedSnapshot, "toJSON", {
      value: () => ({ ...fabricatedLiveSnapshot, unsupported: true }),
    });
    const response = await trackedServer({
      snapshotProvider: () => transformedSnapshot,
    }).inject({
      method: "GET",
      url: "/api/v1/live/snapshot",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("unsupported");
  });

  it("counts response string bounds in Unicode code points", async () => {
    const firstChannel = fabricatedLiveSnapshot.channels[0];
    const unicodeSnapshot: LiveSnapshot = {
      ...fabricatedLiveSnapshot,
      channels: [
        {
          ...firstChannel,
          alert: {
            severity: "caution",
            label: "😀".repeat(50),
            dimension: "Audio",
          },
        },
      ],
    };
    const response = await trackedServer({
      snapshotProvider: () => unicodeSnapshot,
    }).inject({ method: "GET", url: "/api/v1/live/snapshot" });

    expect(response.statusCode).toBe(200);
  });

  it("rejects link quality outside the 0 to 100 percent contract", async () => {
    const firstChannel = fabricatedLiveSnapshot.channels[0];
    const invalidSnapshot: LiveSnapshot = {
      ...fabricatedLiveSnapshot,
      channels: [
        {
          ...firstChannel,
          details: { ...firstChannel.details, linkQualityPercent: 100.1 },
        },
      ],
    };
    const response = await trackedServer({
      snapshotProvider: () => invalidSnapshot,
    }).inject({ method: "GET", url: "/api/v1/live/snapshot" });

    expect(response.statusCode).toBe(500);
  });

  it("rejects impossible calendar dates", async () => {
    const invalidSnapshot = {
      ...fabricatedLiveSnapshot,
      generatedAtUtc: "2026-02-31T00:00:00Z",
    } as LiveSnapshot;
    const response = await trackedServer({
      snapshotProvider: () => invalidSnapshot,
    }).inject({ method: "GET", url: "/api/v1/live/snapshot" });

    expect(response.statusCode).toBe(500);
  });

  it("saves a channel's monitored dimensions, mic type and image URL", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/showfile",
    });

    const saved = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...initial.json(),
        show: { name: "Q3 All-Hands" },
        device: { name: "USB Interface", channelCount: 2 },
        channels: [
          {
            inputIndex: 0,
            name: "Alice",
            micType: "headset",
            imageUrl: "https://example.com/alice.jpg",
            monitor: { battery: true, rf: false, audio: true },
          },
        ],
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      channels: [
        {
          name: "Alice",
          micType: "headset",
          imageUrl: "https://example.com/alice.jpg",
          monitor: { battery: true, rf: false, audio: true },
        },
      ],
    });
  });

  it("rejects a channel image URL without an http(s) scheme", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/showfile",
    });

    const response = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...initial.json(),
        device: { name: "USB Interface", channelCount: 2 },
        channels: [
          {
            inputIndex: 0,
            name: "Alice",
            imageUrl: "javascript:alert(1)",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid-showfile" });
  });

  it("accepts an uploaded base64 image data URL and rejects a malformed one", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/showfile",
    });

    const uploaded = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...initial.json(),
        device: { name: "USB Interface", channelCount: 2 },
        channels: [
          {
            inputIndex: 0,
            name: "Alice",
            imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=",
          },
        ],
      },
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({
      channels: [
        { imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=" },
      ],
    });

    const malformed = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...uploaded.json(),
        channels: [
          {
            inputIndex: 0,
            name: "Alice",
            imageUrl: "data:text/html;base64,PHNjcmlwdD4=",
          },
        ],
      },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: "invalid-showfile" });
  });
});

describe("backend showfile host output", () => {
  const session = (id: string, name: string, outputChannels: number[]) => ({
    id,
    name,
    outputChannels,
  });

  it("saves the production's host output sessions and rejects incoherent ones", async () => {
    const server = trackedServer();
    const initial = (
      await server.inject({ method: "GET", url: "/api/v1/showfile" })
    ).json();
    const sessions = [
      session("hs-a", "Comms A", [1]),
      session("hs-b", "Comms B", [2, 12]),
    ];

    const saved = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: { ...initial, hostOutput: { sessions } },
    });
    expect(saved.statusCode).toBe(200);
    const reloaded = await server.inject({
      method: "GET",
      url: "/api/v1/showfile",
    });
    expect(reloaded.json()).toMatchObject({ hostOutput: { sessions } });

    for (const invalid of [
      [],
      [session("hs-a", "Comms A", [])],
      [session("hs-a", "Comms A", [3, 3])],
      [session("hs-a", "Comms A", [1]), session("hs-b", "Comms B", [1])],
      [session("hs-a", "Comms A", [1]), session("hs-a", "Comms B", [2])],
      [session("hs-a", "Comms", [1]), session("hs-b", "comms", [2])],
      [session("hs-a", "  ", [1])],
      [session("hs-a", "Comms A", [0])],
    ]) {
      const refused = await server.inject({
        method: "PUT",
        url: "/api/v1/showfile",
        payload: { ...saved.json(), hostOutput: { sessions: invalid } },
      });
      expect(refused.statusCode, JSON.stringify(invalid)).toBe(400);
    }
  });
});

describe("backend productions", () => {
  it("lists the default production as active", async () => {
    const response = await trackedServer().inject({
      method: "GET",
      url: "/api/v1/productions",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.productions).toHaveLength(1);
    expect(body.activeId).toBe(body.productions[0].id);
    expect(body.productions[0]).toMatchObject({
      name: "Untitled show",
      revision: 0,
      channelCount: 0,
      receiverCount: 0,
    });
  });

  it("creates a production, activates it, and exposes it through the showfile route", async () => {
    const server = trackedServer();

    const created = await server.inject({
      method: "POST",
      url: "/api/v1/productions",
      payload: { name: "Spring Gala" },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.productions).toHaveLength(2);
    const newProduction = createdBody.productions.find(
      (production: { name: string }) => production.name === "Spring Gala",
    );
    expect(createdBody.activeId).toBe(newProduction.id);

    const showfile = await server.inject({
      method: "GET",
      url: "/api/v1/showfile",
    });
    expect(showfile.json()).toMatchObject({ show: { name: "Spring Gala" } });
  });

  it("fetches a production's full showfile by id without activating it, for download", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/productions",
    });
    const originalId = initial.json().activeId as string;

    const created = await server.inject({
      method: "POST",
      url: "/api/v1/productions",
      payload: { name: "Spring Gala" },
    });
    expect(created.json().activeId).not.toBe(originalId);

    const fetched = await server.inject({
      method: "GET",
      url: `/api/v1/productions/${originalId}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ show: { name: "Untitled show" } });

    const stillOnSpringGala = await server.inject({
      method: "GET",
      url: "/api/v1/productions",
    });
    expect(stillOnSpringGala.json().activeId).not.toBe(originalId);
  });

  it("404s fetching an unknown production by id", async () => {
    const response = await trackedServer().inject({
      method: "GET",
      url: "/api/v1/productions/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "production-not-found" });
  });

  it("switches the active production and back", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/productions",
    });
    const originalId = initial.json().activeId as string;

    await server.inject({
      method: "POST",
      url: "/api/v1/productions",
      payload: { name: "Spring Gala" },
    });

    const reactivated = await server.inject({
      method: "POST",
      url: `/api/v1/productions/${originalId}/activate`,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().activeId).toBe(originalId);
  });

  it("404s activating an unknown production", async () => {
    const response = await trackedServer().inject({
      method: "POST",
      url: "/api/v1/productions/does-not-exist/activate",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "production-not-found" });
  });

  it("removes an inactive production but refuses to remove the active one", async () => {
    const server = trackedServer();
    const initial = await server.inject({
      method: "GET",
      url: "/api/v1/productions",
    });
    const originalId = initial.json().activeId as string;

    const created = await server.inject({
      method: "POST",
      url: "/api/v1/productions",
      payload: { name: "Spring Gala" },
    });
    const activeId = created.json().activeId as string;

    const refusedActive = await server.inject({
      method: "DELETE",
      url: `/api/v1/productions/${activeId}`,
    });
    expect(refusedActive.statusCode).toBe(400);
    expect(refusedActive.json()).toEqual({ error: "active-production" });

    const removed = await server.inject({
      method: "DELETE",
      url: `/api/v1/productions/${originalId}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(
      removed
        .json()
        .productions.some(
          (production: { id: string }) => production.id === originalId,
        ),
    ).toBe(false);
  });
});

describe("channel level history", () => {
  it("404s for a channel id absent from the current snapshot", async () => {
    const response = await trackedServer().inject({
      method: "GET",
      url: "/api/v1/live/history?channelId=not-a-real-channel",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "channel-not-found" });
  });

  it("serves a validated window of observed samples for a known channel", async () => {
    const nodeSource = new FakeNodeSource();
    const productionStore = new MemoryProductionStore();
    const initial = await productionStore.loadActive();
    await productionStore.saveActive({
      ...showfileWith(),
      revision: initial.revision,
    });
    const server = trackedServer({ productionStore, nodeSource });
    nodeSource.observe(Date.now(), levelsWith([-12, -30]), telemetryWith([{}]));
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/live/history?channelId=ch-marguerite&windowMs=5000",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.channelId).toBe("ch-marguerite");
    expect(body.windowMs).toBe(5000);
    expect(body.samples.length).toBeGreaterThan(0);
    expect(body.samples.at(-1)).toMatchObject({
      audioDbfs: -12,
      rfLevelDbm: -58,
      batteryPercent: 90,
      availability: "observed",
    });
  });

  it("clamps an out-of-range window to the supported bounds", async () => {
    const productionStore = new MemoryProductionStore();
    await productionStore.saveActive(showfileWith({ revision: 0 }));
    const response = await trackedServer({ productionStore }).inject({
      method: "GET",
      url: "/api/v1/live/history?channelId=ch-marguerite&windowMs=9999999",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().windowMs).toBe(60 * 60 * 1000);
  });
});
