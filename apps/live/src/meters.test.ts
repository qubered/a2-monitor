// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { MeterStore, meterUrl } from "./meters";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent) => void>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  send(type: string, data: string) {
    this.listeners.get(type)?.(new MessageEvent(type, { data }));
  }
}

const frame = {
  schemaVersion: "0",
  sequence: 1,
  intervalMs: 50,
  peakDbfs: [-12, -120],
  rmsDbfs: [-18, -120],
  clipped: [true, false],
};

afterEach(() => {
  FakeEventSource.instances = [];
  vi.useRealTimers();
});

describe("MeterStore", () => {
  it("reads the same-origin SSE meter stream", () => {
    expect(
      meterUrl(new URL("https://node.local:3001/live?x=1#y") as never),
    ).toBe("https://node.local:3001/audio/v0/meters");
  });

  it("goes live on the first valid frame and drops malformed ones", () => {
    const store = new MeterStore(
      FakeEventSource as unknown as typeof EventSource,
      () => 1_000,
    );
    store.start();
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toMatch(/\/audio\/v0\/meters$/);
    expect(store.connection).toBe("connecting");

    source.send("meters", "{not json");
    source.send("meters", JSON.stringify({ ...frame, extra: 1 }));
    expect(store.latest(0)).toBeNull();

    source.send("meters", JSON.stringify(frame));
    expect(store.connection).toBe("live");
    expect(store.latest(0)).toEqual({
      peakDbfs: -12,
      rmsDbfs: -18,
      clipped: true,
    });
    store.stop();
    expect(source.closed).toBe(true);
  });

  it("closes on error and reconnects with backoff instead of the browser's retry", () => {
    vi.useFakeTimers();
    const store = new MeterStore(
      FakeEventSource as unknown as typeof EventSource,
      () => 0,
    );
    store.start();
    const first = FakeEventSource.instances[0]!;
    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(store.connection).toBe("disconnected");

    vi.advanceTimersByTime(499);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1]!.onerror?.();
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);
    store.stop();
  });
});
