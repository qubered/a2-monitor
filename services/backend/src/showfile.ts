import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import showfileSchema from "@rvlt/pulse-protocol/schema/showfile" with { type: "json" };
import type { Showfile } from "@rvlt/pulse-protocol/http";
import { createStrictAjv2020 } from "@rvlt/pulse-protocol/validation/strict-ajv";

const validateShowfile = createStrictAjv2020().compile(showfileSchema);

export function emptyShowfile(): Showfile {
  return {
    schemaVersion: "0",
    revision: 0,
    updatedAtUtc: null,
    show: { name: "Untitled show" },
    device: null,
    shureReceivers: [],
    channels: [],
  };
}

export class ShowfileConflictError extends Error {
  constructor() {
    super("The showfile changed since it was loaded.");
    this.name = "ShowfileConflictError";
  }
}

export interface ShowfileStore {
  load(): Promise<Showfile>;
  save(candidate: Showfile): Promise<Showfile>;
}

export class MemoryShowfileStore implements ShowfileStore {
  private showfile = emptyShowfile();

  async load(): Promise<Showfile> {
    return structuredClone(this.showfile);
  }

  async save(candidate: Showfile): Promise<Showfile> {
    if (candidate.revision !== this.showfile.revision) {
      throw new ShowfileConflictError();
    }
    this.showfile = nextRevision(candidate);
    return structuredClone(this.showfile);
  }
}

function nextRevision(candidate: Showfile): Showfile {
  return {
    ...candidate,
    revision: candidate.revision + 1,
    updatedAtUtc: new Date().toISOString(),
    show: { name: candidate.show.name.trim() },
    shureReceivers: candidate.shureReceivers.map((receiver) => ({
      ...receiver,
      name: receiver.name.trim(),
      host: receiver.host.trim(),
    })),
    channels: candidate.channels.map((channel) => ({
      ...channel,
      name: channel.name.trim(),
    })),
  };
}

export class FileShowfileStore implements ShowfileStore {
  private readonly path: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, "showfile.json");
  }

  async load(): Promise<Showfile> {
    try {
      const value = migrateShowfile(
        JSON.parse(await readFile(this.path, "utf8")) as unknown,
      );
      if (!validateShowfile(value)) {
        throw new Error("Persisted showfile does not match its closed schema.");
      }
      return value as Showfile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyShowfile();
      }
      throw error;
    }
  }

  save(candidate: Showfile): Promise<Showfile> {
    const operation = this.pending.then(async () => {
      const current = await this.load();
      if (candidate.revision !== current.revision) {
        throw new ShowfileConflictError();
      }
      const saved = nextRevision(candidate);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.path);
      return saved;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

function migrateShowfile(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.shureReceivers !== undefined) return value;
  return {
    ...record,
    shureReceivers: [],
    channels: Array.isArray(record.channels)
      ? record.channels.map((channel) =>
          typeof channel === "object" && channel !== null
            ? {
                ...(channel as Record<string, unknown>),
                shureReceiverId: null,
                shureChannelIndex: null,
              }
            : channel,
        )
      : record.channels,
  };
}
