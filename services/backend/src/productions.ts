import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProductionList,
  ProductionSummary,
  Showfile,
} from "@a2-monitor/protocol/http";
import {
  emptyShowfile,
  migrateShowfile,
  ShowfileConflictError,
  trimShowfile,
  validateShowfile,
} from "./showfile.js";

export { ShowfileConflictError };

export class ProductionNotFoundError extends Error {
  constructor(id: string) {
    super(`Production ${id} was not found.`);
    this.name = "ProductionNotFoundError";
  }
}

export class ActiveProductionError extends Error {
  constructor() {
    super("The active production cannot be removed.");
    this.name = "ActiveProductionError";
  }
}

export interface ProductionStore {
  loadActive(): Promise<Showfile>;
  saveActive(candidate: Showfile): Promise<Showfile>;
  list(): Promise<ProductionList>;
  create(name: string): Promise<ProductionSummary>;
  activate(id: string): Promise<ProductionSummary>;
  remove(id: string): Promise<void>;
}

function summarize(id: string, showfile: Showfile): ProductionSummary {
  return {
    id,
    name: showfile.show.name,
    revision: showfile.revision,
    updatedAtUtc: showfile.updatedAtUtc,
    channelCount: showfile.channels.length,
    receiverCount: showfile.shureReceivers.length,
  };
}

function summarizeAll(
  activeId: string,
  productions: Record<string, Showfile>,
): ProductionList {
  return {
    schemaVersion: "0",
    activeId,
    productions: Object.entries(productions)
      .map(([id, showfile]) => summarize(id, showfile))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function bumpRevision(candidate: Showfile): Showfile {
  return {
    ...trimShowfile(candidate),
    revision: candidate.revision + 1,
    updatedAtUtc: new Date().toISOString(),
  };
}

export class MemoryProductionStore implements ProductionStore {
  private readonly productions = new Map<string, Showfile>([
    ["default", emptyShowfile()],
  ]);
  private active = "default";

  async loadActive(): Promise<Showfile> {
    return structuredClone(this.productions.get(this.active)!);
  }

  async saveActive(candidate: Showfile): Promise<Showfile> {
    const current = this.productions.get(this.active)!;
    if (candidate.revision !== current.revision) {
      throw new ShowfileConflictError();
    }
    const saved = bumpRevision(candidate);
    this.productions.set(this.active, saved);
    return structuredClone(saved);
  }

  async list(): Promise<ProductionList> {
    return summarizeAll(this.active, Object.fromEntries(this.productions));
  }

  async create(name: string): Promise<ProductionSummary> {
    const id = randomUUID();
    const showfile: Showfile = {
      ...emptyShowfile(),
      show: { name: name.trim() },
    };
    this.productions.set(id, showfile);
    this.active = id;
    return summarize(id, showfile);
  }

  async activate(id: string): Promise<ProductionSummary> {
    const showfile = this.productions.get(id);
    if (!showfile) throw new ProductionNotFoundError(id);
    this.active = id;
    return summarize(id, showfile);
  }

  async remove(id: string): Promise<void> {
    if (id === this.active) throw new ActiveProductionError();
    if (!this.productions.delete(id)) throw new ProductionNotFoundError(id);
  }
}

interface PersistedState {
  activeId: string;
  productions: Record<string, Showfile>;
}

export class FileProductionStore implements ProductionStore {
  private readonly path: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, "productions.json");
  }

  private async loadAll(): Promise<PersistedState> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null) {
        throw new Error("Persisted production store is malformed.");
      }
      const { activeId, productions } = raw as {
        activeId?: unknown;
        productions?: unknown;
      };
      if (
        typeof activeId !== "string" ||
        typeof productions !== "object" ||
        productions === null
      ) {
        throw new Error("Persisted production store is malformed.");
      }
      const migrated: Record<string, Showfile> = {};
      for (const [id, value] of Object.entries(
        productions as Record<string, unknown>,
      )) {
        const candidate = migrateShowfile(value);
        if (!validateShowfile(candidate)) {
          throw new Error(
            `Persisted production ${id} does not match its closed schema.`,
          );
        }
        migrated[id] = candidate as Showfile;
      }
      if (!Object.hasOwn(migrated, activeId)) {
        throw new Error("Persisted active production id is missing.");
      }
      return { activeId, productions: migrated };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          activeId: "default",
          productions: { default: emptyShowfile() },
        };
      }
      throw error;
    }
  }

  private async persist(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  async loadActive(): Promise<Showfile> {
    const state = await this.loadAll();
    return state.productions[state.activeId]!;
  }

  saveActive(candidate: Showfile): Promise<Showfile> {
    const operation = this.pending.then(async () => {
      const state = await this.loadAll();
      const current = state.productions[state.activeId]!;
      if (candidate.revision !== current.revision) {
        throw new ShowfileConflictError();
      }
      const saved = bumpRevision(candidate);
      state.productions[state.activeId] = saved;
      await this.persist(state);
      return saved;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async list(): Promise<ProductionList> {
    const state = await this.loadAll();
    return summarizeAll(state.activeId, state.productions);
  }

  create(name: string): Promise<ProductionSummary> {
    const operation = this.pending.then(async () => {
      const state = await this.loadAll();
      const id = randomUUID();
      const showfile: Showfile = {
        ...emptyShowfile(),
        show: { name: name.trim() },
      };
      state.productions[id] = showfile;
      state.activeId = id;
      await this.persist(state);
      return summarize(id, showfile);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  activate(id: string): Promise<ProductionSummary> {
    const operation = this.pending.then(async () => {
      const state = await this.loadAll();
      const showfile = state.productions[id];
      if (!showfile) throw new ProductionNotFoundError(id);
      state.activeId = id;
      await this.persist(state);
      return summarize(id, showfile);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  remove(id: string): Promise<void> {
    const operation = this.pending.then(async () => {
      const state = await this.loadAll();
      if (id === state.activeId) throw new ActiveProductionError();
      if (!Object.hasOwn(state.productions, id)) {
        throw new ProductionNotFoundError(id);
      }
      delete state.productions[id];
      await this.persist(state);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
