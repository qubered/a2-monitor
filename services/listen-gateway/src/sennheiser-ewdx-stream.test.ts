import { afterEach, describe, expect, it } from "vitest";
import {
  generateSimulatorCertificate,
  startEwdxSimulator,
  type EwdxSimulator,
  type EwdxSimulatorOptions,
} from "./dev/ewdx-simulator.js";
import { EwdxReceiverMonitor } from "./sennheiser-ewdx.js";
import { barrierScenarios } from "./sennheiser-ewdx-barriers.test-support.js";

// Synthetic loopback equipment only. Every receiver is the development
// simulator speaking the SSCv2 2.3 subscription protocol.
const PASSWORD = "synthetic-test-password";
const certificate = generateSimulatorCertificate();
const fast = {
  pollMs: 2_000,
  requestTimeoutMs: 400,
  initialBackoffMs: 50,
  maxBackoffMs: 200,
  livenessMs: 150,
  staleAfterMs: 1_000,
  streamRetryMs: 300,
};
const SUBSCRIPTIONS = "/api/ssc/state/subscriptions";

let simulators: EwdxSimulator[] = [];
let monitors: EwdxReceiverMonitor[] = [];
afterEach(async () => {
  for (const monitor of monitors) monitor.close();
  monitors = [];
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (const simulator of simulators) await simulator.close();
  simulators = [];
});

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: "ewdx-a",
    name: "EW-DX rack",
    host: "127.0.0.1",
    model: "EW-DX EM 2 Dante" as const,
    channelCount: 2 as const,
    tlsCertificateSha256: certificate.fingerprint256,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition not reached.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function startSimulator(options: EwdxSimulatorOptions = {}) {
  const simulator = await startEwdxSimulator({
    password: PASSWORD,
    certificate,
    ...options,
  });
  simulators.push(simulator);
  return simulator;
}

function startMonitor(
  simulator: EwdxSimulator,
  overrides = {},
  timing: Partial<typeof fast> = {},
) {
  const monitor = new EwdxReceiverMonitor(config(overrides), {
    password: PASSWORD,
    port: simulator.port,
    ...fast,
    ...timing,
  });
  monitors.push(monitor);
  monitor.start();
  return monitor;
}

// Live subscription only: the degraded fallback detail also mentions the
// word "subscription", so match the exact live wording.
const streaming = (monitor: EwdxReceiverMonitor) =>
  /SSCv2 subscription is live/.test(monitor.getState().detail) &&
  monitor.getState().status === "ready";
const resourceGets = (simulator: EwdxSimulator) =>
  simulator.requests.filter(
    ({ method, path }) =>
      method === "GET" && /^\/api\/(channel|rf|transmitters)\//.test(path),
  ).length;

describe("EW-DX SSCv2 subscription stream", () => {
  it("pushes an RSSI change into telemetry within 150 ms without polling", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === -58);
    const gets = resourceGets(simulator);
    const t0 = performance.now();
    simulator.setChannel(0, { rssiDbm: -81 });
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === -81);
    expect(performance.now() - t0).toBeLessThan(150);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(resourceGets(simulator)).toBe(gets);
  });

  it("pushes a discrete transmitter mute within 150 ms", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    await waitFor(
      () => monitor.getState().channels[1]?.transmitter.muted === false,
    );
    const t0 = performance.now();
    simulator.setChannel(1, { muted: true });
    await waitFor(
      () => monitor.getState().channels[1]?.transmitter.muted === true,
    );
    expect(performance.now() - t0).toBeLessThan(150);
  });

  it("checks identity first on the stream's own connection and sends nothing else on it", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    const open = simulator.requests.find(
      ({ method, path }) => method === "GET" && path === SUBSCRIPTIONS,
    )!;
    const onStream = simulator.requests.filter(
      ({ connection }) => connection === open.connection,
    );
    expect(onStream.map(({ path, authorized }) => [path, authorized])).toEqual([
      ["/api/device/identity", null],
      [SUBSCRIPTIONS, true],
    ]);
  });

  it("only ever writes to its own subscription session", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    monitor.close();
    await waitFor(() => simulator.sessions === 0);
    const writes = simulator.requests.filter(({ method }) => method !== "GET");
    expect(writes.length).toBeGreaterThan(0);
    for (const { path } of writes)
      expect(path).toMatch(/^\/api\/ssc\/state\/subscriptions\/[0-9a-f-]{36}$/);
  });

  it("reuses one session and cleans it up on close", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(simulator.sessions).toBe(1);
    expect(
      simulator.requests.filter(({ path }) => path === SUBSCRIPTIONS),
    ).toHaveLength(1);
    monitor.close();
    await waitFor(() => simulator.sessions === 0, 2_000);
  });

  it("reassembles fragmented, separately sent notifications", async () => {
    const simulator = await startSimulator({
      fragmentEvents: true,
      separateNotifications: true,
    });
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    simulator.setChannel(1, { rsqiPercent: 41, levelDbfs: -12 });
    await waitFor(
      () =>
        monitor.getState().channels[1]?.linkQualityPercent === 41 &&
        monitor.getState().channels[1]?.audioLevelDbfs === -12,
    );
  });

  it("lets a partial notification change only its own field", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    await waitFor(
      () => monitor.getState().channels[0]?.linkQualityPercent === 98,
    );
    // Out of the documented range: RSSI becomes unavailable, not clamped.
    simulator.setChannel(0, { rssiDbm: 12 });
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === null);
    simulator.setChannel(0, { rsqiPercent: 55 });
    await waitFor(
      () => monitor.getState().channels[0]?.linkQualityPercent === 55,
    );
    expect(monitor.getState().channels[0]?.rfLevelDbm).toBeNull();
  });

  it("stays current on a quiet stream while the session is confirmed, without re-dating values", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    const observedAt = monitor.getState().channels[0]?.observedAtUtc;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(monitor.getState()).toMatchObject({ status: "ready" });
    expect(monitor.getState().channels[0]).toMatchObject({
      availability: "observed",
      observedAtUtc: observedAt,
    });
    expect(
      simulator.requests.filter(
        ({ method, path }) =>
          method === "GET" && path.startsWith(`${SUBSCRIPTIONS}/`),
      ).length,
    ).toBeGreaterThan(3);
  });

  it("goes stale when the receiver stops answering, even with the stream socket open", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    simulator.setHung(true);
    await waitFor(() => monitor.getState().status === "stale", 3_000);
    expect(monitor.getState().channels[0]?.availability).toBe("stale");
  });

  it("reconnects through identity when the receiver ends its sessions", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    const before = simulator.requests.length;
    simulator.terminateSessions();
    await waitFor(() => simulator.sessions === 1 && streaming(monitor));
    const again = simulator.requests
      .slice(before)
      .find(({ path }) => path === SUBSCRIPTIONS)!;
    const first = simulator.requests.find(
      ({ connection }) => connection === again.connection,
    );
    expect(first).toMatchObject({
      path: "/api/device/identity",
      authorized: null,
    });
    simulator.setChannel(0, { rssiDbm: -77 });
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === -77);
  });

  it("never publishes a replacement chassis's stream before rechecking identity", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    const published: ReturnType<typeof monitor.getState>[] = [];
    simulator.onRequest(() => published.push(monitor.getState()));
    simulator.swapChassis({
      afterRequests: "idle",
      serial: "5000000005",
      transmitterType: "EW_DX_TS_5_PIN",
    });
    await waitFor(() =>
      monitor.getState().detail.includes("different receiver"),
    );
    await waitFor(
      () =>
        monitor.getState().channels[0]?.transmitter.type === "EW_DX_TS_5_PIN",
    );
    expect(
      published.filter(
        (state) =>
          state.channels[0]?.transmitter.type === "EW_DX_TS_5_PIN" &&
          !state.detail.includes("different receiver"),
      ),
    ).toEqual([]);
  });
});

describe("EW-DX subscription refusals fall back to a bounded, labelled poll", () => {
  const polling = (monitor: EwdxReceiverMonitor) =>
    monitor.getState().status === "ready" &&
    /polling, 2 s between sweeps/i.test(monitor.getState().detail);

  it.each([
    ["the receiver has no subscription support", { subscriptions: false }],
    ["the receiver has no free session", { maxSessions: 0 }],
    [
      "a resource is refused",
      { refuseResources: ["/api/transmitters/1/battery"] },
    ],
    [
      "Content-Location points elsewhere",
      {
        contentLocation: () =>
          "https://203.0.113.9/api/ssc/state/subscriptions/x",
      },
    ],
    [
      "the open event names another session",
      {
        openEventData: () =>
          JSON.stringify({
            path: `${SUBSCRIPTIONS}/00000000-0000-0000-0000-000000000000`,
            sessionUUID: "00000000-0000-0000-0000-000000000000",
          }),
      },
    ],
  ])("when %s", async (_label, options) => {
    const simulator = await startSimulator(options as EwdxSimulatorOptions);
    const monitor = startMonitor(simulator);
    await waitFor(() => polling(monitor));
    expect(monitor.getState().channels[0]?.availability).toBe("observed");
    // Never follows or writes anywhere but its own validated session.
    for (const { method, path } of simulator.requests.filter(
      ({ method }) => method !== "GET",
    ))
      expect([method, path]).toEqual([
        method,
        expect.stringMatching(
          /^\/api\/ssc\/state\/subscriptions\/[0-9a-f-]{36}$/,
        ),
      ]);
    // Bounded: at most one full sweep every 2 s, not a rapid loop.
    const gets = resourceGets(simulator);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(resourceGets(simulator) - gets).toBeLessThanOrEqual(18);
  });

  it("coexists with another client holding the only session", async () => {
    const simulator = await startSimulator({ maxSessions: 1 });
    const first = startMonitor(simulator, { id: "ewdx-1" });
    await waitFor(() => streaming(first));
    const second = startMonitor(simulator, { id: "ewdx-2" });
    await waitFor(() => polling(second));
    expect(streaming(first)).toBe(true);
    simulator.setChannel(0, { rssiDbm: -70 });
    await waitFor(() => first.getState().channels[0]?.rfLevelDbm === -70);
  });
});

describe("EW-DX stream freshness and generations", () => {
  it("does not call a reopened session ready before its own initial values arrive", async () => {
    const simulator = await startSimulator({ initialNotificationDelayMs: 800 });
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor), 6_000);
    simulator.terminateSessions();
    await waitFor(() => monitor.getState().status === "stale");
    await waitFor(() => simulator.sessions === 1);
    const statuses: string[] = [];
    const sampler = setInterval(
      () => statuses.push(monitor.getState().status),
      10,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    clearInterval(sampler);
    expect(statuses).not.toContain("ready");
    await waitFor(() => streaming(monitor), 3_000);
  });

  it("follows a transmitter switched off and on through notifications", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    await waitFor(
      () => monitor.getState().channels[1]?.linkStatus === "active",
    );
    simulator.setLinked(1, false);
    await waitFor(
      () => monitor.getState().channels[1]?.linkStatus === "no-transmitter",
    );
    expect(monitor.getState().channels[1]).toMatchObject({
      batteryChargePercent: null,
      transmitter: { muted: null },
    });
    simulator.setLinked(1, true);
    await waitFor(
      () => monitor.getState().channels[1]?.linkStatus === "active",
    );
  });

  it("applies only subscribed keys and ignores other notification content", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === -58);
    simulator.injectEvent('data: ["not","an","object"]\n\n');
    simulator.injectEvent("data: {not json\n\n");
    simulator.injectEvent(
      `data: ${JSON.stringify({
        "/api/device/site": { deviceName: "X" },
        "/api/channel/9/signalStrengthIndicator": { value: -10 },
        "/api/channel/0/signalStrengthIndicator": { value: -71 },
        "/api/channel/1/signalQualityIndicator": { value: 33 },
      })}\n\n`,
    );
    await waitFor(
      () =>
        monitor.getState().channels[0]?.rfLevelDbm === -71 &&
        monitor.getState().channels[1]?.linkQualityPercent === 33,
    );
    expect(streaming(monitor)).toBe(true);
  });

  it("drops a stream that sends an oversized event and reopens a fresh session", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    const opens = () =>
      simulator.requests.filter(({ path }) => path === SUBSCRIPTIONS).length;
    simulator.injectEvent(`data: ${"x".repeat(300 * 1024)}\n\n`);
    await waitFor(() => opens() === 2 && streaming(monitor), 4_000);
    expect(simulator.sessions).toBe(1);
  });
});

describe("EW-DX notifications that carry nothing valid", () => {
  it("make that field unknown without counting as a new observation", async () => {
    const simulator = await startSimulator();
    const monitor = startMonitor(simulator, {}, { livenessMs: 60_000 });
    await waitFor(() => streaming(monitor));
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === -58);
    const observedAt = monitor.getState().channels[0]?.observedAtUtc;
    await new Promise((resolve) => setTimeout(resolve, 20));
    simulator.injectEvent(
      `data: ${JSON.stringify({
        "/api/channel/0/signalStrengthIndicator": { value: "not a number" },
      })}\n\n`,
    );
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === null);
    expect(monitor.getState().channels[0]?.observedAtUtc).toBe(observedAt);
  });
});

describe("EW-DX subscription robustness", () => {
  it("accepts the bare session id the EW-DX OpenAPI shows as Content-Location", async () => {
    const simulator = await startSimulator({ contentLocation: (uuid) => uuid });
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    simulator.setChannel(0, { rssiDbm: -79 });
    await waitFor(() => monitor.getState().channels[0]?.rfLevelDbm === -79);
  });

  it("never holds two sessions when a stream ends while a liveness check is in flight", async () => {
    const simulator = await startSimulator({ sessionStatusDelayMs: 200 });
    const monitor = startMonitor(simulator);
    await waitFor(() => streaming(monitor));
    for (let round = 0; round < 6; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      simulator.terminateSessions();
      await waitFor(() => streaming(monitor), 5_000);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(simulator.peakSessions).toBe(1);
    expect(simulator.sessions).toBe(1);
  });

  it("backs off and falls back when the receiver keeps closing new sessions", async () => {
    const simulator = await startSimulator({ closeAfterSubscribe: true });
    const monitor = startMonitor(simulator);
    await waitFor(
      () => /keeps closing/i.test(monitor.getState().detail),
      5_000,
    );
    const opens = () =>
      simulator.requests.filter(({ path }) => path === SUBSCRIPTIONS).length;
    const count = opens();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(opens()).toBe(count);
    expect(count).toBeLessThanOrEqual(4);
    expect(monitor.getState().status).toBe("ready");
  });

  it("names the refused resource from the spec's 400 refusal", async () => {
    const simulator = await startSimulator({
      refuseResources: ["/api/channel/1/level"],
      refusalStatus: 400,
    });
    const monitor = startMonitor(simulator);
    await waitFor(() =>
      /\/api\/channel\/1\/level/.test(monitor.getState().detail),
    );
  });
});

describe("EW-DX exact interleavings", () => {
  barrierScenarios(EwdxReceiverMonitor);
});
