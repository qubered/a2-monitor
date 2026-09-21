import { afterEach, describe, expect, it } from "vitest";
import type { LiveSnapshot } from "@rvlt/pulse-protocol/http";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";
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
      service: "a2-backend",
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
});
