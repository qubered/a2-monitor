import { afterEach, describe, expect, it } from "vitest";
import {
  generateSimulatorCertificate,
  startEwdxSimulator,
  type EwdxSimulator,
} from "./dev/ewdx-simulator.js";
import {
  EwdxReceiverMonitor,
  SennheiserFleetMonitor,
} from "./sennheiser-ewdx.js";

// Synthetic loopback equipment only: every receiver here is the development
// simulator on 127.0.0.1 with a throwaway self-signed certificate.
const PASSWORD = "synthetic-test-password";
const certificate = generateSimulatorCertificate();
const fast = {
  pollMs: 100,
  requestTimeoutMs: 300,
  initialBackoffMs: 50,
  maxBackoffMs: 200,
  livenessMs: 150,
};

let simulator: EwdxSimulator | undefined;
let monitor: { close(): void } | undefined;

afterEach(async () => {
  monitor?.close();
  monitor = undefined;
  await simulator?.close();
  simulator = undefined;
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function start(
  simulatorOptions: Parameters<typeof startEwdxSimulator>[0] = {},
  configOverrides: Record<string, unknown> = {},
  password: string | null = PASSWORD,
) {
  simulator = await startEwdxSimulator({
    password: PASSWORD,
    certificate,
    ...simulatorOptions,
  });
  const receiver = new EwdxReceiverMonitor(config(configOverrides), {
    password,
    port: simulator.port,
    ...fast,
  });
  monitor = receiver;
  receiver.start();
  return receiver;
}

describe("EwdxReceiverMonitor against the synthetic EM 2 Dante", () => {
  it("reports both channels of the simulated receiver and writes only to its own subscription session", async () => {
    const receiver = await start();
    await waitFor(() =>
      receiver
        .getState()
        .channels.every(({ availability }) => availability === "observed"),
    );
    const state = receiver.getState();
    expect(state).toMatchObject({
      id: "ewdx-a",
      vendor: "sennheiser",
      model: "EWDX2CHDS",
      firmware: "4.1.2",
      status: "ready",
      compatibility: "compatible-read-only",
    });
    expect(state.channels.map(({ index }) => index)).toEqual([0, 1]);
    expect(state.channels[0]).toMatchObject({
      linkStatus: "active",
      linkQualityPercent: expect.any(Number),
      rfLevelDbm: expect.any(Number),
      transmitter: { type: "EW_DX_SKM", name: "VOX 1" },
    });
    expect(state.channels[1]?.transmitter.name).toBe("VOX 2");
    for (const { method, path } of simulator!.requests.filter(
      ({ method }) => method !== "GET",
    ))
      expect([method, path]).toEqual([
        method,
        expect.stringMatching(
          /^\/api\/ssc\/state\/subscriptions\/[0-9a-f-]{36}$/,
        ),
      ]);
    expect(
      simulator!.requests.some(({ path }) =>
        /^\/api\/channel\/[2-9]/.test(path),
      ),
    ).toBe(false);
  });

  it("never sends credentials to a certificate other than the pinned one", async () => {
    const receiver = await start({}, { tlsCertificateSha256: "0".repeat(64) });
    await waitFor(() => receiver.getState().status === "error");
    expect(receiver.getState().detail).toMatch(/certificate.*pinned/i);
    expect(simulator!.requests).toEqual([]);
  });

  it("connects without verification when no certificate pin is configured", async () => {
    const receiver = await start({}, { tlsCertificateSha256: "" });
    await waitFor(() => receiver.getState().status === "ready");
    expect(simulator!.requests.length).toBeGreaterThan(0);
  });

  it("reports a rejected password and backs off instead of hammering the receiver", async () => {
    const receiver = await start({}, {}, "wrong-password");
    await waitFor(() => receiver.getState().status === "error");
    expect(receiver.getState().detail).toMatch(/password was rejected/);
    const attempts = () =>
      simulator!.requests.filter(({ authorized }) => authorized === false)
        .length;
    const before = attempts();
    await new Promise((resolve) => setTimeout(resolve, 400));
    // With a 200 ms ceiling, at most a couple of retries fit in 400 ms.
    expect(attempts() - before).toBeLessThanOrEqual(3);
    expect(JSON.stringify(receiver.getState())).not.toContain("wrong-password");
  });

  it("does not connect at all without a stored password", async () => {
    const receiver = await start({}, {}, null);
    expect(receiver.getState()).toMatchObject({ status: "error" });
    expect(receiver.getState().detail).toMatch(/password.*not.*configured/i);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(simulator!.requests).toEqual([]);
  });

  it("refuses a hostname instead of an explicit IP address", async () => {
    const receiver = await start({}, { host: "receiver.local" });
    expect(receiver.getState()).toMatchObject({ status: "error" });
    expect(receiver.getState().detail).toMatch(/explicit IP/);
  });

  it("refuses the four-channel EM 4 Dante and keeps its channels unavailable", async () => {
    const receiver = await start({ product: "EWDX4CHDS" });
    await waitFor(() => receiver.getState().status === "error");
    expect(receiver.getState().detail).toMatch(/EWDX4CHDS/);
    expect(
      receiver
        .getState()
        .channels.every(({ availability }) => availability === "unavailable"),
    ).toBe(true);
    expect(
      simulator!.requests.some(({ path }) => path.startsWith("/api/channel/")),
    ).toBe(false);
  });

  it.each([["EWDX4CHDS"], ["EWDX2CHS"]])(
    "never sends the password to a pinned %s",
    async (product) => {
      const receiver = await start({ product });
      await waitFor(() => receiver.getState().status === "error");
      expect(receiver.getState().detail).toMatch(product);
      expect(
        simulator!.requests.filter(({ authorized }) => authorized !== null),
      ).toEqual([]);
    },
  );

  it("never sends the password to a chassis swapped in while it is being identified", async () => {
    simulator = await startEwdxSimulator({ password: PASSWORD, certificate });
    // Requests 0-2 are the identity check, version and identity; the EM 4
    // Dante takes over before the authenticated firmware request.
    simulator.swapChassis({
      afterRequests: 2,
      serial: "4000000004",
      transmitterType: "EW_DX_SK",
      product: "EWDX4CHDS",
    });
    const receiver = new EwdxReceiverMonitor(config(), {
      password: PASSWORD,
      port: simulator.port,
      ...fast,
    });
    monitor = receiver;
    receiver.start();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(
      simulator.requests.filter(
        ({ authorized, product }) =>
          authorized !== null && product === "EWDX4CHDS",
      ),
    ).toEqual([]);
    expect(receiver.getState().detail).toMatch(/EWDX4CHDS/);
  });

  it("refuses SSCv1-era firmware", async () => {
    const receiver = await start({ firmware: "3.2.0" });
    await waitFor(() => receiver.getState().status === "error");
    expect(receiver.getState().detail).toMatch(/SSCv1/);
  });

  it("follows a transmitter that is switched off and back on", async () => {
    const receiver = await start();
    const second = () => receiver.getState().channels[1];
    await waitFor(() => second()?.linkStatus === "active");
    simulator!.setLinked(1, false);
    await waitFor(() => second()?.linkStatus === "no-transmitter");
    expect(second()).toMatchObject({
      batteryChargePercent: null,
      availability: "observed",
    });
    expect(receiver.getState().channels[0]?.linkStatus).toBe("active");
    simulator!.setLinked(1, true);
    await waitFor(() => second()?.linkStatus === "active");
  });

  it("goes stale on a hung receiver, keeps the last values, and recovers", async () => {
    const receiver = await start();
    await waitFor(() => receiver.getState().status === "ready");
    await waitFor(
      () => receiver.getState().channels[0]?.availability === "observed",
    );
    simulator!.setHung(true);
    await waitFor(() => receiver.getState().status === "stale");
    expect(receiver.getState().detail).toMatch(/not answering|timed out/i);
    expect(receiver.getState().channels[0]).toMatchObject({
      availability: "stale",
      transmitter: { type: "EW_DX_SKM" },
    });
    simulator!.setHung(false);
    await waitFor(() => receiver.getState().status === "ready", 6_000);
    await waitFor(
      () => receiver.getState().channels[0]?.availability === "observed",
    );
  });

  it("drops the previous chassis's telemetry when a different serial answers after a reconnect", async () => {
    const receiver = await start();
    const first = () => receiver.getState().channels[0];
    await waitFor(() => first()?.transmitter.type === "EW_DX_SKM");
    // The replacement chassis has no transmitter on channel 1. A plain dropout
    // keeps the last transmitter type; a different chassis must not.
    simulator!.setSerial("2000000002");
    simulator!.setLinked(0, false);
    simulator!.dropConnections();
    await waitFor(() =>
      receiver.getState().detail.includes("different receiver"),
    );
    await waitFor(() => first()?.linkStatus === "no-transmitter");
    expect(first()?.transmitter.type).toBeNull();
  });

  it.each([
    ["between polls", "idle" as const],
    ["in the middle of a poll", 5],
  ])(
    "never publishes a replacement chassis's telemetry before rechecking identity when it swaps %s",
    async (_label, afterRequests) => {
      const receiver = await start();
      await waitFor(
        () => receiver.getState().channels[0]?.transmitter.type === "EW_DX_SKM",
      );
      // Sample every state the monitor publishes, at every request it makes.
      const published: ReturnType<typeof receiver.getState>[] = [];
      simulator!.onRequest(() => published.push(receiver.getState()));
      simulator!.swapChassis({
        afterRequests,
        serial: "3000000003",
        transmitterType: "EW_DX_TS_5_PIN",
      });
      await waitFor(() =>
        receiver.getState().detail.includes("different receiver"),
      );
      await waitFor(
        () =>
          receiver.getState().channels[0]?.transmitter.type ===
          "EW_DX_TS_5_PIN",
      );
      const leaked = published.filter(
        (state) =>
          state.channels.some(
            ({ transmitter }) => transmitter.type === "EW_DX_TS_5_PIN",
          ) && !state.detail.includes("different receiver"),
      );
      expect(leaked).toEqual([]);
      // The first request on the replacement chassis's connection is an
      // unauthenticated identity check, never authenticated telemetry.
      const afterSwap = simulator!.requests.slice(simulator!.swappedAtRequest!);
      expect(afterSwap[0]?.path).toBe("/api/device/identity");
      expect(afterSwap[0]?.authorized).toBeNull();
    },
  );

  it("does not call the receiver current when it answers without usable telemetry", async () => {
    // The bounded GET sweep, as used when no subscription can be had.
    const receiver = await start({ subscriptions: false });
    await waitFor(() => receiver.getState().status === "ready");
    simulator!.setFault("server-error");
    await waitFor(() => receiver.getState().status !== "ready");
    expect(receiver.getState().detail).toMatch(/no usable telemetry/i);
    expect(receiver.getState().channels[0]?.availability).toBe("stale");
  });

  it("treats well-formed JSON of the wrong shape as no telemetry", async () => {
    const receiver = await start({ subscriptions: false });
    await waitFor(() => receiver.getState().status === "ready");
    simulator!.setFault("wrong-shape");
    await waitFor(() => receiver.getState().status !== "ready");
    expect(receiver.getState().detail).toMatch(/no usable telemetry/i);
  });

  it("stops every request after close", async () => {
    const receiver = await start();
    await waitFor(() => receiver.getState().status === "ready");
    receiver.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const count = simulator!.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(simulator!.requests.length).toBe(count);
  });
});

describe("SennheiserFleetMonitor", () => {
  it("opens one monitor per configured receiver and closes removed ones", async () => {
    simulator = await startEwdxSimulator({ password: PASSWORD, certificate });
    const fleet = new SennheiserFleetMonitor({
      port: simulator.port,
      password: (id) => (id === "ewdx-a" ? PASSWORD : null),
      ...fast,
    });
    monitor = fleet;
    fleet.reconcile([config()]);
    await waitFor(() => fleet.getStates()[0]?.status === "ready");
    expect(fleet.getStates()).toHaveLength(1);
    fleet.reconcile([]);
    expect(fleet.getStates()).toEqual([]);
    // Removal ends its own session; after that, nothing more is sent.
    await waitFor(() => simulator!.sessions === 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const count = simulator.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(simulator.requests.length).toBe(count);
  });

  it("says why the node's secret file is unusable instead of 'not configured'", () => {
    const fleet = new SennheiserFleetMonitor({
      password: () => null,
      secretsError: () =>
        "The EW-DX secret file is readable by other users; restrict it to mode 0600.",
      ...fast,
    });
    monitor = fleet;
    fleet.reconcile([config()]);
    expect(fleet.getStates()[0]).toMatchObject({
      status: "error",
      detail: expect.stringMatching(/readable by other users/),
    });
  });

  it("reconnects with a password stored after the receiver was configured", async () => {
    simulator = await startEwdxSimulator({ password: PASSWORD, certificate });
    let stored: string | null = null;
    const fleet = new SennheiserFleetMonitor({
      port: simulator.port,
      password: () => stored,
      ...fast,
    });
    monitor = fleet;
    fleet.reconcile([config()]);
    expect(fleet.getStates()[0]?.status).toBe("error");
    stored = "wrong-password";
    fleet.reconcile([config()]);
    await waitFor(() =>
      /password was rejected/.test(fleet.getStates()[0]?.detail ?? ""),
    );
    stored = PASSWORD;
    fleet.reconcile([config()]);
    await waitFor(() => fleet.getStates()[0]?.status === "ready");
  });
});
