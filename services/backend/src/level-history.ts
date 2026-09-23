import type {
  ChannelLevelSample,
  LiveStateChannel,
} from "@rvlt/pulse-protocol/http";

export type LevelHistoryStoreOptions = {
  intervalMs?: number;
  capacityMs?: number;
};

export const DEFAULT_HISTORY_INTERVAL_MS = 1000;
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

/**
 * Turns one evaluated channel into a history sample. Values are recorded only
 * while their source is observed: a stale receiver's last-known RF level is
 * not written forward as if it had been measured again.
 */
export function sampleOf(
  channel: LiveStateChannel,
  atUtc: string,
): ChannelLevelSample {
  const audioObserved = channel.audio.availability === "observed";
  const telemetryObserved = channel.rf.availability === "observed";
  const batteryObserved = channel.battery.availability === "observed";
  const anyObserved = audioObserved || telemetryObserved || batteryObserved;
  const anyStale =
    channel.audio.availability === "stale" ||
    channel.rf.availability === "stale";
  return {
    atUtc,
    audioDbfs: audioObserved ? channel.audio.peakDbfs : null,
    rfLevelDbm: telemetryObserved ? channel.rf.levelDbm : null,
    linkQualityPercent: telemetryObserved
      ? channel.rf.linkQualityPercent
      : null,
    batteryPercent: batteryObserved ? channel.battery.percent : null,
    availability: anyObserved ? "observed" : anyStale ? "stale" : "unknown",
  };
}

/**
 * Bounded, in-memory per-channel time series of what the live monitor
 * observed each second: captured audio peak, RF level, link quality and
 * battery. It backs the player timeline. Memory is fixed by capacity; nothing
 * is written to disk.
 */
export class LevelHistoryStore {
  private readonly buffers = new Map<string, RingBuffer<ChannelLevelSample>>();
  readonly intervalMs: number;
  private readonly capacity: number;
  private lastRecordedAtMs: number | null = null;

  constructor(options: LevelHistoryStoreOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HISTORY_INTERVAL_MS;
    this.capacity = Math.ceil(
      (options.capacityMs ?? DEFAULT_CAPACITY_MS) / this.intervalMs,
    );
  }

  /** Records at most one sample per interval, however often the monitor evaluates. */
  record(nowMs: number, channels: readonly LiveStateChannel[]): void {
    if (
      this.lastRecordedAtMs !== null &&
      nowMs - this.lastRecordedAtMs < this.intervalMs * 0.9
    ) {
      return;
    }
    this.lastRecordedAtMs = nowMs;
    const atUtc = new Date(nowMs).toISOString();
    const present = new Set<string>();
    for (const channel of channels) {
      present.add(channel.id);
      let buffer = this.buffers.get(channel.id);
      if (!buffer) {
        buffer = new RingBuffer<ChannelLevelSample>(this.capacity);
        this.buffers.set(channel.id, buffer);
      }
      buffer.push(sampleOf(channel, atUtc));
    }
    for (const id of [...this.buffers.keys()]) {
      if (!present.has(id)) this.buffers.delete(id);
    }
  }

  has(channelId: string): boolean {
    return this.buffers.has(channelId);
  }

  getWindow(channelId: string, windowMs: number): ChannelLevelSample[] {
    const buffer = this.buffers.get(channelId);
    if (!buffer) return [];
    const all = buffer.toArray();
    const count = Math.min(all.length, Math.ceil(windowMs / this.intervalMs));
    return all.slice(all.length - count);
  }
}
