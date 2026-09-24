import { afterEach, describe, expect, it } from "vitest";
import { parseLiveState, type Showfile } from "@rvlt/pulse-protocol/http";
import { DEFAULT_ALERT_POLICY } from "./alert-policy.js";
import { evaluate, type ChannelTracker } from "./live-model.js";
import { LiveMonitor } from "./live-monitor.js";
import {
  FakeNodeSource,
  levelsWith,
  observationAt,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import { MemoryProductionStore } from "./productions.js";
import { buildServer } from "./server.js";
import {
  MemorySessionPersistence,
  NO_SESSION,
  resolveRoom,
  resolveSessions,
  type SessionRun,
} from "./sessions.js";

/** Resolved runs for a show whose sessions are all in no room. */
function unroomed(showfile: Showfile, run: SessionRun) {
  return resolveSessions(showfile, new Map([["", run]]));
}

const T0 = Date.parse("2026-09-23T01:00:00Z");

const SESSIONS: NonNullable<Showfile["sessions"]> = [
  {
    id: "ses-keynote",
    name: "Keynote",
    startMinute: 540,
    channels: [{ channelId: "ch-talkback", presenter: "Dana Lee" }],
  },
  {
    id: "ses-panel",
    name: "Panel",
    startMinute: 630,
    channels: [
      { channelId: "ch-marguerite", presenter: "Priya Shah" },
      { channelId: "ch-talkback", presenter: null },
    ],
  },
];

describe("resolveSessions", () => {
  it("treats the first session as next when nothing is running", () => {
    const { active, next } = resolveRoom(
      showfileWith({ sessions: SESSIONS }),
      NO_SESSION,
      "",
    );
    expect(active).toBeNull();
    expect(next?.id).toBe("ses-keynote");
  });

  it("forgets a run whose session the show no longer has", () => {
    const { active, next } = resolveRoom(
      showfileWith({ sessions: SESSIONS }),
      { activeId: "ses-gone", startedAtUtc: null, startedBy: null },
      "",
    );
    expect(active).toBeNull();
    expect(next?.id).toBe("ses-keynote");
  });
});

describe("evaluate with a running session", () => {
  const showfile = showfileWith({ sessions: SESSIONS });
  const sessions = unroomed(showfile, {
    activeId: "ses-keynote",
    startedAtUtc: "2026-09-23T00:59:00Z",
    startedBy: "Sam",
  });

  it("does not raise transmitter loss or mute for a channel the session does not use", () => {
    const trackers = new Map<string, ChannelTracker>();
    // The pack was seen, then switched off at the turnover.
    evaluate({
      showfile,
      policy: DEFAULT_ALERT_POLICY,
      observation: observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([{}]),
      ),
      trackers,
      nowMs: T0,
      sessions,
    });
    const result = evaluate({
      showfile,
      policy: DEFAULT_ALERT_POLICY,
      observation: observationAt(
        T0 + 1000,
        levelsWith([-90, -30]),
        telemetryWith([
          {
            linkStatus: "no-transmitter",
            transmitter: { type: null, name: null, muted: true },
          },
        ]),
      ),
      trackers,
      nowMs: T0 + 1000,
      sessions,
    });

    const [idle, keynote] = result.channels;
    expect(result.conditions.map(({ kind }) => kind)).not.toContain("rf-lost");
    expect(result.conditions.map(({ kind }) => kind)).not.toContain("tx-muted");
    expect(idle!.statuses.rf).toBe("not-applicable");
    expect(idle!.statuses.audio).toBe("not-applicable");
    expect(idle!.session).toEqual({
      inUse: false,
      nextInUse: true,
      nextPresenter: "Priya Shah",
    });
    expect(idle!.performer).toBe("Eleanor Vance");
    expect(keynote!.performer).toBe("Dana Lee");
    expect(keynote!.session).toEqual({
      inUse: true,
      nextInUse: true,
      nextPresenter: null,
    });
  });

  it("still raises transmitter loss for a channel the session uses", () => {
    const trackers = new Map<string, ChannelTracker>();
    const panel = unroomed(showfile, {
      activeId: "ses-panel",
      startedAtUtc: null,
      startedBy: null,
    });
    for (const [offset, linkStatus] of [
      [0, "active"],
      [1000, "no-transmitter"],
    ] as const) {
      const result = evaluate({
        showfile,
        policy: DEFAULT_ALERT_POLICY,
        observation: observationAt(
          T0 + offset,
          levelsWith([-12, -30]),
          telemetryWith([{ linkStatus }]),
        ),
        trackers,
        nowMs: T0 + offset,
        sessions: panel,
      });
      if (offset > 0) {
        expect(result.conditions.map(({ kind }) => kind)).toContain("rf-lost");
      }
    }
  });

  it("leaves channels without session context when the show has no sessions", () => {
    const result = evaluate({
      showfile: showfileWith(),
      policy: DEFAULT_ALERT_POLICY,
      observation: observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([{}]),
      ),
      trackers: new Map(),
      nowMs: T0,
      sessions: unroomed(showfileWith(), NO_SESSION),
    });
    expect(result.channels.every(({ session }) => session === null)).toBe(true);
  });
});

const servers = new Set<ReturnType<typeof buildServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

async function sessionServer() {
  let clock = T0;
  const nodeSource = new FakeNodeSource();
  const productionStore = new MemoryProductionStore();
  await productionStore.saveActive(
    showfileWith({ revision: 0, sessions: SESSIONS }),
  );
  const sessionPersistence = new MemorySessionPersistence();
  const liveMonitor = new LiveMonitor({
    productionStore,
    nodeSource,
    sessionPersistence,
    now: () => clock,
    tickMs: 60_000,
  });
  const server = buildServer({ productionStore, liveMonitor });
  servers.add(server);
  nodeSource.observe(clock, levelsWith([-12, -30]), telemetryWith([{}]));
  await server.ready();
  const advance = async (ms: number, peaks: number[]) => {
    clock += ms;
    nodeSource.observe(clock, levelsWith(peaks), telemetryWith([{}]));
    await liveMonitor.tick();
  };
  return { server, liveMonitor, sessionPersistence, advance };
}

describe("session routes", () => {
  it("starts, reports and ends a session for every client", async () => {
    const { server, sessionPersistence } = await sessionServer();

    const before = parseLiveState(
      (
        await server.inject({ method: "GET", url: "/api/v1/live/state" })
      ).json(),
    );
    expect(before.runs).toHaveLength(1);
    expect(before.runs![0]).toMatchObject({
      roomId: null,
      activeId: null,
      nextId: "ses-keynote",
      sessions: [
        {
          id: "ses-keynote",
          name: "Keynote",
          startMinute: 540,
          channelCount: 1,
        },
        { id: "ses-panel", name: "Panel", startMinute: 630, channelCount: 2 },
      ],
    });

    const started = await server.inject({
      method: "PUT",
      url: "/api/v1/live/session",
      payload: { sessionId: "ses-keynote", operator: "  Sam  (A2) " },
    });
    expect(started.statusCode).toBe(200);
    const state = parseLiveState(started.json());
    expect(state.runs![0]).toMatchObject({
      activeId: "ses-keynote",
      nextId: "ses-panel",
      startedAtUtc: "2026-09-23T01:00:00.000Z",
      startedBy: "Sam (A2)",
    });
    expect(state.channels[1]!.performer).toBe("Dana Lee");
    expect(sessionPersistence.saved?.get("")?.activeId).toBe("ses-keynote");

    const ended = parseLiveState(
      (
        await server.inject({
          method: "PUT",
          url: "/api/v1/live/session",
          payload: { sessionId: null, roomId: null, operator: "Sam" },
        })
      ).json(),
    );
    expect(ended.runs![0]).toMatchObject({
      activeId: null,
      nextId: "ses-keynote",
      startedBy: null,
    });
  });

  it("re-arms silence alerting when a session starts", async () => {
    const { liveMonitor, advance } = await sessionServer();
    // Talkback has been heard and has gone quiet, so its silence would become
    // No audio...
    await advance(1000, [-12, -30]);
    await advance(1000, [-12, -90]);
    await liveMonitor.startSession("ses-keynote", null, "Sam");
    // ...but the new session has not heard it yet, so it stays quiet.
    for (let second = 0; second < 40; second += 1) {
      await advance(1000, [-12, -90]);
    }
    const { state } = await liveMonitor.current();
    expect(state.alerts.map(({ kind }) => kind)).not.toContain("no-audio");
    expect(state.channels[1]!.statuses.audio).toBe("unknown");

    await advance(1000, [-12, -30]);
    for (let second = 0; second < 40; second += 1) {
      await advance(1000, [-12, -90]);
    }
    const { state: later } = await liveMonitor.current();
    expect(later.alerts.map(({ kind }) => kind)).toContain("no-audio");
  });

  it("refuses a session the active show does not have", async () => {
    const { server } = await sessionServer();
    const response = await server.inject({
      method: "PUT",
      url: "/api/v1/live/session",
      payload: { sessionId: "ses-missing", operator: "Sam" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "session-not-found" });
  });
});

describe("showfile sessions", () => {
  it("mints session ids and drops entries for removed channels", async () => {
    const { server } = await sessionServer();
    const current = (
      await server.inject({ method: "GET", url: "/api/v1/showfile" })
    ).json() as Showfile;
    const response = await server.inject({
      method: "PUT",
      url: "/api/v1/showfile",
      payload: {
        ...current,
        sessions: [
          ...current.sessions!,
          {
            name: "  Closing  ",
            startMinute: null,
            channels: [
              { channelId: "ch-talkback", presenter: "   " },
              { channelId: "ch-removed", presenter: "Nobody" },
            ],
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const saved = response.json() as Showfile;
    const closing = saved.sessions![2]!;
    expect(closing.id).toMatch(/^ses-[0-9a-f]{8}$/);
    expect(closing.name).toBe("Closing");
    expect(closing.channels).toEqual([
      { channelId: "ch-talkback", presenter: null },
    ]);
  });

  it("rejects a session that lists a channel twice or duplicates an id", async () => {
    const { server } = await sessionServer();
    const current = (
      await server.inject({ method: "GET", url: "/api/v1/showfile" })
    ).json() as Showfile;
    for (const sessions of [
      [
        {
          ...SESSIONS[0]!,
          channels: [
            { channelId: "ch-talkback", presenter: null },
            { channelId: "ch-talkback", presenter: "Again" },
          ],
        },
      ],
      [SESSIONS[0]!, { ...SESSIONS[1]!, id: "ses-keynote" }],
    ]) {
      const response = await server.inject({
        method: "PUT",
        url: "/api/v1/showfile",
        payload: { ...current, sessions },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
