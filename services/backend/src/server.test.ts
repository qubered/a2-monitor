import { afterEach, describe, expect, it } from "vitest";
import type { LiveSnapshot } from "@a2-monitor/protocol/live-snapshot";
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
});
