import { readFileSync, statSync } from "node:fs";

// EW-DX third-party passwords are entered per receiver in Manager. The backend
// writes them, write-only and mode 0600, to receiver-secrets.json in its data
// directory (services/backend/src/receiver-secrets.ts); this node reads the
// same file, found through A2_DATA_DIR or named by A2_EWDX_SECRETS_FILE:
//
//   { "schemaVersion": "0", "receivers": { "<receiver id>": { "password": "…" } } }
//
// They never appear in the showfile, Live, exports or logs, no route returns
// one, and nothing here ever echoes a password back in an error.

const MAX_BYTES = 64 * 1024;

export type EwdxSecrets = {
  /** The stored password for a receiver id, or null when there is none. */
  password(receiverId: string): string | null;
  /** Why the file could not be used; never contains a secret. */
  error: string | null;
};

const NONE = (error: string | null): EwdxSecrets => ({
  password: () => null,
  error,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the node-local EW-DX secret file; re-read on every config refresh so updates apply. */
export function readEwdxSecrets(file: string | undefined): EwdxSecrets {
  if (!file) return NONE(null);
  let contents: string;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return NONE("The EW-DX secret file is not a file.");
    if ((stat.mode & 0o077) !== 0)
      return NONE(
        "The EW-DX secret file is readable by other users; restrict it to mode 0600.",
      );
    if (stat.size > MAX_BYTES)
      return NONE("The EW-DX secret file is larger than 64 KiB.");
    contents = readFileSync(file, "utf8");
  } catch {
    return NONE("The EW-DX secret file could not be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return NONE("The EW-DX secret file is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== "0" ||
    !isRecord(parsed.receivers)
  )
    return NONE("The EW-DX secret file does not match schema version 0.");
  const passwords = new Map<string, string>();
  for (const [id, entry] of Object.entries(parsed.receivers)) {
    if (
      isRecord(entry) &&
      typeof entry.password === "string" &&
      entry.password.length > 0 &&
      entry.password.length <= 256
    )
      passwords.set(id, entry.password);
  }
  return { password: (id) => passwords.get(id) ?? null, error: null };
}
