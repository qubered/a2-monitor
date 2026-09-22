import { afterEach, describe, expect, it } from "vitest";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";
import { LevelHistoryStore } from "./level-history.js";

const stores: LevelHistoryStore[] = [];

afterEach(() => {
  for (const store of stores) store.stop();
  stores.length = 0;
});

function trackedStore(
  ...parameters: ConstructorParameters<typeof LevelHistoryStore>
) {
  const store = new LevelHistoryStore(...parameters);
  stores.push(store);
  return store;
}

describe("LevelHistoryStore", () => {
  it("returns no samples for a channel it has never ticked", () => {
    const store = trackedStore(() => fabricatedLiveSnapshot, {
      intervalMs: 1000,
    });
    expect(store.getWindow("ch-27", 60_000)).toEqual([]);
  });

  it("accumulates one sample per channel per tick and bounds by capacity", async () => {
    const store = trackedStore(() => fabricatedLiveSnapshot, {
      intervalMs: 5,
      capacityMs: 20,
    });
    store.start();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const samples = store.getWindow("ch-27", 20);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.length).toBeLessThanOrEqual(4);
  });

  it("returns only the most recent slice for a narrower window than the buffer", async () => {
    const store = trackedStore(() => fabricatedLiveSnapshot, {
      intervalMs: 5,
      capacityMs: 500,
    });
    store.start();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const full = store.getWindow("ch-27", 500);
    const narrow = store.getWindow("ch-27", 10);
    expect(narrow.length).toBeLessThan(full.length);
    expect(full.slice(full.length - narrow.length)).toEqual(narrow);
  });

  it("keeps a wired channel's RF and battery samples null", async () => {
    const store = trackedStore(() => fabricatedLiveSnapshot, {
      intervalMs: 5,
      capacityMs: 50,
    });
    store.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const samples = store.getWindow("ch-08", 50);
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.rfLevelDbm).toBeNull();
      expect(sample.batteryPercent).toBeNull();
    }
  });

  it("stops ticking once stopped", async () => {
    const store = trackedStore(() => fabricatedLiveSnapshot, {
      intervalMs: 5,
      capacityMs: 500,
    });
    store.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.stop();
    const afterStop = store.getWindow("ch-27", 500).length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.getWindow("ch-27", 500).length).toBe(afterStop);
  });
});
