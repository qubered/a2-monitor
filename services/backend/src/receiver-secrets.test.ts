import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileReceiverSecretStore,
  RECEIVER_SECRETS_FILE,
} from "./receiver-secrets.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "pulse-secrets-"));
  directories.push(directory);
  return { directory, store: new FileReceiverSecretStore(directory) };
}

describe("FileReceiverSecretStore", () => {
  it("writes the node's secret-file format with mode 0600", async () => {
    const { directory, store: secrets } = await store();
    await secrets.set("ewdx-a", "pw-one");
    const path = join(directory, RECEIVER_SECRETS_FILE);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: "0",
      receivers: { "ewdx-a": { password: "pw-one" } },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("replaces, lists and clears without losing concurrent edits", async () => {
    const { store: secrets } = await store();
    await Promise.all([
      secrets.set("a", "1"),
      secrets.set("b", "2"),
      secrets.set("a", "3"),
    ]);
    expect(await secrets.configured()).toEqual(["a", "b"]);
    await secrets.clear("a");
    expect(await secrets.configured()).toEqual(["b"]);
    await secrets.clear("missing");
    expect(await secrets.configured()).toEqual(["b"]);
  });

  it("starts empty when there is no file", async () => {
    const { store: secrets } = await store();
    expect(await secrets.configured()).toEqual([]);
  });
});
