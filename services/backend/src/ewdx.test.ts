import { afterEach, describe, expect, it } from "vitest";
import type { Showfile, ShureTelemetry } from "@rvlt/pulse-protocol/http";
import { DEFAULT_ALERT_POLICY } from "./alert-policy.js";
import { evaluate } from "./live-model.js";
import {
  levelsWith,
  observationAt,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import { buildServer } from "./server.js";

const PIN = "0123456789abcdef".repeat(4);
const EWDX = {
  id: "ewdx-a",
  name: "EW-DX rack",
  host: "192.0.2.40",
  model: "EW-DX EM 2 Dante" as const,
  channelCount: 2 as const,
  tlsCertificateSha256: PIN,
};

const servers = new Set<ReturnType<typeof buildServer>>();
afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

async function put(payload: (initial: Showfile) => unknown) {
  const server = buildServer();
  servers.add(server);
  const initial = (
    await server.inject({ method: "GET", url: "/api/v1/showfile" })
  ).json() as Showfile;
  const response = await server.inject({
    method: "PUT",
    url: "/api/v1/showfile",
    payload: payload(initial) as Record<string, unknown>,
  });
  return { server, response };
}

/** The EM 2 Dante in inventory with no channel bound, so one rule is tested at a time. */
function inventory(initial: Showfile) {
  return { ...initial, sennheiserReceivers: [EWDX], channels: [] };
}

function bound(initial: Showfile, index: number, receiverId = "ewdx-a") {
  return {
    ...initial,
    sennheiserReceivers: [EWDX],
    channels: [
      {
        inputIndex: null,
        name: "Lead",
        shureReceiverId: receiverId,
        shureChannelIndex: index,
      },
    ],
  };
}

describe("showfile persistence of EW-DX receivers", () => {
  it("saves and reloads an EM 2 Dante with a channel bound to its second channel", async () => {
    const { server, response } = await put((initial) => bound(initial, 1));
    expect(response.statusCode).toBe(200);
    const reloaded = (
      await server.inject({ method: "GET", url: "/api/v1/showfile" })
    ).json();
    expect(reloaded).toMatchObject({
      sennheiserReceivers: [EWDX],
      channels: [{ shureReceiverId: "ewdx-a", shureChannelIndex: 1 }],
    });
  });

  it.each([
    ["a binding to a third channel", (initial: Showfile) => bound(initial, 2)],
    [
      "an id shared with a Shure receiver",
      (initial: Showfile) => ({
        ...inventory(initial),
        shureReceivers: [
          {
            id: "ewdx-a",
            name: "Shure",
            host: "192.0.2.10",
            model: "ULXD4D",
            channelCount: 2,
          },
        ],
      }),
    ],
    [
      "a hostname instead of an IP",
      (initial: Showfile) => ({
        ...inventory(initial),
        sennheiserReceivers: [{ ...EWDX, host: "rack.local" }],
      }),
    ],
    [
      "an upper-case certificate pin",
      (initial: Showfile) => ({
        ...inventory(initial),
        sennheiserReceivers: [
          { ...EWDX, tlsCertificateSha256: PIN.toUpperCase() },
        ],
      }),
    ],
    [
      "a non-hex certificate pin",
      (initial: Showfile) => ({
        ...inventory(initial),
        sennheiserReceivers: [
          { ...EWDX, tlsCertificateSha256: "z".repeat(64) },
        ],
      }),
    ],
    [
      "a short certificate pin",
      (initial: Showfile) => ({
        ...inventory(initial),
        sennheiserReceivers: [{ ...EWDX, tlsCertificateSha256: "not-a-pin" }],
      }),
    ],
    [
      "a blank receiver name",
      (initial: Showfile) => ({
        ...inventory(initial),
        sennheiserReceivers: [{ ...EWDX, name: "   " }],
      }),
    ],
    [
      "a stored password",
      (initial: Showfile) => ({
        ...inventory(initial),
        sennheiserReceivers: [{ ...EWDX, password: "secret" }],
      }),
    ],
    [
      "more than 64 receivers across both vendors",
      (initial: Showfile) => ({
        ...initial,
        shureReceivers: Array.from({ length: 40 }, (_, index) => ({
          id: `shure-${index}`,
          name: `Shure ${index}`,
          host: `192.0.2.${index + 1}`,
          model: "ULXD4",
          channelCount: 1,
        })),
        sennheiserReceivers: Array.from({ length: 25 }, (_, index) => ({
          ...EWDX,
          id: `ewdx-${index}`,
          host: `198.51.100.${index + 1}`,
        })),
        channels: [],
      }),
    ],
  ])("refuses %s", async (_label, payload) => {
    const { response } = await put(payload);
    expect(response.statusCode).toBe(400);
  });

  it("accepts exactly 64 receivers across both vendors", async () => {
    const { response } = await put((initial) => ({
      ...initial,
      shureReceivers: Array.from({ length: 40 }, (_, index) => ({
        id: `shure-${index}`,
        name: `Shure ${index}`,
        host: `192.0.2.${index + 1}`,
        model: "ULXD4",
        channelCount: 1,
      })),
      sennheiserReceivers: Array.from({ length: 24 }, (_, index) => ({
        ...EWDX,
        id: `ewdx-${index}`,
        host: `198.51.100.${index + 1}`,
      })),
      channels: [],
    }));
    expect(response.statusCode).toBe(200);
  });
});

const T0 = Date.parse("2026-09-23T01:00:00Z");

function ewdxTelemetry(
  channel: Partial<ShureTelemetry["receivers"][number]["channels"][number]>,
  receiver: Partial<ShureTelemetry["receivers"][number]> = {},
): ShureTelemetry {
  const shure = telemetryWith([{}]);
  return {
    ...shure,
    receivers: [
      ...shure.receivers,
      ...telemetryWith([{}, {}], {
        id: "ewdx-a",
        vendor: "sennheiser",
        name: "EW-DX rack",
        host: EWDX.host,
        model: "EWDX2CHDS",
        firmware: "4.1.2",
        detail: "Read-only SSCv2 telemetry is current.",
        capabilities: {
          antennaDiversity: false,
          linkQuality: true,
          interference: false,
          audioMeter: true,
          batteryHealth: true,
          transmitterDetail: true,
        },
      }).receivers.map((value) => ({
        ...value,
        channels: value.channels.map((base) => ({
          ...base,
          batteryBars: null,
          batteryCycleCount: null,
          batteryType: "Battery",
          antennas: [],
          rfLevelRaw: null,
          linkQualityRaw: null,
          linkQualityPercent: 92,
          interference: "unavailable" as const,
          audioLevelRaw: null,
          frequencyRaw: "550125",
          groupChannelRaw: null,
          transmitter: { type: "EW_DX_SKM", name: "LEAD", muted: false },
          ...(base.index === 1 ? channel : {}),
        })),
        ...receiver,
      })),
    ],
  };
}

function ewdxShowfile(): Showfile {
  const base = showfileWith();
  return {
    ...base,
    sennheiserReceivers: [EWDX],
    channels: [
      ...base.channels,
      {
        id: "ch-lead",
        inputIndex: 2,
        name: "Lead",
        shureReceiverId: "ewdx-a",
        shureChannelIndex: 1,
        monitor: { battery: true, rf: true, audio: true },
      },
    ],
  };
}

function run(telemetry: ShureTelemetry | null, showfile = ewdxShowfile()) {
  return evaluate({
    showfile,
    policy: DEFAULT_ALERT_POLICY,
    observation: observationAt(T0, levelsWith([-12, -30, -20]), telemetry),
    trackers: new Map(),
    nowMs: T0,
  });
}

describe("Live state for an EW-DX-bound channel", () => {
  it("reports RF, the receiver's own percent link quality, battery and transmitter", () => {
    const lead = run(ewdxTelemetry({})).channels.find(
      ({ id }) => id === "ch-lead",
    );
    expect(lead).toMatchObject({
      kind: "wireless",
      micType: "handheld",
      micTypeSource: "inferred",
      receiver: {
        id: "ewdx-a",
        name: "EW-DX rack",
        model: "EWDX2CHDS",
        channelIndex: 1,
        status: "ready",
        frequencyRaw: "550125",
      },
      rf: {
        availability: "observed",
        levelDbm: -58,
        linkQualityPercent: 92,
        activeAntenna: null,
        interference: "unavailable",
        transmitterPresent: true,
      },
      battery: {
        percent: 90,
        bars: null,
        runtimeMinutes: 270,
        type: "Battery",
      },
      transmitter: { type: "EW_DX_SKM", name: "LEAD", muted: false },
      statuses: { rf: "good", battery: "good" },
    });
  });

  it("raises link-quality, battery and mute alerts from EW-DX readings", () => {
    const result = run(
      ewdxTelemetry({
        linkQualityPercent: 10,
        batteryChargePercent: 5,
        transmitter: { type: "EW_DX_SK", name: "LEAD", muted: true },
      }),
    );
    const keys = result.conditions.map(({ key }) => key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "ch-lead:link-quality-low",
        "ch-lead:battery-critical",
        "ch-lead:tx-muted",
      ]),
    );
  });

  it("keeps the Shure channel unaffected next to an EW-DX receiver", () => {
    const result = run(ewdxTelemetry({}));
    expect(result.channels[0]).toMatchObject({
      id: "ch-marguerite",
      receiver: { id: "rack-a", model: "AD4Q" },
      rf: { linkQualityPercent: 100, activeAntenna: "A" },
    });
  });

  it("lists the EW-DX receiver as a unit and alerts when it goes offline", () => {
    const result = run(
      ewdxTelemetry(
        {},
        {
          status: "error",
          detail: "The receiver's third-party password was rejected.",
        },
      ),
    );
    expect(result.receivers.units.map(({ id }) => id)).toEqual([
      "rack-a",
      "ewdx-a",
    ]);
    expect(
      result.conditions.find(
        ({ key }) => key === "receiver:ewdx-a:receiver-offline",
      ),
    ).toMatchObject({
      severity: "caution",
      detail: expect.stringContaining("192.0.2.40"),
    });
  });

  it("names receivers neutrally when only EW-DX is configured", () => {
    const showfile = { ...ewdxShowfile(), shureReceivers: [] };
    const result = run(null, showfile);
    expect(result.receivers.units).toEqual([
      expect.objectContaining({ id: "ewdx-a", status: "stale" }),
    ]);
    const empty = run(null, {
      ...showfile,
      sennheiserReceivers: [],
      channels: [],
    });
    expect(empty.receivers.detail).not.toMatch(/Shure/);
  });
});

describe("production summary", () => {
  it("counts EW-DX receivers in the production's receiver count", async () => {
    const { server, response } = await put((initial) => ({
      ...inventory(initial),
      shureReceivers: [
        {
          id: "shure-a",
          name: "Shure",
          host: "192.0.2.10",
          model: "ULXD4D",
          channelCount: 2,
        },
      ],
    }));
    expect(response.statusCode).toBe(200);
    const list = (
      await server.inject({ method: "GET", url: "/api/v1/productions" })
    ).json();
    expect(list.productions[0]).toMatchObject({ receiverCount: 2 });
  });
});
