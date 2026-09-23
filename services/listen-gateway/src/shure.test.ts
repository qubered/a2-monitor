import { createServer, type AddressInfo, type Socket } from "node:net";
import type { Showfile } from "@rvlt/pulse-protocol/http";
import { describe, expect, it } from "vitest";
import {
  applyChannelProperty,
  AXIENT_COMMANDS,
  QLXD_COMMANDS,
  ShureFleetMonitor,
  ShureFrameParser,
  SLXD_COMMANDS,
  TELEMETRY_REFRESH_MS,
  ULXD_COMMANDS,
} from "./shure.js";
import { startShureSimulator } from "./dev/shure-simulator.js";

describe("ShureFrameParser", () => {
  it("accepts fragmented and coalesced read-only receiver reports", () => {
    const parser = new ShureFrameParser();
    expect(parser.push("noise< REP 1 BATT_")).toEqual([]);
    expect(
      parser.push("BARS 004 >< REP MODEL {ULXD4D} >< REP FW_VER 2.7.10 >"),
    ).toEqual([
      { channelIndex: 0, property: "BATT_BARS", value: "004" },
      { property: "MODEL", value: "ULXD4D" },
      { property: "FW_VER", value: "2.7.10" },
    ]);
  });

  it("ignores malformed and invalid-channel reports", () => {
    const parser = new ShureFrameParser();
    expect(
      parser.push("< SET 1 BATT_BARS 005 >< REP 0 BATT_BARS 005 >"),
    ).toEqual([]);
  });
});

type Channel = NonNullable<ReturnType<typeof applyChannelProperty>>;

function baseChannel(): Channel {
  return {
    index: 0,
    linkStatus: "unavailable",
    batteryBars: null,
    batteryChargePercent: null,
    batteryType: null,
    batteryCycleCount: null,
    batteryRunTimeMinutes: null,
    antennas: [
      { label: "A", active: null },
      { label: "B", active: null },
    ],
    rfLevelDbm: null,
    rfLevelRaw: null,
    linkQualityRaw: null,
    interference: "unavailable",
    audioLevelDbfs: null,
    audioLevelRaw: null,
    frequencyRaw: null,
    groupChannelRaw: null,
    transmitter: { type: null, name: null, muted: null },
    warnings: [],
    observedAtUtc: null,
    availability: "unavailable",
  };
}

describe("applyChannelProperty", () => {
  it("converts Axient Digital RSSI and audio peak to dBm/dBFS using the documented offsets", () => {
    const channel = baseChannel();
    const withRf = applyChannelProperty(
      channel,
      AXIENT_COMMANDS,
      "RSSI",
      "062",
    );
    expect(withRf).toMatchObject({ rfLevelRaw: 62, rfLevelDbm: -58 });

    const withAudio = applyChannelProperty(
      channel,
      AXIENT_COMMANDS,
      "AUDIO_LEVEL_PEAK",
      "034",
    );
    expect(withAudio).toMatchObject({ audioLevelRaw: 34, audioLevelDbfs: -86 });
  });

  it("parses Axient Digital antenna letter states onto A/B labels", () => {
    const updated = applyChannelProperty(
      baseChannel(),
      AXIENT_COMMANDS,
      "ANTENNA_STATUS",
      "BR",
    );
    expect(updated?.antennas).toEqual([
      { label: "A", active: true },
      { label: "B", active: false },
    ]);
  });

  it("parses ULX-D RF_ANTENNA pair states and RF_INT_DET", () => {
    const withAntenna = applyChannelProperty(
      baseChannel(),
      ULXD_COMMANDS,
      "RF_ANTENNA",
      "AX",
    );
    expect(withAntenna?.antennas).toEqual([
      { label: "A", active: true },
      { label: "B", active: false },
    ]);

    const withInterference = applyChannelProperty(
      baseChannel(),
      ULXD_COMMANDS,
      "RF_INT_DET",
      "CRITICAL",
    );
    expect(withInterference?.interference).toBe("detected");
  });

  it("leaves QLX-D RF level unavailable since no scalar GET is documented", () => {
    const updated = applyChannelProperty(
      baseChannel(),
      QLXD_COMMANDS,
      "AUDIO_LVL",
      "030",
    );
    expect(updated).toMatchObject({ audioLevelRaw: 30, audioLevelDbfs: null });
  });

  it("parses SLX-D transmitter battery and mute state", () => {
    const withBattery = applyChannelProperty(
      baseChannel(),
      SLXD_COMMANDS,
      "TX_BATT_BARS",
      "3",
    );
    expect(withBattery?.batteryBars).toBe(3);

    const withMute = applyChannelProperty(
      baseChannel(),
      SLXD_COMMANDS,
      "TX_MUTE_STATUS",
      "ON",
    );
    expect(withMute?.transmitter.muted).toBe(true);
  });

  it("ignores properties that do not belong to the receiver's family", () => {
    expect(
      applyChannelProperty(baseChannel(), QLXD_COMMANDS, "RSSI", "062"),
    ).toBeNull();
  });

  it("rejects out-of-range and non-numeric values instead of fabricating a reading", () => {
    const updated = applyChannelProperty(
      baseChannel(),
      AXIENT_COMMANDS,
      "RSSI",
      "not-a-number",
    );
    expect(updated).toMatchObject({ rfLevelRaw: null, rfLevelDbm: null });
  });
});

describe("ShureFleetMonitor telemetry refresh", () => {
  it(
    "keeps re-polling a ULX-D channel after the initial connect burst, instead of going quiet until it hits STALE_AFTER_MS",
    async () => {
      // A fake receiver on an ephemeral port exercises the real TCP path
      // without colliding with anything already holding 2202.
      let received = "";
      const server = createServer((socket: Socket) => {
        socket.on("data", (chunk) => {
          received += chunk.toString();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;

      const showfile: Showfile = {
        schemaVersion: "0",
        revision: 0,
        updatedAtUtc: null,
        show: { name: "Test" },
        device: null,
        shureReceivers: [
          {
            id: "r1",
            name: "ULXD",
            host: "127.0.0.1",
            model: "ULXD4",
            channelCount: 1,
          },
        ],
        channels: [],
      };

      const monitor = new ShureFleetMonitor({
        backendOrigin: "http://showfile.invalid/",
        port,
        fetch: (async () =>
          new Response(JSON.stringify(showfile), {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
      });

      try {
        monitor.start();
        // Let the initial connect burst land, then count how many times the
        // meter subscription has been (re-)issued across one refresh tick.
        await new Promise((resolve) => setTimeout(resolve, 200));
        const afterConnect = received.split("METER_RATE").length - 1;
        expect(afterConnect).toBeGreaterThan(0);

        await new Promise((resolve) =>
          setTimeout(resolve, TELEMETRY_REFRESH_MS + 500),
        );
        const afterRefresh = received.split("METER_RATE").length - 1;
        expect(afterRefresh).toBeGreaterThan(afterConnect);
      } finally {
        monitor.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    TELEMETRY_REFRESH_MS + 5_000,
  );
});

describe("ShureFleetMonitor against the development AD4Q simulator", () => {
  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 3_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Condition not reached.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("normalizes a transmitter that disappears into an explicit no-transmitter state", async () => {
    let offsetMs = 0;
    const simulator = await startShureSimulator(
      "127.0.0.1",
      0,
      () => Date.now() + offsetMs,
    );
    const { port } = simulator.address() as AddressInfo;
    const showfile: Showfile = {
      schemaVersion: "0",
      revision: 1,
      updatedAtUtc: null,
      show: { name: "Test" },
      device: null,
      shureReceivers: [
        {
          id: "sim",
          name: "Simulated rack",
          host: "127.0.0.1",
          model: "AD4Q",
          channelCount: 4,
        },
      ],
      channels: [],
    };
    const monitor = new ShureFleetMonitor({
      backendOrigin: "http://showfile.invalid/",
      port,
      fetch: (async () =>
        new Response(JSON.stringify(showfile), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    const host = () => monitor.getState().receivers[0]?.channels[3];

    try {
      monitor.start();
      await waitFor(() => host()?.transmitter.type === "ADX1");
      expect(monitor.getState().receivers[0]).toMatchObject({
        model: "AD4Q",
        status: "ready",
      });
      expect(host()).toMatchObject({
        linkStatus: "active",
        availability: "observed",
        transmitter: { name: "HOST", muted: false },
      });

      offsetMs = 65_000;
      await waitFor(() => host()?.linkStatus === "no-transmitter");
      expect(host()).toMatchObject({
        transmitter: { type: null },
        batteryChargePercent: null,
        batteryBars: null,
        batteryRunTimeMinutes: null,
        batteryCycleCount: null,
      });
    } finally {
      monitor.close();
      await new Promise<void>((resolve) => simulator.close(() => resolve()));
    }
  }, 10_000);
});
