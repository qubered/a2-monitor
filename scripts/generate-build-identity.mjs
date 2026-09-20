#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path, { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const generatedOutputs = new Set([
  "crates/build-info/src/generated.rs",
  "docs/quality/build-identity.json",
]);
const buildOutputSegments = new Set([
  "build",
  "coverage",
  "dist",
  "node_modules",
  "reports",
  "target",
]);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function selectBuildIdentityPaths(paths) {
  return [...new Set(paths)]
    .map((inputPath) => inputPath.replaceAll(path.sep, "/"))
    .filter((inputPath) => {
      if (generatedOutputs.has(inputPath)) return false;
      return !inputPath
        .split("/")
        .some((segment) => buildOutputSegments.has(segment));
    })
    .sort(byteCompare);
}

function checkedVersion(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !semverPattern.test(value)
  ) {
    throw new Error(
      "build version must be a non-empty SemVer-compatible value",
    );
  }
  return value;
}

async function gitOutput(repositoryRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export async function listRepositoryPaths(repositoryRoot) {
  const output = await gitOutput(repositoryRoot, ["ls-files", "--cached", "-z"]);
  return selectBuildIdentityPaths(
    output.toString("utf8").split("\0").filter(Boolean),
  );
}

export function createBuildIdentity(entries, version) {
  version = checkedVersion(version);
  if (entries.length === 0)
    throw new Error("build identity has no source inputs");
  const inputs = [...entries]
    .map(({ path: inputPath, bytes }) => ({
      path: inputPath,
      bytes: Buffer.from(bytes),
    }))
    .sort((left, right) => byteCompare(left.path, right.path));
  for (let index = 1; index < inputs.length; index += 1) {
    if (inputs[index - 1].path === inputs[index].path) {
      throw new Error(`duplicate build identity input: ${inputs[index].path}`);
    }
  }

  const digest = createHash("sha256");
  const describedInputs = inputs.map((input) => {
    digest.update(input.path);
    digest.update("\0");
    digest.update(input.bytes);
    digest.update("\0");
    return { path: input.path, sha256: sha256(input.bytes) };
  });
  const sourceSha256 = digest.digest("hex");
  return {
    schemaVersion: 1,
    identityKind: "content-addressed-source-inputs",
    algorithm: "SHA-256",
    version,
    buildId: `a2-${version}+sha256.${sourceSha256.slice(0, 16)}`,
    sourceSha256,
    inputCount: describedInputs.length,
    inputs: describedInputs,
    regenerationCommand: "node scripts/generate-build-identity.mjs",
  };
}

export function serializeBuildIdentity(identity) {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

export function renderRustBuildIdentity(identity) {
  return `// Generated file. Do not edit by hand.\n// Source: repository build inputs listed in docs/quality/build-identity.json\n// Regenerate: node scripts/generate-build-identity.mjs\n\npub const BUILD_ID: &str = ${JSON.stringify(identity.buildId)};\npub const SOURCE_SHA256: &str = ${JSON.stringify(identity.sourceSha256)};\npub const SOURCE_INPUT_COUNT: usize = ${identity.inputCount};\npub const VERSION: &str = ${JSON.stringify(identity.version)};\npub const IDENTITY_KIND: &str = ${JSON.stringify(identity.identityKind)};\n`;
}

async function repositoryIdentity(repositoryRoot) {
  const paths = await listRepositoryPaths(repositoryRoot);
  const entries = await Promise.all(
    paths.map(async (inputPath) => ({
      path: inputPath,
      bytes: await readFile(resolve(repositoryRoot, inputPath)),
    })),
  );
  const cargoManifest = entries
    .find((entry) => entry.path === "Cargo.toml")
    ?.bytes.toString("utf8");
  const version = /^version = "([^"]+)"$/m.exec(cargoManifest ?? "")?.[1];
  return createBuildIdentity(entries, version);
}

async function emitCargoRerunPaths(repositoryRoot, inputPaths) {
  const watched = new Set([...inputPaths, ...generatedOutputs]);
  for (const inputPath of inputPaths) {
    let parent = path.posix.dirname(inputPath);
    while (parent !== ".") {
      watched.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const gitIndex = (
    await gitOutput(repositoryRoot, ["rev-parse", "--git-path", "index"])
  )
    .toString("utf8")
    .trim();
  watched.add(
    path.isAbsolute(gitIndex) ? gitIndex : resolve(repositoryRoot, gitIndex),
  );
  for (const watchedPath of [...watched].sort(byteCompare)) {
    console.log(
      `cargo:rerun-if-changed=${path.isAbsolute(watchedPath) ? watchedPath : resolve(repositoryRoot, watchedPath)}`,
    );
  }
}

async function main() {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const jsonPath = resolve(repositoryRoot, "docs/quality/build-identity.json");
  const rustPath = resolve(
    repositoryRoot,
    "crates/build-info/src/generated.rs",
  );
  const identity = await repositoryIdentity(repositoryRoot);
  const expectedJson = serializeBuildIdentity(identity);
  const expectedRust = renderRustBuildIdentity(identity);
  const checkOnly = process.argv.includes("--check");
  if (process.argv.includes("--cargo-rerun-if-changed")) {
    await emitCargoRerunPaths(
      repositoryRoot,
      identity.inputs.map((input) => input.path),
    );
  }
  if (checkOnly) {
    for (const [outputPath, expected] of [
      [jsonPath, expectedJson],
      [rustPath, expectedRust],
    ]) {
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
    }
    console.log("Build identity is current.");
    return;
  }
  await Promise.all([
    writeFile(jsonPath, expectedJson),
    writeFile(rustPath, expectedRust),
  ]);
  console.log("Wrote deterministic build identity artifacts.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
