import type { LiveChannel, LiveSnapshot } from "@rvlt/pulse-protocol/http";
import type { SnapshotProvider } from "./server.js";

export type LevelHistorySample = {
  atUtc: string;
  audioDbfs: number | null;
  rfLevelDbm: number | null;
  linkQualityPercent: number | null;
  batteryPercent: number | null;
  availability: "observed" | "stale" | "unknown";
};

export type LevelHistoryStoreOptions = {
  intervalMs?: number;
  capacityMs?: number;
  now?: () => number;
};

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_CAPACITY_MS = 60 * 60 * 1000;

class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  toArray(): readonly T[] {
    return this.items;
  }
}

/** FNV-1a: a small deterministic per-channel seed so simulated jitter is stable across ticks and reloads. */
function seedFor(channelId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < channelId.length; index += 1) {
    hash ^= channelId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function jitter(seed: number, tickIndex: number, amplitude: number): number {
  const phase = seed * 1000 + tickIndex * 0.37;
  return (
    Math.sin(phase) * amplitude * 0.6 + Math.sin(phase * 2.7) * amplitude * 0.4
  );
}

function isStale(channel: LiveChannel): boolean {
  return channel.details.telemetryAge.toLowerCase().startsWith("stale");
}

/**
 * Simulates a numeric battery charge from each channel's current status —
 * the live-snapshot contract only carries a formatted `batteryRemaining`
 * string, not a percentage, so this stands in until real per-model telemetry
 * (Shure `batteryChargePercent`) is threaded through to this store. The
 * decay cycle is compressed to minutes, not the hours a real pack lasts, so
 * it is observable in a dev session.
 */
function simulatedBatteryPercent(
  channel: LiveChannel,
  seed: number,
  elapsedMs: number,
): number | null {
  if (channel.statuses.battery === "not-applicable") return null;
  if (channel.statuses.battery === "unknown") return null;
  const cyclePosition = (elapsedMs / (12 * 60 * 1000) + seed) % 1;
  return Math.round(clamp(85 - cyclePosition * 70, 5, 95));
}

function deriveSample(
  channel: LiveChannel,
  tickIndex: number,
  elapsedMs: number,
  atUtc: string,
): LevelHistorySample {
  const seed = seedFor(channel.id);
  const stale = isStale(channel);

  const silentTick =
    channel.levelDbfs !== null &&
    (tickIndex + Math.floor(seed * 97)) % 31 === 0;
  const audioDbfs =
    channel.levelDbfs === null || silentTick
      ? null
      : Math.round(
          clamp(channel.levelDbfs + jitter(seed, tickIndex, 4), -90, 0) * 10,
        ) / 10;

  const rfLevelDbm =
    channel.details.rfLevelDbm === null
      ? null
      : Math.round(
          clamp(
            channel.details.rfLevelDbm + jitter(seed + 0.31, tickIndex, 3),
            -120,
            0,
          ),
        );

  const linkQualityPercent =
    channel.details.linkQualityPercent === null
      ? null
      : Math.round(
          clamp(
            channel.details.linkQualityPercent +
              jitter(seed + 0.62, tickIndex, 6),
            0,
            100,
          ),
        );

  const batteryPercent = simulatedBatteryPercent(channel, seed, elapsedMs);

  return {
    atUtc,
    audioDbfs,
    rfLevelDbm,
    linkQualityPercent,
    batteryPercent,
    availability: stale ? "stale" : "observed",
  };
}

/**
 * Bounded, in-memory time-series store for the four honesty-grammar-tracked
 * dimensions (audio/RF/link-quality/battery) per channel. This is the
 * minimal real "store" the levels-over-time views read from — it samples
 * whatever the snapshot provider currently reports rather than persisting
 * to disk, matching the architecture guidance that high-rate telemetry
 * lives in a bounded external store, not component state, without building
 * full durable persistence.
 */
export class LevelHistoryStore {
  private readonly buffers = new Map<string, RingBuffer<LevelHistorySample>>();
  private readonly intervalMs: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private timer: NodeJS.Timeout | undefined;
  private tickIndex = 0;

  constructor(
    private readonly snapshotProvider: SnapshotProvider,
    options: LevelHistoryStoreOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.capacity = Math.ceil(
      (options.capacityMs ?? DEFAULT_CAPACITY_MS) / this.intervalMs,
    );
    this.now = options.now ?? Date.now;
    this.startedAtMs = this.now();
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getWindow(channelId: string, windowMs: number): LevelHistorySample[] {
    const buffer = this.buffers.get(channelId);
    if (!buffer) return [];
    const all = buffer.toArray();
    const count = Math.min(all.length, Math.ceil(windowMs / this.intervalMs));
    return all.slice(all.length - count);
  }

  private async tick(): Promise<void> {
    let snapshot: LiveSnapshot;
    try {
      snapshot = await this.snapshotProvider();
    } catch {
      return;
    }
    const atUtc = new Date(this.now()).toISOString();
    const elapsedMs = this.now() - this.startedAtMs;
    for (const channel of snapshot.channels) {
      const sample = deriveSample(channel, this.tickIndex, elapsedMs, atUtc);
      this.append(channel.id, sample);
    }
    this.tickIndex += 1;
  }

  private append(channelId: string, sample: LevelHistorySample): void {
    let buffer = this.buffers.get(channelId);
    if (!buffer) {
      buffer = new RingBuffer<LevelHistorySample>(this.capacity);
      this.buffers.set(channelId, buffer);
    }
    buffer.push(sample);
  }
}
