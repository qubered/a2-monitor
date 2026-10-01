import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChannelLevelSample } from "@rvlt/pulse-protocol/http";

export type PersistedLevelSample = {
  channelId: string;
  sample: ChannelLevelSample;
};

/**
 * Durable backing for the level history ring. Sync on purpose: batches are
 * one small transaction per second and never run on the audio path.
 */
export interface LevelHistoryPersistence {
  /** Samples at or after `sinceMs`, oldest first. */
  load(sinceMs: number): PersistedLevelSample[];
  append(rows: readonly PersistedLevelSample[]): void;
  prune(beforeMs: number): void;
  close(): void;
}

const SCHEMA_VERSION = 1;

type Row = {
  channel_id: string;
  ts: number;
  audio_dbfs: number | null;
  rf_dbm: number | null;
  link_pct: number | null;
  battery_pct: number | null;
  availability: ChannelLevelSample["availability"];
};

/**
 * `level-history.sqlite` in the data directory (or `:memory:` for tests).
 * Only samples the monitor actually recorded are stored; downtime is a gap,
 * never interpolated.
 */
export class SqliteLevelHistory implements LevelHistoryPersistence {
  private readonly db: DatabaseSync;

  constructor(location: string) {
    if (location !== ":memory:") mkdirSync(location, { recursive: true });
    this.db = new DatabaseSync(
      location === ":memory:"
        ? location
        : join(location, "level-history.sqlite"),
    );
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const { user_version: version } = this.db
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (version > SCHEMA_VERSION) {
      throw new Error(`level history database is newer (v${version})`);
    }
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE level_samples (
          channel_id TEXT NOT NULL,
          ts INTEGER NOT NULL,
          audio_dbfs REAL,
          rf_dbm REAL,
          link_pct REAL,
          battery_pct REAL,
          availability TEXT NOT NULL,
          PRIMARY KEY (channel_id, ts)
        ) WITHOUT ROWID;
        CREATE INDEX level_samples_ts ON level_samples (ts);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    }
  }

  load(sinceMs: number): PersistedLevelSample[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM level_samples WHERE ts >= ? ORDER BY ts ASC, channel_id ASC",
      )
      .all(sinceMs) as Row[];
    return rows.map((row) => ({
      channelId: row.channel_id,
      sample: {
        atUtc: new Date(row.ts).toISOString(),
        audioDbfs: row.audio_dbfs,
        rfLevelDbm: row.rf_dbm,
        linkQualityPercent: row.link_pct,
        batteryPercent: row.battery_pct,
        availability: row.availability,
      },
    }));
  }

  append(rows: readonly PersistedLevelSample[]): void {
    if (rows.length === 0) return;
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO level_samples VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.db.exec("BEGIN");
    try {
      for (const { channelId, sample } of rows) {
        insert.run(
          channelId,
          Date.parse(sample.atUtc),
          sample.audioDbfs,
          sample.rfLevelDbm,
          sample.linkQualityPercent,
          sample.batteryPercent,
          sample.availability,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  prune(beforeMs: number): void {
    this.db.prepare("DELETE FROM level_samples WHERE ts < ?").run(beforeMs);
  }

  close(): void {
    this.db.close();
  }
}
