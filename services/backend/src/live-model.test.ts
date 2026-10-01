import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_POLICY } from "./alert-policy.js";
import {
  evaluate,
  resetChannelTracker,
  type ChannelTracker,
} from "./live-model.js";
import {
  levelsWith,
  observationAt,
  showfileWith,
  telemetryWith,
} from "./monitoring.test-support.js";
import type { NodeObservation } from "./node-observer.js";
import type { Showfile } from "@rvlt/pulse-protocol/http";

const T0 = Date.parse("2026-09-23T01:00:00Z");

function run(
  observation: NodeObservation,
  options: {
    showfile?: Showfile;
    trackers?: Map<string, ChannelTracker>;
    nowMs?: number;
  } = {},
) {
  return evaluate({
    showfile: options.showfile ?? showfileWith(),
    policy: DEFAULT_ALERT_POLICY,
    observation,
    trackers: options.trackers ?? new Map(),
    nowMs: options.nowMs ?? T0,
  });
}

function kinds(result: ReturnType<typeof run>) {
  return result.conditions.map(({ key, severity }) => `${key}/${severity}`);
}

describe("evaluate", () => {
  it("publishes each channel's monitor trim, 0 when the showfile sets none", () => {
    const base = showfileWith();
    const result = run(
      observationAt(T0, levelsWith([-12, -30]), telemetryWith([{}])),
      {
        showfile: {
          ...base,
          channels: base.channels.map((channel, index) =>
            index === 0 ? { ...channel, trimDb: -4.5 } : channel,
          ),
        },
      },
    );
    expect(result.channels.map(({ trimDb }) => trimDb)).toEqual([-4.5, 0]);
  });

  it("passes the node's lost-audio counts through to the live state", () => {
    const reported = run(
      observationAt(
        T0,
        levelsWith([-12, -30], { dropouts: { callbacks: 3, blocks: 1 } }),
        telemetryWith([{}]),
      ),
    );
    expect(reported.node.dropouts).toEqual({ callbacks: 3, blocks: 1 });
    // A node that does not report them says nothing, rather than zero.
    const silent = run(
      observationAt(T0, levelsWith([-12, -30]), telemetryWith([{}])),
    );
    expect(silent.node.dropouts).toBeUndefined();
  });

  it("maps healthy observations onto honest verdicts and raises nothing", () => {
    const result = run(
      observationAt(
        T0,
        levelsWith([-12, -30, null, null]),
        telemetryWith([{}]),
      ),
    );

    expect(result.node).toMatchObject({
      status: "ready",
      device: { name: "USB Interface" },
    });
    expect(result.receivers.status).toBe("ready");
    const [marguerite, talkback] = result.channels;
    expect(marguerite).toMatchObject({
      id: "ch-marguerite",
      number: 1,
      name: "Marguerite",
      performer: "Eleanor Vance",
      kind: "wireless",
      input: { index: 0, label: "USB Interface · input 1" },
      receiver: {
        id: "rack-a",
        name: "Stage left",
        channelIndex: 0,
        status: "ready",
      },
      statuses: {
        rf: "good",
        audio: "good",
        battery: "good",
        check: "unknown",
      },
      audio: { availability: "observed", peakDbfs: -12, silentForMs: 0 },
      rf: {
        levelDbm: -58,
        linkQualityPercent: 100,
        activeAntenna: "A",
        transmitterPresent: true,
      },
      battery: { percent: 90, bars: 5, runtimeMinutes: 270 },
    });
    expect(talkback).toMatchObject({
      kind: "wired",
      receiver: null,
      statuses: {
        rf: "not-applicable",
        battery: "not-applicable",
        audio: "good",
      },
    });
    expect(result.conditions).toEqual([]);
  });

  it("infers micType from the transmitter model only while the operator hasn't set one", () => {
    const base = showfileWith();
    const unset = {
      ...base,
      channels: base.channels.map((channel, index) =>
        index === 0 ? { ...channel, micType: null } : channel,
      ),
    };

    const inferred = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([
          { transmitter: { type: "AD2", name: null, muted: null } },
        ]),
      ),
      { showfile: unset },
    );
    expect(inferred.channels[0]).toMatchObject({
      micType: "handheld",
      micTypeSource: "inferred",
    });

    const beltpack = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([
          { transmitter: { type: "AD1", name: null, muted: null } },
        ]),
      ),
      { showfile: unset },
    );
    expect(beltpack.channels[0]).toMatchObject({
      micType: "beltpack",
      micTypeSource: "inferred",
    });

    const operatorSet = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([
          { transmitter: { type: "AD1", name: null, muted: null } },
        ]),
      ),
      { showfile: base },
    );
    expect(operatorSet.channels[0]).toMatchObject({
      micType: "headset",
      micTypeSource: "operator",
    });
  });

  it("blanks the inferred mic icon on reset until a transmitter is seen again", () => {
    const base = showfileWith();
    const unset = {
      ...base,
      channels: base.channels.map((channel, index) =>
        index === 0 ? { ...channel, micType: null } : channel,
      ),
    };
    const trackers = new Map<string, ChannelTracker>();
    const observe = (
      type: string | null,
      linkStatus: "active" | "no-transmitter",
    ) =>
      run(
        observationAt(
          T0,
          levelsWith([-12, -30]),
          telemetryWith([
            { linkStatus, transmitter: { type, name: null, muted: null } },
          ]),
        ),
        { showfile: unset, trackers },
      ).channels[0];

    expect(observe("AD2", "active")).toMatchObject({ micType: "handheld" });
    resetChannelTracker(trackers, "ch-marguerite");
    // The receiver still remembers the old transmitter model.
    expect(observe("AD2", "no-transmitter")).toMatchObject({
      micType: null,
      micTypeSource: null,
    });
    expect(observe("AD1", "active")).toMatchObject({
      micType: "beltpack",
      micTypeSource: "inferred",
    });
  });

  it("escalates battery from caution to critical at the policy limits", () => {
    const low = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([{ batteryChargePercent: 22 }]),
      ),
    );
    expect(low.channels[0]?.statuses.battery).toBe("caution");
    expect(kinds(low)).toEqual(["ch-marguerite:battery-low/caution"]);
    expect(low.conditions[0]?.detail).toBe(
      "Battery 22 % on Stage left channel 1. Caution at 25 %. About 270 min remaining.",
    );

    const critical = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([{ batteryChargePercent: 8 }]),
      ),
    );
    expect(critical.channels[0]?.statuses.battery).toBe("fault");
    expect(kinds(critical)).toEqual([
      "ch-marguerite:battery-critical/critical",
    ]);
  });

  it("falls back to battery bars when the receiver reports no percentage", () => {
    const result = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([
          {
            batteryChargePercent: null,
            batteryBars: 0,
            batteryRunTimeMinutes: null,
          },
        ]),
      ),
    );
    expect(kinds(result)).toEqual(["ch-marguerite:battery-critical/critical"]);
    expect(result.conditions[0]?.detail).toBe(
      "Battery 0 of 5 bars on Stage left channel 1.",
    );
  });

  it("keeps RF level and link quality as separate findings", () => {
    const result = run(
      observationAt(
        T0,
        levelsWith([-12, -30]),
        telemetryWith([
          { rfLevelDbm: -91, linkQualityRaw: 2, interference: "detected" },
        ]),
      ),
    );
    expect(result.channels[0]?.statuses.rf).toBe("fault");
    expect(result.channels[0]?.rf).toMatchObject({
      levelDbm: -91,
      linkQualityPercent: 40,
    });
    expect(kinds(result)).toEqual([
      "ch-marguerite:rf-low/critical",
      "ch-marguerite:link-quality-low/caution",
      "ch-marguerite:interference/caution",
    ]);
    expect(result.conditions[0]?.detail).toBe(
      "RF −91 dBm on Stage left channel 1. Critical at −90 dBm.",
    );
  });

  it("raises RF lost only for a transmitter that was seen and then disappeared", () => {
    const trackers = new Map<string, ChannelTracker>();
    const absent = {
      linkStatus: "no-transmitter" as const,
      transmitter: { type: null, name: null, muted: null },
      rfLevelDbm: -120,
      batteryChargePercent: null,
      batteryBars: null,
    };

    const neverSeen = run(
      observationAt(T0, levelsWith([-12, -30]), telemetryWith([absent])),
      { trackers },
    );
    expect(neverSeen.channels[0]?.statuses.rf).toBe("caution");
    expect(neverSeen.channels[0]?.statuses.battery).toBe("unknown");
    expect(neverSeen.conditions).toEqual([]);

    run(
      observationAt(T0 + 1_000, levelsWith([-12, -30]), telemetryWith([{}])),
      { trackers, nowMs: T0 + 1_000 },
    );
    const lost = run(
      observationAt(
        T0 + 2_000,
        levelsWith([-12, -30]),
        telemetryWith([absent]),
      ),
      { trackers, nowMs: T0 + 2_000 },
    );
    expect(lost.channels[0]?.statuses.rf).toBe("fault");
    expect(kinds(lost)).toEqual(["ch-marguerite:rf-lost/critical"]);
    expect(lost.conditions[0]?.detail).toBe(
      "Transmitter not detected on Stage left channel 1.",
    );
  });

  it("counts silence below the floor and raises no-audio at the policy limit", () => {
    const trackers = new Map<string, ChannelTracker>();
    const at = (seconds: number, talkbackPeak: number) =>
      run(
        observationAt(
          T0 + seconds * 1000,
          levelsWith([-12, talkbackPeak]),
          telemetryWith([{}]),
        ),
        {
          trackers,
          nowMs: T0 + seconds * 1000,
        },
      );

    at(0, -40);
    let result = at(1, -95);
    for (let second = 2; second <= 29; second += 1) result = at(second, -95);
    expect(result.channels[1]?.audio.silentForMs).toBe(29_000);
    expect(result.channels[1]?.statuses.audio).toBe("good");
    expect(result.conditions).toEqual([]);

    const silent = at(30, -95);
    expect(silent.channels[1]?.statuses.audio).toBe("fault");
    expect(kinds(silent)).toEqual(["ch-talkback:no-audio/critical"]);
    expect(silent.conditions[0]?.detail).toBe(
      "No audio above −70 dBFS for 30 s on USB Interface · input 2.",
    );

    const back = at(31, -35);
    expect(back.channels[1]?.audio.silentForMs).toBe(0);
    expect(back.conditions).toEqual([]);
  });

  it("does not raise no-audio on a channel that has not been heard since start", () => {
    const trackers = new Map<string, ChannelTracker>();
    const at = (seconds: number, talkbackPeak: number) =>
      run(
        observationAt(
          T0 + seconds * 1000,
          levelsWith([-12, talkbackPeak]),
          telemetryWith([{}]),
        ),
        { trackers, nowMs: T0 + seconds * 1000 },
      );

    let result = at(0, -120);
    for (let second = 1; second <= 120; second += 1) result = at(second, -120);
    expect(result.channels[1]?.audio.silentForMs).toBe(120_000);
    expect(result.channels[1]?.statuses.audio).toBe("unknown");
    expect(result.conditions).toEqual([]);

    // First signal arms it; the timeout then counts from the last signal.
    at(121, -35);
    for (let second = 122; second <= 150; second += 1)
      result = at(second, -120);
    expect(result.channels[1]?.statuses.audio).toBe("good");
    expect(result.conditions).toEqual([]);
    const silent = at(151, -120);
    expect(kinds(silent)).toEqual(["ch-talkback:no-audio/critical"]);
  });

  it("stays armed for no-audio after repatching a channel that was heard", () => {
    const trackers = new Map<string, ChannelTracker>();
    run(observationAt(T0, levelsWith([-12, -35]), telemetryWith([{}])), {
      trackers,
    });
    const tracker = trackers.get("ch-talkback")!;
    expect(tracker.heard).toBe(true);
    // Simulate a repatch: silence timing restarts, but the channel stays heard.
    tracker.inputKey = "another-device#0";
    let result = run(
      observationAt(T0 + 1_000, levelsWith([-12, -120]), telemetryWith([{}])),
      { trackers, nowMs: T0 + 1_000 },
    );
    for (let second = 2; second <= 31; second += 1)
      result = run(
        observationAt(
          T0 + second * 1000,
          levelsWith([-12, -120]),
          telemetryWith([{}]),
        ),
        { trackers, nowMs: T0 + second * 1000 },
      );
    expect(kinds(result)).toEqual(["ch-talkback:no-audio/critical"]);
  });

  it("does not judge silence on a channel whose audio monitoring is off", () => {
    const base = showfileWith();
    const showfile: Showfile = {
      ...base,
      channels: base.channels.map((channel) =>
        channel.id === "ch-talkback"
          ? { ...channel, monitor: { battery: true, rf: true, audio: false } }
          : channel,
      ),
    };
    const trackers = new Map<string, ChannelTracker>();
    run(observationAt(T0, levelsWith([-12, -120]), telemetryWith([{}])), {
      showfile,
      trackers,
    });
    const later = run(
      observationAt(T0 + 120_000, levelsWith([-12, -120]), telemetryWith([{}])),
      {
        showfile,
        trackers,
        nowMs: T0 + 120_000,
      },
    );
    expect(later.channels[1]?.statuses.audio).toBe("unknown");
    expect(later.conditions).toEqual([]);
  });

  it("restarts silence timing after an observation gap instead of counting through it", () => {
    const trackers = new Map<string, ChannelTracker>();
    run(observationAt(T0, levelsWith([-12, -120]), telemetryWith([{}])), {
      trackers,
    });
    const resumed = run(
      observationAt(T0 + 60_000, levelsWith([-12, -120]), telemetryWith([{}])),
      {
        trackers,
        nowMs: T0 + 60_000,
      },
    );
    expect(resumed.channels[1]?.audio.silentForMs).toBe(0);
    expect(resumed.conditions).toEqual([]);
  });

  it("flags clipping as caution unless clip alerts are disabled", () => {
    const observation = observationAt(
      T0,
      levelsWith([0, -30], {}, [120, 0]),
      telemetryWith([{}]),
    );
    const result = run(observation);
    expect(result.channels[0]?.statuses.audio).toBe("caution");
    expect(kinds(result)).toEqual(["ch-marguerite:clipping/caution"]);

    const quiet = evaluate({
      showfile: showfileWith(),
      policy: { ...DEFAULT_ALERT_POLICY, clipAlerts: false },
      observation,
      trackers: new Map(),
      nowMs: T0,
    });
    expect(quiet.conditions).toEqual([]);
    expect(quiet.channels[0]?.statuses.audio).toBe("good");
  });

  it("does not judge a transmitter mute on a channel whose audio monitoring is off", () => {
    const base = showfileWith();
    const showfile: Showfile = {
      ...base,
      channels: [
        {
          ...base.channels[0]!,
          monitor: { battery: true, rf: true, audio: false },
        },
      ],
    };
    const result = run(
      observationAt(
        T0,
        levelsWith([-120]),
        telemetryWith([
          { transmitter: { type: "AD2", name: "M", muted: true } },
        ]),
      ),
      { showfile },
    );
    expect(result.channels[0]?.statuses.audio).toBe("unknown");
    expect(result.conditions).toEqual([]);
  });

  it("reports a transmitter mute as an audio caution", () => {
    const result = run(
      observationAt(
        T0,
        levelsWith([-120, -30]),
        telemetryWith([
          { transmitter: { type: "AD2", name: "M", muted: true } },
        ]),
      ),
    );
    expect(result.channels[0]?.statuses.audio).toBe("caution");
    expect(kinds(result)).toEqual(["ch-marguerite:tx-muted/caution"]);
  });

  it("refuses to trust a patch made on a different audio device", () => {
    const result = run(
      observationAt(
        T0,
        levelsWith([-12, -30], {
          device: {
            ...levelsWith([]).capture.device!,
            name: "Other Interface",
          },
        }),
        telemetryWith([{}]),
      ),
    );
    expect(result.channels[0]?.input).toEqual({
      index: null,
      label: "Input 1 was patched on USB Interface, not Other Interface",
    });
    expect(result.channels[0]?.audio.availability).toBe("unknown");
    expect(result.channels[0]?.statuses.audio).toBe("unknown");
  });

  it("marks everything unknown and raises node-unreachable when the node stops answering", () => {
    const observation: NodeObservation = {
      ...observationAt(T0, levelsWith([-12, -30]), telemetryWith([{}])),
      levelsAtMs: T0 - 10_000,
      shureAtMs: T0 - 10_000,
    };
    const result = run(observation);
    expect(result.node).toMatchObject({
      status: "unreachable",
      detail: "The audio node has not answered for 10 s.",
      device: null,
    });
    expect(result.receivers.status).toBe("unavailable");
    expect(result.channels[0]?.statuses).toEqual({
      rf: "unknown",
      audio: "unknown",
      battery: "unknown",
      check: "unknown",
    });
    expect(kinds(result)).toEqual(["system:node-unreachable/critical"]);
  });

  it("raises capture-error and receiver-offline as system alerts", () => {
    const result = run(
      observationAt(
        T0,
        levelsWith([], {
          status: "error",
          detail:
            "Capture process exited (1). Retrying the same device in 2 s.",
          device: null,
        }),
        telemetryWith([{ availability: "stale" }], {
          status: "stale",
          detail: "Receiver disconnected; retained telemetry is stale.",
        }),
      ),
    );
    expect(kinds(result)).toEqual([
      "system:capture-error/critical",
      "receiver:rack-a:receiver-offline/caution",
    ]);
    expect(result.conditions[1]?.detail).toBe(
      "Stage left (192.0.2.10): Receiver disconnected; retained telemetry is stale.",
    );
    expect(result.channels[0]?.rf.availability).toBe("stale");
    expect(result.channels[0]?.statuses.rf).toBe("unknown");
  });

  it("disarms each dimension independently through the channel monitor flags", () => {
    const base = showfileWith();
    const showfile: Showfile = {
      ...base,
      channels: [
        {
          ...base.channels[0]!,
          monitor: { battery: false, rf: false, audio: true },
        },
      ],
    };
    const result = run(
      observationAt(
        T0,
        levelsWith([-12]),
        telemetryWith([{ batteryChargePercent: 5, rfLevelDbm: -95 }]),
      ),
      { showfile },
    );
    expect(result.channels[0]?.statuses).toMatchObject({
      rf: "unknown",
      battery: "unknown",
    });
    expect(result.conditions).toEqual([]);
  });
});
