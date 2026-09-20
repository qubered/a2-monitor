import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateCargoInventory,
  parseCargoLock,
  serializeCargoInventory,
} from "./generate-cargo-dependency-inventory.mjs";

function lockfile(packages, version = 4) {
  return Buffer.from(
    `# generated fixture\nversion = ${version}\n\n${packages.join("\n\n")}`,
  );
}

const workspace = `[[package]]\nname = "a2-local"\nversion = "0.0.0"`;
const registry = `[[package]]\nname = "safe"\nversion = "1.2.3"\nsource = "registry+https://example.invalid"\nchecksum = "${"a".repeat(64)}"`;

test("generates a deterministic complete Cargo inventory", () => {
  const bytes = lockfile([workspace, registry]);
  const policy = {
    schemaVersion: 1,
    workspacePackages: ["a2-local@0.0.0"],
    packages: { "safe@1.2.3": "MIT" },
  };
  const first = generateCargoInventory(bytes, policy, "LicenseRef-Proprietary");

  assert.equal(first.componentCount, 2);
  assert.deepEqual(first.licenseCounts, [
    { license: "LicenseRef-Proprietary", count: 1 },
    { license: "MIT", count: 1 },
  ]);
  assert.equal(
    serializeCargoInventory(first),
    serializeCargoInventory(
      generateCargoInventory(bytes, policy, "LicenseRef-Proprietary"),
    ),
  );
});

test("rejects a locked dependency missing from the licence policy", () => {
  assert.throws(
    () =>
      generateCargoInventory(
        lockfile([registry]),
        { schemaVersion: 1, workspacePackages: [], packages: {} },
        "LicenseRef-Proprietary",
      ),
    /safe@1\.2\.3 has missing or unknown licence metadata/,
  );
});

test("rejects unknown and unlicensed metadata", () => {
  for (const license of ["UNKNOWN", "UNLICENSED", ""]) {
    assert.throws(
      () =>
        generateCargoInventory(
          lockfile([registry]),
          {
            schemaVersion: 1,
            workspacePackages: [],
            packages: { "safe@1.2.3": license },
          },
          "LicenseRef-Proprietary",
        ),
      /missing or unknown licence metadata/,
    );
  }
});

test("rejects stale policy entries and unsupported lockfiles", () => {
  assert.throws(
    () =>
      generateCargoInventory(
        lockfile([registry]),
        {
          schemaVersion: 1,
          workspacePackages: [],
          packages: { "safe@1.2.3": "MIT", "gone@1.0.0": "MIT" },
        },
        "LicenseRef-Proprietary",
      ),
    /unlocked packages: gone@1\.0\.0/,
  );
  assert.throws(() => parseCargoLock(lockfile([], 3)), /lockfile version 4/);
});

test("rejects unknown source-null packages and stale workspace allowlist entries", () => {
  assert.throws(
    () =>
      generateCargoInventory(
        lockfile([workspace]),
        { schemaVersion: 1, workspacePackages: [], packages: {} },
        "LicenseRef-Proprietary",
      ),
    /a2-local@0\.0\.0 has missing or unknown licence metadata/,
  );
  assert.throws(
    () =>
      generateCargoInventory(
        lockfile([workspace]),
        {
          schemaVersion: 1,
          workspacePackages: ["a2-local@0.0.0", "a2-gone@0.0.0"],
          packages: {},
        },
        "LicenseRef-Proprietary",
      ),
    /unlocked workspace packages: a2-gone@0\.0\.0/,
  );
});

test("rejects duplicate name/version identities from distinct sources", () => {
  const duplicate = `[[package]]\nname = "safe"\nversion = "1.2.3"\nsource = "registry+https://another.invalid"\nchecksum = "${"b".repeat(64)}"`;
  assert.throws(
    () =>
      generateCargoInventory(
        lockfile([registry, duplicate]),
        {
          schemaVersion: 1,
          workspacePackages: [],
          packages: { "safe@1.2.3": "MIT" },
        },
        "LicenseRef-Proprietary",
      ),
    /multiple sources or checksums.*ambiguous/,
  );
});
