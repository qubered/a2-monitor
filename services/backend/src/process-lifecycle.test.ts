import { describe, expect, it, vi } from "vitest";
import {
  startBackendProcess,
  type ShutdownSignal,
  type SignalTarget,
} from "./process-lifecycle.js";

class FakeSignalTarget implements SignalTarget {
  readonly listeners = new Map<ShutdownSignal, Set<() => void>>();

  on(signal: ShutdownSignal, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }

  off(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }

  emit(signal: ShutdownSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) listener();
  }

  listenerCount(signal: ShutdownSignal): number {
    return this.listeners.get(signal)?.size ?? 0;
  }
}

describe("backend process lifecycle", () => {
  it("closes exactly once for repeated signals and exposes the same completion", async () => {
    let finishClose: (() => void) | undefined;
    const closeCompletion = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const server = {
      listen: vi.fn(async () => "http://127.0.0.1:3000"),
      close: vi.fn(() => closeCompletion),
    };
    const signals = new FakeSignalTarget();
    const process = await startBackendProcess({
      server,
      host: "127.0.0.1",
      port: 3000,
      signalTarget: signals,
    });

    expect(signals.listenerCount("SIGINT")).toBe(1);
    expect(signals.listenerCount("SIGTERM")).toBe(1);

    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    const firstCompletion = process.shutdown();
    const secondCompletion = process.shutdown();

    expect(firstCompletion).toBe(secondCompletion);
    await vi.waitFor(() => expect(server.close).toHaveBeenCalledTimes(1));
    finishClose?.();
    await firstCompletion;

    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("removes signal handlers when listen fails", async () => {
    const startupError = new Error("address unavailable");
    const server = {
      listen: vi.fn(async () => {
        throw startupError;
      }),
      close: vi.fn(async () => {}),
    };
    const signals = new FakeSignalTarget();

    await expect(
      startBackendProcess({
        server,
        host: "127.0.0.1",
        port: 3000,
        signalTarget: signals,
      }),
    ).rejects.toBe(startupError);

    expect(server.close).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("does not expose shutdown handlers until listen succeeds", async () => {
    let finishListen: (() => void) | undefined;
    const listenCompletion = new Promise<void>((resolve) => {
      finishListen = resolve;
    });
    const server = {
      listen: vi.fn(() => listenCompletion),
      close: vi.fn(async () => {}),
    };
    const signals = new FakeSignalTarget();
    const starting = startBackendProcess({
      server,
      host: "127.0.0.1",
      port: 3000,
      signalTarget: signals,
    });

    signals.emit("SIGTERM");
    expect(server.close).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGTERM")).toBe(0);

    finishListen?.();
    const process = await starting;
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    signals.emit("SIGTERM");
    await process.shutdown();
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("reports signal-driven close failure and removes handlers", async () => {
    const closeError = new Error("close failed");
    const server = {
      listen: vi.fn(async () => "http://127.0.0.1:3000"),
      close: vi.fn(async () => {
        throw closeError;
      }),
    };
    const signals = new FakeSignalTarget();
    const onShutdownError = vi.fn();
    const process = await startBackendProcess({
      server,
      host: "127.0.0.1",
      port: 3000,
      signalTarget: signals,
      onShutdownError,
    });

    signals.emit("SIGTERM");
    signals.emit("SIGINT");

    await expect(process.shutdown()).rejects.toBe(closeError);
    await vi.waitFor(() =>
      expect(onShutdownError).toHaveBeenCalledWith(closeError),
    );
    expect(onShutdownError).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});
