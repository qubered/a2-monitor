import assert from "node:assert/strict";
import { test } from "node:test";

import {
  generateInventory,
  serializeInventory,
} from "./generate-node-dependency-inventory.mjs";

function lockfile(packages) {
  return Buffer.from(
    JSON.stringify({
      name: "fixture",
      lockfileVersion: 3,
      packages,
    }),
  );
}

test("generates a deterministic inventory and merges duplicate installations", () => {
  const bytes = lockfile({
    "": {
      dependencies: { runtime: "1.0.0" },
      devDependencies: { tool: "2.0.0" },
    },
    "node_modules/runtime": {
      version: "1.0.0",
      license: "MIT",
    },
    "node_modules/tool": {
      version: "2.0.0",
      license: "Apache-2.0",
      dev: true,
    },
    "node_modules/tool/node_modules/runtime": {
      version: "1.0.0",
      license: "MIT",
      dev: true,
    },
  });

  const inventory = generateInventory(bytes);

  assert.equal(inventory.componentCount, 2);
  assert.deepEqual(inventory.licenseCounts, [
    { license: "Apache-2.0", count: 1 },
    { license: "MIT", count: 1 },
  ]);
  assert.deepEqual(inventory.components, [
    {
      name: "runtime",
      version: "1.0.0",
      license: "MIT",
      direct: true,
      developmentOnly: false,
      optional: false,
      locations: [
        "node_modules/runtime",
        "node_modules/tool/node_modules/runtime",
      ],
    },
    {
      name: "tool",
      version: "2.0.0",
      license: "Apache-2.0",
      direct: true,
      developmentOnly: true,
      optional: false,
      locations: ["node_modules/tool"],
    },
  ]);
  assert.equal(
    serializeInventory(inventory),
    serializeInventory(generateInventory(bytes)),
  );
});

test("rejects missing licence metadata", () => {
  const bytes = lockfile({
    "": { dependencies: { unsafe: "1.0.0" } },
    "node_modules/unsafe": { version: "1.0.0" },
  });

  assert.throws(
    () => generateInventory(bytes),
    /unsafe@1\.0\.0 has missing or unknown licence metadata/,
  );
});

test("rejects unsupported lockfile shapes", () => {
  const bytes = Buffer.from(
    JSON.stringify({ lockfileVersion: 2, packages: {} }),
  );

  assert.throws(
    () => generateInventory(bytes),
    /expected an npm lockfileVersion 3 packages map/,
  );
});
