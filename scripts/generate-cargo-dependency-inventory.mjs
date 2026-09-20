#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rejectedLicences = new Set([
  "",
  "UNKNOWN",
  "UNLICENSED",
  "SEE LICENSE IN LICENSE",
]);

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function quoted(block, field) {
  return new RegExp(`^${field} = "([^"]+)"$`, "m").exec(block)?.[1];
}

export function parseCargoLock(lockfileBytes) {
  const text = lockfileBytes.toString("utf8");
  const version = /^version = (\d+)$/m.exec(text)?.[1];
  if (version !== "4") throw new Error("expected a Cargo lockfile version 4");

  return text
    .split(/^\[\[package\]\]$/m)
    .slice(1)
    .map((block) => {
      const name = quoted(block, "name");
      const packageVersion = quoted(block, "version");
      if (!name || !packageVersion)
        throw new Error("Cargo package has no name or version");
      return {
        name,
        version: packageVersion,
        source: quoted(block, "source") ?? null,
        checksum: quoted(block, "checksum") ?? null,
      };
    });
}

function checkedLicence(identity, value) {
  const licence = typeof value === "string" ? value.trim() : "";
  if (rejectedLicences.has(licence.toUpperCase())) {
    throw new Error(`${identity} has missing or unknown licence metadata`);
  }
  return licence;
}

export function generateCargoInventory(
  lockfileBytes,
  policy,
  workspaceLicence,
) {
  if (
    policy?.schemaVersion !== 1 ||
    !Array.isArray(policy.workspacePackages) ||
    !policy.packages
  ) {
    throw new Error("expected cargo licence policy schema version 1");
  }
  const packages = parseCargoLock(lockfileBytes);
  const lockedIdentities = new Map();
  for (const entry of packages) {
    const identity = `${entry.name}@${entry.version}`;
    const sourceIdentity = `${entry.source ?? "path"}\0${entry.checksum ?? ""}`;
    const previous = lockedIdentities.get(identity);
    if (previous !== undefined && previous !== sourceIdentity) {
      throw new Error(
        `${identity} is locked from multiple sources or checksums; policy identity is ambiguous`,
      );
    }
    lockedIdentities.set(identity, sourceIdentity);
  }
  const seenPolicy = new Set();
  const workspacePackages = new Set(policy.workspacePackages);
  const seenWorkspace = new Set();
  const components = packages.map((entry) => {
    const identity = `${entry.name}@${entry.version}`;
    const workspace = workspacePackages.has(identity);
    if (workspace && entry.source !== null) {
      throw new Error(
        `${identity} is marked as workspace but has an external source`,
      );
    }
    const license = checkedLicence(
      identity,
      workspace ? workspaceLicence : policy.packages[identity],
    );
    if (workspace) seenWorkspace.add(identity);
    else seenPolicy.add(identity);
    if (
      !workspace &&
      (!entry.checksum || !/^[0-9a-f]{64}$/.test(entry.checksum))
    ) {
      throw new Error(`${identity} has missing or invalid checksum metadata`);
    }
    return { ...entry, license, workspace };
  });

  const stale = Object.keys(policy.packages).filter(
    (identity) => !seenPolicy.has(identity),
  );
  if (stale.length > 0) {
    throw new Error(
      `cargo licence policy contains unlocked packages: ${stale.join(", ")}`,
    );
  }
  const staleWorkspace = policy.workspacePackages.filter(
    (identity) => !seenWorkspace.has(identity),
  );
  if (staleWorkspace.length > 0) {
    throw new Error(
      `cargo licence policy contains unlocked workspace packages: ${staleWorkspace.join(", ")}`,
    );
  }

  components.sort(
    (left, right) =>
      byteCompare(left.name, right.name) ||
      byteCompare(left.version, right.version),
  );
  const licenseCounts = Object.entries(
    components.reduce((counts, component) => {
      counts[component.license] = (counts[component.license] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .sort(([left], [right]) => byteCompare(left, right))
    .map(([license, count]) => ({ license, count }));

  return {
    schemaVersion: 1,
    generatedFrom: ["Cargo.lock", "scripts/cargo-license-policy.json"],
    regenerationCommand: "node scripts/generate-cargo-dependency-inventory.mjs",
    lockfileSha256: createHash("sha256").update(lockfileBytes).digest("hex"),
    componentCount: components.length,
    licenseCounts,
    components,
  };
}

export function serializeCargoInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function workspaceLicenceFrom(manifest) {
  const value = /^license = "([^"]+)"$/m.exec(manifest)?.[1];
  return checkedLicence("workspace", value);
}

async function main() {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const lockfilePath = resolve(repositoryRoot, "Cargo.lock");
  const policyPath = resolve(
    repositoryRoot,
    "scripts/cargo-license-policy.json",
  );
  const outputPath = resolve(
    repositoryRoot,
    "docs/quality/cargo-dependency-inventory.json",
  );
  const [lockfileBytes, policyText, manifest] = await Promise.all([
    readFile(lockfilePath),
    readFile(policyPath, "utf8"),
    readFile(resolve(repositoryRoot, "Cargo.toml"), "utf8"),
  ]);
  const expected = serializeCargoInventory(
    generateCargoInventory(
      lockfileBytes,
      JSON.parse(policyText),
      workspaceLicenceFrom(manifest),
    ),
  );
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`${relative(repositoryRoot, outputPath)} is missing`);
      }
      throw error;
    }
    if (actual !== expected) {
      throw new Error(`${relative(repositoryRoot, outputPath)} is stale`);
    }
    console.log("Cargo dependency inventory is current.");
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
