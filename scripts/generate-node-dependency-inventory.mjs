#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UNKNOWN_LICENSES = new Set([
  "",
  "UNKNOWN",
  "UNLICENSED",
  "SEE LICENSE IN LICENSE",
]);

function packageNameFromPath(packagePath) {
  const marker = "node_modules/";
  const markerIndex = packagePath.lastIndexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const remainder = packagePath.slice(markerIndex + marker.length);
  const segments = remainder.split("/");
  return segments[0].startsWith("@")
    ? `${segments[0]}/${segments[1]}`
    : segments[0];
}

function directDependencyNames(lockfile) {
  const names = new Set();

  for (const [packagePath, metadata] of Object.entries(
    lockfile.packages ?? {},
  )) {
    if (packagePath.includes("node_modules/") || metadata.link) {
      continue;
    }

    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const name of Object.keys(metadata[field] ?? {})) {
        if (!name.startsWith("@rvlt/pulse-")) {
          names.add(name);
        }
      }
    }
  }

  return names;
}

export function generateInventory(lockfileBytes) {
  const lockfileText = lockfileBytes.toString("utf8");
  const lockfile = JSON.parse(lockfileText);

  if (lockfile.lockfileVersion !== 3 || !lockfile.packages) {
    throw new Error("expected an npm lockfileVersion 3 packages map");
  }

  const directNames = directDependencyNames(lockfile);
  const componentsByIdentity = new Map();

  for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
    const name = packageNameFromPath(packagePath);

    if (!name || metadata.link) {
      continue;
    }

    if (typeof metadata.version !== "string" || metadata.version.length === 0) {
      throw new Error(`${packagePath} has no version`);
    }

    const license =
      typeof metadata.license === "string" ? metadata.license.trim() : "";
    if (UNKNOWN_LICENSES.has(license.toUpperCase())) {
      throw new Error(
        `${name}@${metadata.version} has missing or unknown licence metadata`,
      );
    }

    const identity = `${name}@${metadata.version}`;
    const existing = componentsByIdentity.get(identity);
    const location = packagePath;

    if (existing) {
      if (existing.license !== license) {
        throw new Error(`${identity} has conflicting licence metadata`);
      }
      existing.developmentOnly &&= metadata.dev === true;
      existing.optional &&= metadata.optional === true;
      existing.locations.push(location);
      continue;
    }

    componentsByIdentity.set(identity, {
      name,
      version: metadata.version,
      license,
      direct: directNames.has(name),
      developmentOnly: metadata.dev === true,
      optional: metadata.optional === true,
      locations: [location],
    });
  }

  const components = [...componentsByIdentity.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version),
  );
  const licenseCounts = Object.entries(
    components.reduce((counts, component) => {
      counts[component.license] = (counts[component.license] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => ({ license, count }));

  return {
    schemaVersion: 1,
    generatedFrom: "package-lock.json",
    regenerationCommand: "node scripts/generate-node-dependency-inventory.mjs",
    lockfileSha256: createHash("sha256").update(lockfileBytes).digest("hex"),
    componentCount: components.length,
    licenseCounts,
    components,
  };
}

export function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

async function main() {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const lockfilePath = resolve(repositoryRoot, "package-lock.json");
  const outputPath = resolve(
    repositoryRoot,
    "docs/quality/node-dependency-inventory.json",
  );
  const checkOnly = process.argv.includes("--check");
  const lockfileBytes = await readFile(lockfilePath);
  const expected = serializeInventory(generateInventory(lockfileBytes));

  if (checkOnly) {
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(
          `${relative(repositoryRoot, outputPath)} is missing; regenerate it with node scripts/generate-node-dependency-inventory.mjs`,
        );
      }
      throw error;
    }

    if (actual !== expected) {
      throw new Error(
        `${relative(repositoryRoot, outputPath)} is stale; regenerate it with node scripts/generate-node-dependency-inventory.mjs`,
      );
    }

    console.log("Node dependency inventory is current.");
    return;
  }

  await writeFile(outputPath, expected);
  console.log(`Wrote ${relative(repositoryRoot, outputPath)}.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
