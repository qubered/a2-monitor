import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Receiver third-party passwords are write-only: Manager can set, replace or
// clear one and ask which receivers have one, but nothing here ever returns a
// password. They live beside the show data in a mode-0600 file, never in a
// showfile, an export or a log. The audio node reads the same file (see
// services/listen-gateway/src/ewdx-secrets.ts); keep the two formats in step:
//
//   { "schemaVersion": "0", "receivers": { "<receiver id>": { "password": "…" } } }

export const MAX_PASSWORD_LENGTH = 256;

export const RECEIVER_SECRETS_FILE = "receiver-secrets.json";

export interface ReceiverSecretStore {
  /** Ids of the receivers that have a password; never the passwords. */
  configured(): Promise<string[]>;
  set(receiverId: string, password: string): Promise<void>;
  clear(receiverId: string): Promise<void>;
}

type Persisted = {
  schemaVersion: "0";
  receivers: Record<string, { password: string }>;
};

export class MemoryReceiverSecretStore implements ReceiverSecretStore {
  private readonly passwords = new Map<string, string>();

  async configured(): Promise<string[]> {
    return [...this.passwords.keys()].sort();
  }

  async set(receiverId: string, password: string): Promise<void> {
    this.passwords.set(receiverId, password);
  }

  async clear(receiverId: string): Promise<void> {
    this.passwords.delete(receiverId);
  }
}

export class FileReceiverSecretStore implements ReceiverSecretStore {
  private readonly path: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, RECEIVER_SECRETS_FILE);
  }

  private async load(): Promise<Persisted> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      const receivers = (value as Partial<Persisted> | null)?.receivers;
      if (
        (value as Partial<Persisted> | null)?.schemaVersion !== "0" ||
        typeof receivers !== "object" ||
        receivers === null ||
        Array.isArray(receivers)
      )
        throw new Error("The receiver secret file is malformed.");
      return { schemaVersion: "0", receivers };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schemaVersion: "0", receivers: {} };
      throw error;
    }
  }

  private async save(state: Persisted): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  /** Serializes read-modify-write so two quick edits cannot lose one. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.pending.then(work, work);
    this.pending = run.catch(() => undefined);
    return run;
  }

  configured(): Promise<string[]> {
    return this.exclusive(async () =>
      Object.entries((await this.load()).receivers)
        .filter(
          ([, entry]) =>
            typeof entry?.password === "string" && entry.password.length > 0,
        )
        .map(([id]) => id)
        .sort(),
    );
  }

  set(receiverId: string, password: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      state.receivers[receiverId] = { password };
      await this.save(state);
    });
  }

  clear(receiverId: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!(receiverId in state.receivers)) return;
      delete state.receivers[receiverId];
      await this.save(state);
    });
  }
}
