import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import showfileSchema from "@a2-monitor/protocol/schema/showfile" with { type: "json" };
import type { Showfile } from "@a2-monitor/protocol/http";
import { createStrictAjv2020 } from "@a2-monitor/protocol/validation/strict-ajv";

const validateShowfile = createStrictAjv2020().compile(showfileSchema);

export function emptyShowfile(): Showfile {
  return {
    schemaVersion: "0",
    revision: 0,
    updatedAtUtc: null,
    show: { name: "Untitled show" },
    device: null,
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
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
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
