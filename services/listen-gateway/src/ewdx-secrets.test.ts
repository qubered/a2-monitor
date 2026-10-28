import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEwdxSecrets } from "./ewdx-secrets.js";

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "pulse-ewdx-secrets-"));
  file = path.join(directory, "ewdx-secrets.json");
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function write(contents: string, mode = 0o600) {
  writeFileSync(file, contents);
  chmodSync(file, mode);
}

const VALID = JSON.stringify({
  schemaVersion: "0",
  receivers: { "ewdx-a": { password: "synthetic-secret" } },
});

describe("readEwdxSecrets", () => {
  it("returns the stored password for a configured receiver only", () => {
    write(VALID);
    const secrets = readEwdxSecrets(file);
    expect(secrets.error).toBeNull();
    expect(secrets.password("ewdx-a")).toBe("synthetic-secret");
    expect(secrets.password("other")).toBeNull();
    expect(secrets.password("__proto__")).toBeNull();
  });

  it("refuses a file other users can read", () => {
    write(VALID, 0o644);
    const secrets = readEwdxSecrets(file);
    expect(secrets.password("ewdx-a")).toBeNull();
    expect(secrets.error).toMatch(/readable by other users/);
  });

  it.each([
    ["a missing file", null],
    ["malformed JSON", "{"],
    [
      "an unknown schema version",
      JSON.stringify({ schemaVersion: "9", receivers: {} }),
    ],
    [
      "a non-string password",
      JSON.stringify({
        schemaVersion: "0",
        receivers: { "ewdx-a": { password: 7 } },
      }),
    ],
    [
      "an empty password",
      JSON.stringify({
        schemaVersion: "0",
        receivers: { "ewdx-a": { password: "" } },
      }),
    ],
    [
      "an oversized file",
      JSON.stringify({
        schemaVersion: "0",
        receivers: {},
        pad: "x".repeat(70_000),
      }),
    ],
  ])("yields no password for %s", (_label, contents) => {
    if (contents !== null) write(contents);
    const secrets = readEwdxSecrets(file);
    expect(secrets.password("ewdx-a")).toBeNull();
  });

  it("never repeats a password in its error text", () => {
    write(VALID.replace("synthetic-secret", "synthetic-secret\u0000"), 0o640);
    const secrets = readEwdxSecrets(file);
    expect(secrets.error).not.toBeNull();
    expect(secrets.error).not.toContain("synthetic-secret");
  });

  it("is off when no file is configured", () => {
    const secrets = readEwdxSecrets(undefined);
    expect(secrets.password("ewdx-a")).toBeNull();
    expect(secrets.error).toBeNull();
  });
});
