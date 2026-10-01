import type {
  ChannelLevelSample,
  LiveStateChannel,
} from "@rvlt/pulse-protocol/http";

import type {
  LevelHistoryPersistence,
  PersistedLevelSample,
} from "./level-history-db.js";

export type LevelHistoryStoreOptions = {
  intervalMs?: number;
  capacityMs?: number;
  persistence?: LevelHistoryPersistence;
  onError?: (error: unknown) => void;
};

const PRUNE_EVERY_RECORDS = 60;

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

function unknownSample(at: Date): ChannelLevelSample {
  return {
    atUtc: at.toISOString(),
    audioDbfs: null,
    rfLevelDbm: null,
    linkQualityPercent: null,
    batteryPercent: null,
    availability: "unknown",
  };
}

/**
 * Bounded per-channel time series of what the live monitor observed each
 * second: captured audio peak, RF level, link quality and battery. It backs
 * the player timeline. Memory is fixed by capacity. With a persistence the
 * samples are also written through, so the window survives a restart.
 */
export class LevelHistoryStore {
  private readonly buffers = new Map<string, RingBuffer<ChannelLevelSample>>();
  readonly intervalMs: number;
  private readonly capacity: number;
  private lastRecordedAtMs: number | null = null;
  private readonly persistence: LevelHistoryPersistence | undefined;
  private readonly onError: (error: unknown) => void;
  private readonly capacityMs: number;
  private recordsSincePrune = 0;

  constructor(options: LevelHistoryStoreOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HISTORY_INTERVAL_MS;
    this.capacityMs = options.capacityMs ?? DEFAULT_CAPACITY_MS;
    this.capacity = Math.ceil(this.capacityMs / this.intervalMs);
    this.persistence = options.persistence;
    this.onError = options.onError ?? (() => undefined);
  }

  /**
   * Reloads persisted samples inside the capacity window. The time between a
   * channel's last stored sample and `nowMs` (backend downtime) is filled with
   * `unknown` samples so the timeline shows a gap, not contiguous history.
   */
  restore(nowMs: number): void {
    if (!this.persistence) return;
    let rows;
    try {
      rows = this.persistence.load(nowMs - this.capacityMs);
    } catch (error) {
      this.onError(error);
      return;
    }
    const byChannel = new Map<string, ChannelLevelSample[]>();
    for (const { channelId, sample } of rows) {
      const list = byChannel.get(channelId) ?? [];
      list.push(sample);
      byChannel.set(channelId, list);
    }
    for (const [channelId, samples] of byChannel) {
      const buffer = new RingBuffer<ChannelLevelSample>(this.capacity);
      for (const sample of samples) buffer.push(sample);
      const last = Date.parse(samples[samples.length - 1]!.atUtc);
      const missing = Math.min(
        this.capacity,
        Math.floor((nowMs - last) / this.intervalMs) - 1,
      );
      for (let i = 1; i <= missing; i++) {
        buffer.push(unknownSample(new Date(last + i * this.intervalMs)));
      }
      this.buffers.set(channelId, buffer);
    }
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
    const batch: PersistedLevelSample[] = [];
    for (const channel of channels) {
      present.add(channel.id);
      let buffer = this.buffers.get(channel.id);
      if (!buffer) {
        buffer = new RingBuffer<ChannelLevelSample>(this.capacity);
        this.buffers.set(channel.id, buffer);
      }
      const sample = sampleOf(channel, atUtc);
      buffer.push(sample);
      batch.push({ channelId: channel.id, sample });
    }
    for (const id of [...this.buffers.keys()]) {
      if (!present.has(id)) this.buffers.delete(id);
    }
    this.persist(nowMs, batch);
  }

  private persist(nowMs: number, batch: readonly PersistedLevelSample[]): void {
    if (!this.persistence) return;
    try {
      this.persistence.append(batch);
      if (++this.recordsSincePrune >= PRUNE_EVERY_RECORDS) {
        this.recordsSincePrune = 0;
        this.persistence.prune(nowMs - this.capacityMs);
      }
    } catch (error) {
      this.onError(error);
    }
  }

  close(): void {
    this.persistence?.close();
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
