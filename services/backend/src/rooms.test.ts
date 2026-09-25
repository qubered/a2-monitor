import { afterEach, describe, expect, it } from "vitest";
import {
  parseLiveState,
  type LiveState,
  type Showfile,
} from "@rvlt/pulse-protocol/http";
import { LiveMonitor } from "./live-monitor.js";
import {
  FakeNodeSource,
  levelsWith,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import { MemoryProductionStore } from "./productions.js";
import { buildServer } from "./server.js";

const T0 = Date.parse("2026-09-23T01:00:00Z");

const ROOMS: NonNullable<Showfile["rooms"]> = [
  {
    id: "room-ballroom",
    name: "Ballroom",
    categories: [{ id: "cat-stage", name: "Stage" }],
  },
  {
    id: "room-breakout",
    name: "Breakout B",
    categories: [{ id: "cat-lectern", name: "Lectern" }],
  },
];

function roomedShowfile(): Showfile {
  const base = showfileWith({ revision: 0 });
  return {
    ...base,
    rooms: ROOMS,
    channels: [
      {
        ...base.channels[0]!,
        rooms: [{ roomId: "room-ballroom", categoryId: "cat-stage" }],
      },
      {
        ...base.channels[1]!,
        rooms: [{ roomId: "room-breakout", categoryId: "cat-lectern" }],
      },
    ],
    sessions: [
      {
        id: "ses-keynote",
        name: "Keynote",
        roomId: "room-ballroom",
        startMinute: 540,
        channels: [{ channelId: "ch-marguerite", presenter: "Dana Lee" }],
      },
      {
        id: "ses-workshop",
        name: "Workshop",
        roomId: "room-breakout",
        startMinute: 570,
        channels: [{ channelId: "ch-talkback", presenter: "Sam Ortiz" }],
      },
    ],
  };
}

const servers = new Set<ReturnType<typeof buildServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

async function roomServer() {
  const nodeSource = new FakeNodeSource();
  const productionStore = new MemoryProductionStore();
  await productionStore.saveActive(roomedShowfile());
  const liveMonitor = new LiveMonitor({
    productionStore,
    nodeSource,
    now: () => T0,
    tickMs: 60_000,
  });
  const server = buildServer({ productionStore, liveMonitor });
  servers.add(server);
  nodeSource.observe(T0, levelsWith([-12, -30]), telemetryWith([{}]));
  await server.ready();
  const put = async (payload: Record<string, unknown>) =>
    server.inject({ method: "PUT", url: "/api/v1/live/session", payload });
  return { server, put };
}

function run(state: LiveState, roomId: string) {
  return state.runs!.find((entry) => entry.roomId === roomId)!;
}

describe("rooms", () => {
  it("publishes rooms, categories and each channel's place", async () => {
    const { server } = await roomServer();
    const state = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(state.rooms).toEqual(ROOMS);
    expect(state.channels.map(({ rooms }) => rooms)).toEqual([
      [{ roomId: "room-ballroom", categoryId: "cat-stage" }],
      [{ roomId: "room-breakout", categoryId: "cat-lectern" }],
    ]);
    expect(state.runs!.map(({ roomId }) => roomId)).toEqual([
      "room-ballroom",
      "room-breakout",
    ]);
  });

  it("runs each room's sessions independently", async () => {
    const { put } = await roomServer();

    const keynote = parseLiveState(
      (await put({ sessionId: "ses-keynote", operator: "Sam" })).json(),
    );
    expect(run(keynote, "room-ballroom").activeId).toBe("ses-keynote");
    expect(run(keynote, "room-breakout").activeId).toBeNull();
    const [ballroomChannel, breakoutChannel] = keynote.channels;
    expect(ballroomChannel!.session).toMatchObject({ inUse: true });
    // The breakout has not started, so its channel is not idle yet.
    expect(breakoutChannel!.session).toMatchObject({
      inUse: null,
      nextInUse: true,
      nextPresenter: "Sam Ortiz",
    });

    const both = parseLiveState(
      (await put({ sessionId: "ses-workshop", operator: "Ana" })).json(),
    );
    expect(run(both, "room-ballroom").activeId).toBe("ses-keynote");
    expect(run(both, "room-breakout")).toMatchObject({
      activeId: "ses-workshop",
      startedBy: "Ana",
    });
    expect(both.channels[1]!.performer).toBe("Sam Ortiz");

    const ended = parseLiveState(
      (
        await put({
          sessionId: null,
          roomId: "room-ballroom",
          operator: "Sam",
        })
      ).json(),
    );
    expect(run(ended, "room-ballroom").activeId).toBeNull();
    expect(run(ended, "room-breakout").activeId).toBe("ses-workshop");
  });

  it("belongs to several rooms at once, each with its own category (ADR 0035)", async () => {
    const base = showfileWith({ revision: 0 });
    const productionStore = new MemoryProductionStore();
    await productionStore.saveActive({
      ...base,
      rooms: ROOMS,
      channels: [
        {
          // A shared spare, in both rooms with a different category in each.
          ...base.channels[0]!,
          rooms: [
            { roomId: "room-ballroom", categoryId: "cat-stage" },
            { roomId: "room-breakout", categoryId: "cat-lectern" },
          ],
        },
        base.channels[1]!,
      ],
      sessions: [
        {
          id: "ses-keynote",
          name: "Keynote",
          roomId: "room-ballroom",
          startMinute: 540,
          channels: [{ channelId: "ch-marguerite", presenter: "Dana Lee" }],
        },
      ],
    });
    const nodeSource = new FakeNodeSource();
    const liveMonitor = new LiveMonitor({
      productionStore,
      nodeSource,
      now: () => T0,
      tickMs: 60_000,
    });
    const server = buildServer({ productionStore, liveMonitor });
    servers.add(server);
    nodeSource.observe(T0, levelsWith([-12, -30]), telemetryWith([{}]));
    await server.ready();

    const before = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(before.channels[0]!.rooms).toEqual([
      { roomId: "room-ballroom", categoryId: "cat-stage" },
      { roomId: "room-breakout", categoryId: "cat-lectern" },
    ]);
    // No session running in either room yet.
    expect(before.channels[0]!.session).toMatchObject({ inUse: null });

    const started = parseLiveState(
      (
        await server.inject({
          method: "PUT",
          url: "/api/v1/live/session",
          payload: { sessionId: "ses-keynote", operator: "Sam" },
        })
      ).json(),
    );
    // The ballroom's session governs it: in use there, and it counts even
    // though the breakout — the channel's other room — has nothing running.
    expect(started.channels[0]!.session).toMatchObject({ inUse: true });
  });

  it("refuses to end the run of a room the show does not have", async () => {
    const { put } = await roomServer();
    const response = await put({
      sessionId: null,
      roomId: "room-missing",
      operator: "Sam",
    });
    expect(response.statusCode).toBe(404);
  });

  it("mints room and category ids and clears references the show cannot honour", async () => {
    const { server } = await roomServer();
    const current = (
      await server.inject({ method: "GET", url: "/api/v1/showfile" })
    ).json() as Showfile;
    const response = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...current,
        rooms: [
          ...current.rooms!,
          { name: "  Foyer ", categories: [{ name: " Welcome desk " }] },
        ],
        channels: [
          // A category from another room.
          {
            ...current.channels[0]!,
            rooms: [{ roomId: "room-ballroom", categoryId: "cat-lectern" }],
          },
          // A room that does not exist.
          {
            ...current.channels[1]!,
            rooms: [{ roomId: "room-gone", categoryId: null }],
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const saved = response.json() as Showfile;
    const foyer = saved.rooms![2]!;
    expect(foyer.id).toMatch(/^room-[0-9a-f]{8}$/);
    expect(foyer.name).toBe("Foyer");
    expect(foyer.categories[0]).toMatchObject({
      id: expect.stringMatching(/^cat-[0-9a-f]{8}$/),
      name: "Welcome desk",
    });
    expect(saved.channels[0]!.rooms).toEqual([
      { roomId: "room-ballroom", categoryId: null },
    ]);
    expect(saved.channels[1]!.rooms).toEqual([]);
    // The talkback left the breakout, so the workshop no longer lists it.
    expect(
      saved.sessions!.find(({ id }) => id === "ses-workshop")!.channels,
    ).toEqual([]);
  });

  it("rejects duplicate room or category ids and blank names", async () => {
    const { server } = await roomServer();
    const current = (
      await server.inject({ method: "GET", url: "/api/v1/showfile" })
    ).json() as Showfile;
    for (const rooms of [
      [ROOMS[0]!, { ...ROOMS[1]!, id: "room-ballroom" }],
      [
        ROOMS[0]!,
        { ...ROOMS[1]!, categories: [{ id: "cat-stage", name: "Stage" }] },
      ],
      [{ ...ROOMS[0]!, name: "   " }],
    ]) {
      const response = await server.inject({
        method: "PUT",
        url: "/api/v1/showfile",
        payload: { ...current, rooms },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
