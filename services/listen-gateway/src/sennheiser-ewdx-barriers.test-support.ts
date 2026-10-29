import { afterEach, expect, it } from "vitest";
import {
  generateSimulatorCertificate,
  startEwdxSimulator,
  type EwdxSimulator,
} from "./dev/ewdx-simulator.js";
import type { EwdxReceiverMonitor } from "./sennheiser-ewdx.js";

// Exact-interleaving scenarios driven by the simulator's hold/release
// barriers, parameterised by the monitor class so the same scenario can be
// run against any build of the adapter. Synthetic loopback only.

type MonitorClass = new (
  ...args: ConstructorParameters<typeof EwdxReceiverMonitor>
) => Pick<EwdxReceiverMonitor, "start" | "close" | "getState">;

const PASSWORD = "synthetic-test-password";
const certificate = generateSimulatorCertificate();
const timing = {
  pollMs: 2_000,
  requestTimeoutMs: 3_000,
  initialBackoffMs: 50,
  maxBackoffMs: 200,
  livenessMs: 150,
  staleAfterMs: 10_000,
  streamRetryMs: 300,
};
const live = (state: { status: string; detail: string }) =>
  state.status === "ready" && /SSCv2 subscription is live/.test(state.detail);

async function waitFor(predicate: () => boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition not reached.");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

export function barrierScenarios(Monitor: MonitorClass): void {
  let simulator: EwdxSimulator | undefined;
  let monitor: ReturnType<typeof start> | undefined;
  afterEach(async () => {
    monitor?.close();
    monitor = undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await simulator?.close();
    simulator = undefined;
  });
  function start(overrides: Partial<typeof timing> = {}) {
    const instance = new Monitor(
      {
        id: "ewdx-a",
        name: "EW-DX rack",
        host: "127.0.0.1",
        model: "EW-DX EM 2 Dante",
        channelCount: 2,
        tlsCertificateSha256: certificate.fingerprint256,
      },
      { password: PASSWORD, port: simulator!.port, ...timing, ...overrides },
    );
    instance.start();
    return instance;
  }

  it("opens no second session when the stream ends during a liveness check while a reopen is in flight", async () => {
    simulator = await startEwdxSimulator({ password: PASSWORD, certificate });
    monitor = start();
    await waitFor(() => live(monitor!.getState()));
    // Cycle A's liveness check is in flight and held.
    simulator.hold("session-status");
    await waitFor(() => simulator!.held("session-status") === 1);
    // The stream ends; cycle B starts a reopen, whose open event is held.
    simulator.hold("open-event");
    simulator.terminateSessions();
    await waitFor(() => simulator!.held("open-event") === 1);
    // A returns; anything it schedules runs while B is still opening.
    simulator.release("session-status");
    await new Promise((resolve) => setTimeout(resolve, 600));
    simulator.release("open-event");
    await waitFor(() => live(monitor!.getState()));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(simulator.peakSessions).toBe(1);
    expect(simulator.sessions).toBe(1);
    monitor.close();
    await waitFor(() => simulator!.sessions === 0, 2_000);
  });

  it("stops claiming a live session as soon as a liveness check finds it gone, and reopens at once", async () => {
    simulator = await startEwdxSimulator({ password: PASSWORD, certificate });
    monitor = start({ livenessMs: 1_000 });
    await waitFor(() => live(monitor!.getState()));
    const opens = () =>
      simulator!.requests.filter(
        ({ method, path }) =>
          method === "GET" && path === "/api/ssc/state/subscriptions",
      ).length;
    const before = opens();
    const statusChecks = () =>
      simulator!.requests.filter(
        ({ method, path }) =>
          method === "GET" && path.startsWith("/api/ssc/state/subscriptions/"),
      ).length;
    const checks = statusChecks();
    // The receiver forgets the session; the next liveness check gets 422.
    simulator.forgetSessions();
    await waitFor(() => statusChecks() > checks, 2_000);
    const claims: string[] = [];
    const sampler = setInterval(() => {
      const state = monitor!.getState();
      if (opens() === before && live(state)) claims.push(state.detail);
    }, 2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    clearInterval(sampler);
    expect(opens()).toBeGreaterThan(before);
    expect(claims.length).toBeLessThan(5);
    await waitFor(() => live(monitor!.getState()), 3_000);
  });

  it("claims nothing live when the stream ends before its subscription list is confirmed, and reconnects promptly", async () => {
    simulator = await startEwdxSimulator({ password: PASSWORD, certificate });
    monitor = start({ livenessMs: 60_000 });
    await waitFor(() => live(monitor!.getState()));
    // Reopen with the list reply withheld (the list itself is applied).
    simulator.hold("subscribe-reply");
    simulator.terminateSessions();
    await waitFor(() => simulator!.held("subscribe-reply") === 1);
    // That new stream ends before the reply arrives.
    simulator.terminateSessions();
    simulator.release("subscribe-reply");
    const claims: string[] = [];
    const sampler = setInterval(() => {
      const state = monitor!.getState();
      if (
        simulator!.sessions === 0 &&
        /subscription is live/.test(state.detail)
      )
        claims.push(state.detail);
    }, 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    clearInterval(sampler);
    expect(claims).toEqual([]);
    await waitFor(
      () => simulator!.sessions === 1 && live(monitor!.getState()),
      3_000,
    );
  });
}
