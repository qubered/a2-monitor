#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAndValidateProcessBoundaryContract } from "./validate-process-boundaries.mjs";

const MANIFEST_NAME = "slot-manifest.json";
const SCHEMA_VERSION = 1;
const FIXED_TIME_SECONDS = 946684800;
const ROLES = new Set([
  "audio_node",
  "supervisor",
  "node_runtime",
  "backend",
  "backend_dependency",
  "protocol_runtime",
  "protocol_schema",
  "process_contract",
  "manager_asset",
  "live_asset",
  "license",
]);
const REQUIRED_STAGE_OPTIONS = [
  "output-root",
  "build-id",
  "platform",
  "arch",
  "audio-node",
  "supervisor",
  "backend-dist",
  "backend-dependencies",
  "protocol-package",
  "manager-dist",
  "live-dist",
  "node-runtime",
  "build-identity",
  "release-metadata",
  "cargo-lock",
  "npm-lock",
  "cargo-inventory",
  "node-inventory",
  "node-license",
  "process-contract",
];
const BACKEND_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".map",
  ".ts",
]);
const WEB_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".png",
  ".svg",
  ".webmanifest",
  ".woff",
  ".woff2",
]);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
  /\.(?:key|p12|pem|pfx)$/i,
];

function fail(message) {
  throw new Error(message);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function assertSafeSegment(segment, context) {
  const invalidWindowsName = /[<>"|?*\u0000-\u001f]/u.test(segment);
  const windowsStem = segment.split(".", 1)[0].toUpperCase();
  const reservedWindowsName =
    new Set(["CON", "PRN", "AUX", "NUL", "CLOCK$"]).has(windowsStem) ||
    /^(?:COM|LPT)[1-9]$/.test(windowsStem);
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0") ||
    segment.includes(":") ||
    invalidWindowsName ||
    reservedWindowsName ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    segment.normalize("NFC") !== segment ||
    Buffer.byteLength(segment, "utf8") > 255
  ) {
    fail(
      `${context} contains an unsafe path segment: ${JSON.stringify(segment)}`,
    );
  }
  if (
    segment.toLowerCase() === "secrets" ||
    SECRET_FILE_PATTERNS.some((pattern) => pattern.test(segment))
  ) {
    fail(`${context} contains a forbidden secret-like path: ${segment}`);
  }
}

function assertSafeRelative(relativePath, context) {
  if (path.posix.isAbsolute(relativePath) || relativePath.length === 0) {
    fail(`${context} must be a non-empty relative path`);
  }
  for (const segment of relativePath.split("/")) {
    assertSafeSegment(segment, context);
  }
  if (relativePath.length > 240) {
    fail(
      `${context} exceeds the portable 240-character relative-path limit: ${relativePath}`,
    );
  }
}

async function assertRegularFile(source, label) {
  const metadata = await lstat(source).catch(() =>
    fail(`${label} does not exist: ${source}`),
  );
  if (metadata.isSymbolicLink()) {
    fail(`${label} must not be a symbolic link: ${source}`);
  }
  if (!metadata.isFile()) {
    fail(`${label} must be a regular file: ${source}`);
  }
}

async function assertDirectory(source, label) {
  const metadata = await lstat(source).catch(() =>
    fail(`${label} does not exist: ${source}`),
  );
  if (metadata.isSymbolicLink()) {
    fail(`${label} must not be a symbolic link: ${source}`);
  }
  if (!metadata.isDirectory()) {
    fail(`${label} must be a directory: ${source}`);
  }
}

async function assertExecutableFormat(source, label, platform, arch) {
  const handle = await open(source, "r");
  try {
    const fileSize = (await handle.stat()).size;
    async function readExact(offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset + length > fileSize
      ) {
        fail(`${label} has a truncated executable header`);
      }
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, offset);
      if (bytesRead !== length)
        fail(`${label} has a truncated executable header`);
      return bytes;
    }

    if (platform === "windows") {
      const dosHeader = await readExact(0, 64);
      if (dosHeader.toString("ascii", 0, 2) !== "MZ") {
        fail(`${label} is not a PE executable`);
      }
      const peOffset = dosHeader.readUInt32LE(0x3c);
      const coff = await readExact(peOffset, 24);
      const expectedMachine = arch === "x86_64" ? 0x8664 : 0xaa64;
      if (
        coff.toString("binary", 0, 4) !== "PE\0\0" ||
        coff.readUInt16LE(4) !== expectedMachine
      ) {
        fail(`${label} is not a ${arch} PE executable`);
      }
      const sectionCount = coff.readUInt16LE(6);
      const optionalHeaderSize = coff.readUInt16LE(20);
      const characteristics = coff.readUInt16LE(22);
      if (
        sectionCount === 0 ||
        sectionCount > 96 ||
        optionalHeaderSize < 112 ||
        (characteristics & 0x0002) === 0
      ) {
        fail(`${label} is not a complete executable PE image`);
      }
      const optional = await readExact(peOffset + 24, optionalHeaderSize);
      if (optional.readUInt16LE(0) !== 0x020b) {
        fail(`${label} is not a PE32+ executable`);
      }
      const sizeOfHeaders = optional.readUInt32LE(60);
      if (sizeOfHeaders === 0 || sizeOfHeaders > fileSize) {
        fail(`${label} has invalid PE header bounds`);
      }
      const sections = await readExact(
        peOffset + 24 + optionalHeaderSize,
        sectionCount * 40,
      );
      let hasExecutableSection = false;
      for (let index = 0; index < sectionCount; index += 1) {
        const base = index * 40;
        const rawSize = sections.readUInt32LE(base + 16);
        const rawOffset = sections.readUInt32LE(base + 20);
        const flags = sections.readUInt32LE(base + 36);
        if (
          rawSize > 0 &&
          rawOffset >= sizeOfHeaders &&
          rawOffset + rawSize <= fileSize &&
          (flags & 0x20000000) !== 0
        ) {
          hasExecutableSection = true;
        }
      }
      if (!hasExecutableSection)
        fail(`${label} has no bounded executable PE section`);
      return;
    }

    const expectedCpu = arch === "aarch64" ? 0x0100000c : 0x01000007;
    async function validateThinMachO(sliceOffset, sliceSize) {
      if (sliceSize < 32 || sliceOffset + sliceSize > fileSize) return false;
      const header = await readExact(sliceOffset, 32);
      if (
        header.readUInt32LE(0) !== 0xfeedfacf ||
        header.readUInt32LE(4) !== expectedCpu ||
        header.readUInt32LE(12) !== 2
      ) {
        return false;
      }
      const commandCount = header.readUInt32LE(16);
      const commandBytes = header.readUInt32LE(20);
      if (
        commandCount === 0 ||
        commandCount > 4096 ||
        commandBytes < commandCount * 8 ||
        32 + commandBytes > sliceSize
      ) {
        return false;
      }
      const commands = await readExact(sliceOffset + 32, commandBytes);
      let cursor = 0;
      let hasExecutableText = false;
      for (let index = 0; index < commandCount; index += 1) {
        if (cursor + 8 > commands.length) return false;
        const command = commands.readUInt32LE(cursor);
        const commandSize = commands.readUInt32LE(cursor + 4);
        if (commandSize < 8 || cursor + commandSize > commands.length)
          return false;
        if (command === 0x19 && commandSize >= 72) {
          const segmentName = commands
            .subarray(cursor + 8, cursor + 24)
            .toString("ascii")
            .replace(/\0+$/u, "");
          const fileOffset = Number(commands.readBigUInt64LE(cursor + 40));
          const segmentSize = Number(commands.readBigUInt64LE(cursor + 48));
          const maximumProtection = commands.readInt32LE(cursor + 56);
          if (
            segmentName === "__TEXT" &&
            Number.isSafeInteger(fileOffset) &&
            Number.isSafeInteger(segmentSize) &&
            segmentSize > 0 &&
            fileOffset + segmentSize <= sliceSize &&
            (maximumProtection & 0x4) !== 0
          ) {
            hasExecutableText = true;
          }
        }
        cursor += commandSize;
      }
      return cursor === commandBytes && hasExecutableText;
    }

    if (await validateThinMachO(0, fileSize)) return;
    const fatHeader = await readExact(0, 8);
    const fatMagic = fatHeader.readUInt32BE(0);
    if (fatMagic === 0xcafebabe || fatMagic === 0xcafebabf) {
      const recordSize = fatMagic === 0xcafebabf ? 32 : 20;
      const count = fatHeader.readUInt32BE(4);
      if (count > 0 && count <= 64) {
        const records = await readExact(8, count * recordSize);
        for (let index = 0; index < count; index += 1) {
          const base = index * recordSize;
          if (records.readUInt32BE(base) !== expectedCpu) continue;
          const sliceOffset =
            fatMagic === 0xcafebabf
              ? Number(records.readBigUInt64BE(base + 8))
              : records.readUInt32BE(base + 8);
          const sliceSize =
            fatMagic === 0xcafebabf
              ? Number(records.readBigUInt64BE(base + 16))
              : records.readUInt32BE(base + 12);
          if (
            Number.isSafeInteger(sliceOffset) &&
            Number.isSafeInteger(sliceSize) &&
            (await validateThinMachO(sliceOffset, sliceSize))
          ) {
            return;
          }
        }
      }
    }
    fail(`${label} is not a Mach-O executable for ${arch}`);
  } finally {
    await handle.close();
  }
}

async function collectTree(root, label) {
  await assertDirectory(root, label);
  const files = [];
  const caseFoldedPaths = new Map();

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      assertSafeSegment(entry.name, label);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const folded = relativePath.toLowerCase();
      const prior = caseFoldedPaths.get(folded);
      if (prior && prior !== relativePath) {
        fail(
          `${label} has paths that collide on case-insensitive filesystems: ${prior}, ${relativePath}`,
        );
      }
      caseFoldedPaths.set(folded, relativePath);
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`${label} contains a symbolic link: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(source, relativePath);
      } else if (entry.isFile()) {
        files.push({ relativePath, source });
      } else {
        fail(
          `${label} contains a non-regular filesystem entry: ${relativePath}`,
        );
      }
    }
  }

  await visit(root, "");
  if (files.length === 0) {
    fail(`${label} must not be empty`);
  }
  files.sort((left, right) =>
    compareUtf8(left.relativePath, right.relativePath),
  );
  return files;
}

function assertAllowedExtensions(files, allowed, label) {
  for (const file of files) {
    const extension = path.posix.extname(file.relativePath).toLowerCase();
    if (!allowed.has(extension)) {
      fail(`${label} contains an unexpected file type: ${file.relativePath}`);
    }
  }
}

function requireRelativeFile(files, requiredPath, label) {
  if (!files.some((file) => file.relativePath === requiredPath)) {
    fail(`${label} is missing required file: ${requiredPath}`);
  }
}

async function validateProtocolPackage(root) {
  await assertDirectory(root, "protocol package");
  const packageFile = path.join(root, "package.json");
  await assertRegularFile(packageFile, "protocol package metadata");
  const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
  if (
    packageJson.name !== "@rvlt/pulse-protocol" ||
    packageJson.type !== "module"
  ) {
    fail(
      "protocol package metadata must identify @rvlt/pulse-protocol as an ES module",
    );
  }
  const schemaRoot = path.join(root, "schema");
  const schemas = await collectTree(schemaRoot, "protocol schema directory");
  assertAllowedExtensions(
    schemas,
    new Set([".json"]),
    "protocol schema directory",
  );
  requireRelativeFile(
    schemas,
    "v0/http/health-response.schema.json",
    "protocol schema directory",
  );
  requireRelativeFile(
    schemas,
    "v0/http/live-snapshot-response.schema.json",
    "protocol schema directory",
  );
  const validationRoot = path.join(root, "validation");
  const validation = await collectTree(
    validationRoot,
    "protocol validation runtime",
  );
  assertAllowedExtensions(
    validation,
    new Set([".mjs", ".mts"]),
    "protocol validation runtime",
  );
  requireRelativeFile(
    validation,
    "strict-ajv.mjs",
    "protocol validation runtime",
  );
  requireRelativeFile(
    validation,
    "strict-ajv.d.mts",
    "protocol validation runtime",
  );
  return {
    runtime: [
      { relativePath: "package.json", source: packageFile },
      ...validation.map((file) => ({
        relativePath: `validation/${file.relativePath}`,
        source: file.source,
      })),
    ],
    schemas: schemas.map((file) => ({
      relativePath: `schema/${file.relativePath}`,
      source: file.source,
    })),
  };
}

async function validateBackendDependencies(root) {
  const files = await collectTree(root, "backend production dependencies");
  for (const required of [
    "fastify/package.json",
    "ajv/package.json",
    "ajv-formats/package.json",
  ]) {
    requireRelativeFile(files, required, "backend production dependencies");
  }
  for (const file of files) {
    if (
      file.relativePath === "@rvlt/pulse-protocol" ||
      file.relativePath.startsWith("@rvlt/pulse-protocol/")
    ) {
      fail(
        "backend production dependencies must not contain @rvlt/pulse-protocol; use --protocol-package",
      );
    }
  }
  return files;
}

async function sha256File(filename) {
  const content = await readFile(filename);
  return createHash("sha256").update(content).digest("hex");
}

async function setFileMetadata(filename, executable) {
  await chmod(filename, executable ? 0o555 : 0o444);
  await utimes(filename, FIXED_TIME_SECONDS, FIXED_TIME_SECONDS);
}

async function copyEntry(
  source,
  slotRoot,
  relativePath,
  role,
  executable = false,
) {
  assertSafeRelative(relativePath, "slot path");
  const destination = path.join(slotRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await copyFile(source, destination);
  await setFileMetadata(destination, executable);
  const metadata = await stat(destination);
  return {
    path: relativePath,
    role,
    size: metadata.size,
    sha256: await sha256File(destination),
    mode: executable ? "0555" : "0444",
    executable,
  };
}

async function copyTree(files, slotRoot, destinationPrefix, role) {
  const manifestEntries = [];
  for (const file of files) {
    manifestEntries.push(
      await copyEntry(
        file.source,
        slotRoot,
        `${destinationPrefix}/${file.relativePath}`,
        role,
      ),
    );
  }
  return manifestEntries;
}

async function writeGeneratedEntry(slotRoot, relativePath, role, content) {
  assertSafeRelative(relativePath, "slot path");
  const destination = path.join(slotRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await writeFile(destination, content, { flag: "wx", mode: 0o444 });
  await setFileMetadata(destination, false);
  const metadata = await stat(destination);
  return {
    path: relativePath,
    role,
    size: metadata.size,
    sha256: await sha256File(destination),
    mode: "0444",
    executable: false,
  };
}

function assertExactVersion(value, label) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      value,
    )
  ) {
    fail(`${label} must be an exact semantic version`);
  }
}

async function loadReleaseMetadata(filename, options) {
  await assertRegularFile(filename, "release metadata");
  const metadata = JSON.parse(await readFile(filename, "utf8"));
  const keys = Object.keys(metadata).sort(compareUtf8);
  const expectedKeys = [
    "buildProfile",
    "protocolVersion",
    "schemaVersion",
    "targetTriple",
    "toolchains",
  ];
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
    metadata.schemaVersion !== 1
  ) {
    fail("release metadata must be the closed schemaVersion 1 object");
  }
  if (!new Set(["debug", "release"]).has(metadata.buildProfile))
    fail("release metadata has invalid buildProfile");
  if (!/^v(?:0|[1-9]\d*)$/.test(metadata.protocolVersion))
    fail("release metadata has invalid protocolVersion");
  const targetTriples = {
    "macos/aarch64": "aarch64-apple-darwin",
    "macos/x86_64": "x86_64-apple-darwin",
    "windows/aarch64": "aarch64-pc-windows-msvc",
    "windows/x86_64": "x86_64-pc-windows-msvc",
  };
  if (
    metadata.targetTriple !==
    targetTriples[`${options.platform}/${options.arch}`]
  ) {
    fail("release metadata targetTriple does not match --platform/--arch");
  }
  if (
    !metadata.toolchains ||
    typeof metadata.toolchains !== "object" ||
    Array.isArray(metadata.toolchains)
  ) {
    fail("release metadata toolchains must be an object");
  }
  const toolchainKeys = Object.keys(metadata.toolchains).sort(compareUtf8);
  if (
    JSON.stringify(toolchainKeys) !==
    JSON.stringify(["cargo", "node", "npm", "rustc"])
  ) {
    fail(
      "release metadata must contain exactly cargo, node, npm, and rustc toolchains",
    );
  }
  for (const toolchain of toolchainKeys)
    assertExactVersion(metadata.toolchains[toolchain], `${toolchain} version`);
  return metadata;
}

async function loadBuildIdentity(filename, expectedBuildId) {
  await assertRegularFile(filename, "build identity");
  const identity = JSON.parse(await readFile(filename, "utf8"));
  if (identity.buildId !== expectedBuildId)
    fail("--build-id does not match the build identity");
  assertExactVersion(identity.version, "application version");
  if (
    typeof identity.identityKind !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(identity.identityKind)
  ) {
    fail("build identity has invalid identityKind");
  }
  if (
    typeof identity.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(identity.sourceSha256)
  ) {
    fail("build identity has invalid sourceSha256");
  }
  return identity;
}

function validateBuildCoordinates(options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(options["build-id"])) {
    fail(
      "--build-id must be a safe version-slot name of at most 128 ASCII characters",
    );
  }
  if (!new Set(["windows", "macos"]).has(options.platform)) {
    fail("--platform must be windows or macos");
  }
  if (!new Set(["x86_64", "aarch64"]).has(options.arch)) {
    fail("--arch must be x86_64 or aarch64");
  }
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("slot manifest must be an object");
  }
  const allowedTopLevel = [
    "appVersion",
    "arch",
    "artifactKind",
    "buildId",
    "buildProfile",
    "entrypoints",
    "files",
    "frontendRoots",
    "identityKind",
    "inventorySha256",
    "lockSha256",
    "platform",
    "protocolVersion",
    "schemaVersion",
    "slotId",
    "sourceSha256",
    "targetTriple",
    "toolchains",
  ];
  const keys = Object.keys(manifest).sort(compareUtf8);
  if (JSON.stringify(keys) !== JSON.stringify(allowedTopLevel)) {
    fail(`slot manifest has missing or unknown properties: ${keys.join(", ")}`);
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION)
    fail("unsupported slot manifest schemaVersion");
  if (manifest.artifactKind !== "unsigned-smoke-slot")
    fail("slot manifest has invalid artifactKind");
  validateBuildCoordinates({
    "build-id": manifest.buildId,
    platform: manifest.platform,
    arch: manifest.arch,
  });
  if (manifest.slotId !== manifest.buildId) fail("slotId must equal buildId");
  assertExactVersion(manifest.appVersion, "manifest appVersion");
  if (!new Set(["debug", "release"]).has(manifest.buildProfile))
    fail("manifest has invalid buildProfile");
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.identityKind))
    fail("manifest has invalid identityKind");
  if (!/^v(?:0|[1-9]\d*)$/.test(manifest.protocolVersion))
    fail("manifest has invalid protocolVersion");
  if (!/^[a-f0-9]{64}$/.test(manifest.sourceSha256))
    fail("manifest has invalid sourceSha256");
  const fixedPathMaps = [
    [
      manifest.entrypoints,
      ["audioNode", "backend", "nodeRuntime", "supervisor"],
    ],
    [manifest.frontendRoots, ["live", "manager"]],
    [manifest.lockSha256, ["cargo", "npm"]],
    [manifest.inventorySha256, ["cargo", "node"]],
    [manifest.toolchains, ["cargo", "node", "npm", "rustc"]],
  ];
  for (const [value, expected] of fixedPathMaps) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort(compareUtf8)) !==
        JSON.stringify(expected)
    ) {
      fail("slot manifest has an incomplete or unknown metadata map");
    }
  }
  for (const digest of [
    ...Object.values(manifest.lockSha256),
    ...Object.values(manifest.inventorySha256),
  ]) {
    if (!/^[a-f0-9]{64}$/.test(digest))
      fail("slot manifest has an invalid input digest");
  }
  for (const version of Object.values(manifest.toolchains))
    assertExactVersion(version, "manifest toolchain version");
  const expectedTarget = {
    "macos/aarch64": "aarch64-apple-darwin",
    "macos/x86_64": "x86_64-apple-darwin",
    "windows/aarch64": "aarch64-pc-windows-msvc",
    "windows/x86_64": "x86_64-pc-windows-msvc",
  }[`${manifest.platform}/${manifest.arch}`];
  if (manifest.targetTriple !== expectedTarget)
    fail("manifest targetTriple does not match platform/arch");
  const suffix = manifest.platform === "windows" ? ".exe" : "";
  const expectedEntrypoints = {
    audioNode: `bin/a2-synthetic-capture${suffix}`,
    backend: "backend/dist/start.js",
    nodeRuntime: `runtime/node${suffix}`,
    supervisor: `bin/a2-supervisor-smoke${suffix}`,
  };
  if (
    JSON.stringify(manifest.entrypoints) !== JSON.stringify(expectedEntrypoints)
  )
    fail("manifest entrypoints are not the fixed layout");
  if (
    JSON.stringify(manifest.frontendRoots) !==
    JSON.stringify({ live: "web/live", manager: "web/manager" })
  ) {
    fail("manifest frontendRoots are not the fixed layout");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0)
    fail("slot manifest files must be non-empty");
  let priorPath = "";
  const folded = new Set();
  const entriesByPath = new Map();
  for (const entry of manifest.files) {
    const entryKeys = Object.keys(entry).sort(compareUtf8);
    if (
      JSON.stringify(entryKeys) !==
      JSON.stringify(["executable", "mode", "path", "role", "sha256", "size"])
    ) {
      fail(
        `manifest entry has missing or unknown properties: ${entryKeys.join(", ")}`,
      );
    }
    assertSafeRelative(entry.path, "manifest path");
    if (entry.path === MANIFEST_NAME)
      fail("slot manifest must not list itself");
    if (compareUtf8(priorPath, entry.path) >= 0)
      fail("slot manifest paths must be unique and byte-sorted");
    priorPath = entry.path;
    const foldedPath = entry.path.toLowerCase();
    if (folded.has(foldedPath))
      fail(
        `manifest paths collide on case-insensitive filesystems: ${entry.path}`,
      );
    folded.add(foldedPath);
    if (!ROLES.has(entry.role))
      fail(`manifest entry has unknown role: ${entry.role}`);
    const expectedRole = (() => {
      if (entry.path === manifest.entrypoints.audioNode) return "audio_node";
      if (entry.path === manifest.entrypoints.supervisor) return "supervisor";
      if (entry.path === manifest.entrypoints.nodeRuntime)
        return "node_runtime";
      if (entry.path === "licenses/node/LICENSE") return "license";
      if (entry.path === "config/process-boundaries.v0.json")
        return "process_contract";
      if (
        entry.path === "backend/package.json" ||
        entry.path.startsWith("backend/dist/")
      ) {
        return "backend";
      }
      if (entry.path.startsWith("backend/node_modules/@rvlt/pulse-protocol/")) {
        if (
          entry.path.startsWith(
            "backend/node_modules/@rvlt/pulse-protocol/schema/",
          )
        ) {
          return "protocol_schema";
        }
        return "protocol_runtime";
      }
      if (entry.path.startsWith("backend/node_modules/"))
        return "backend_dependency";
      if (entry.path.startsWith(`${manifest.frontendRoots.manager}/`))
        return "manager_asset";
      if (entry.path.startsWith(`${manifest.frontendRoots.live}/`))
        return "live_asset";
      return null;
    })();
    if (entry.role !== expectedRole) {
      fail(`manifest path has invalid role: ${entry.path}`);
    }
    if (
      typeof entry.executable !== "boolean" ||
      entry.mode !== (entry.executable ? "0555" : "0444")
    ) {
      fail(
        `manifest entry has invalid executable/mode metadata: ${entry.path}`,
      );
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0)
      fail(`manifest entry has invalid size: ${entry.path}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256))
      fail(`manifest entry has invalid SHA-256: ${entry.path}`);
    entriesByPath.set(entry.path, entry);
  }
  const requiredEntries = [
    [manifest.entrypoints.audioNode, "audio_node", true],
    [manifest.entrypoints.supervisor, "supervisor", true],
    [manifest.entrypoints.nodeRuntime, "node_runtime", true],
    [manifest.entrypoints.backend, "backend", false],
    [`${manifest.frontendRoots.manager}/index.html`, "manager_asset", false],
    [`${manifest.frontendRoots.live}/index.html`, "live_asset", false],
    ["backend/package.json", "backend", false],
    [
      "backend/node_modules/@rvlt/pulse-protocol/package.json",
      "protocol_runtime",
      false,
    ],
    [
      "backend/node_modules/@rvlt/pulse-protocol/validation/strict-ajv.mjs",
      "protocol_runtime",
      false,
    ],
    [
      "backend/node_modules/@rvlt/pulse-protocol/schema/v0/http/health-response.schema.json",
      "protocol_schema",
      false,
    ],
    [
      "backend/node_modules/@rvlt/pulse-protocol/schema/v0/http/live-snapshot-response.schema.json",
      "protocol_schema",
      false,
    ],
    ["licenses/node/LICENSE", "license", false],
    ["config/process-boundaries.v0.json", "process_contract", false],
  ];
  for (const [requiredPath, role, executable] of requiredEntries) {
    const entry = entriesByPath.get(requiredPath);
    if (!entry)
      fail(`manifest is missing required payload file: ${requiredPath}`);
    if (entry.role !== role || entry.executable !== executable) {
      fail(`manifest has invalid role or executable metadata: ${requiredPath}`);
    }
  }
}

async function freezeDirectories(root, includeRoot = true) {
  const directories = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
    }
    directories.push(directory);
  }
  await visit(root);
  for (const directory of directories) {
    if (!includeRoot && directory === root) continue;
    await utimes(directory, FIXED_TIME_SECONDS, FIXED_TIME_SECONDS);
    await chmod(directory, 0o555);
  }
}

async function makeTreeRemovable(root) {
  const metadata = await lstat(root).catch(() => null);
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) return;
  await chmod(root, 0o755).catch(() => {});
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await makeTreeRemovable(path.join(root, entry.name));
    }
  }
}

export async function stageApplicationSlot(options) {
  for (const option of REQUIRED_STAGE_OPTIONS) {
    if (typeof options[option] !== "string" || options[option].length === 0)
      fail(`missing --${option}`);
  }
  validateBuildCoordinates(options);
  const releaseMetadata = await loadReleaseMetadata(
    options["release-metadata"],
    options,
  );
  const buildIdentity = await loadBuildIdentity(
    options["build-identity"],
    options["build-id"],
  );
  const executableSuffix = options.platform === "windows" ? ".exe" : "";
  await assertRegularFile(options["audio-node"], "audio-node binary");
  await assertRegularFile(options.supervisor, "supervisor binary");
  await assertRegularFile(options["node-runtime"], "Node runtime");
  await assertExecutableFormat(
    options["audio-node"],
    "audio-node binary",
    options.platform,
    options.arch,
  );
  await assertExecutableFormat(
    options.supervisor,
    "supervisor binary",
    options.platform,
    options.arch,
  );
  await assertExecutableFormat(
    options["node-runtime"],
    "Node runtime",
    options.platform,
    options.arch,
  );
  await assertRegularFile(options["node-license"], "Node licence");
  await assertRegularFile(
    options["process-contract"],
    "process-boundary contract",
  );
  await readAndValidateProcessBoundaryContract(options["process-contract"]);
  for (const [name, label] of [
    ["cargo-lock", "Cargo lockfile"],
    ["npm-lock", "npm lockfile"],
    ["cargo-inventory", "Cargo inventory"],
    ["node-inventory", "Node inventory"],
  ])
    await assertRegularFile(options[name], label);

  const backendFiles = await collectTree(
    options["backend-dist"],
    "backend dist",
  );
  assertAllowedExtensions(backendFiles, BACKEND_EXTENSIONS, "backend dist");
  requireRelativeFile(backendFiles, "start.js", "backend dist");
  const dependencyFiles = await validateBackendDependencies(
    options["backend-dependencies"],
  );
  const protocolFiles = await validateProtocolPackage(
    options["protocol-package"],
  );
  const managerFiles = await collectTree(
    options["manager-dist"],
    "Manager dist",
  );
  assertAllowedExtensions(managerFiles, WEB_EXTENSIONS, "Manager dist");
  requireRelativeFile(managerFiles, "index.html", "Manager dist");
  const liveFiles = await collectTree(options["live-dist"], "Live dist");
  assertAllowedExtensions(liveFiles, WEB_EXTENSIONS, "Live dist");
  requireRelativeFile(liveFiles, "index.html", "Live dist");

  const outputRoot = path.resolve(options["output-root"]);
  await mkdir(path.join(outputRoot, "slots"), { recursive: true, mode: 0o755 });
  const slotsMetadata = await lstat(path.join(outputRoot, "slots"));
  if (slotsMetadata.isSymbolicLink())
    fail("output slots directory must not be a symbolic link");
  const finalSlot = path.join(outputRoot, "slots", options["build-id"]);
  if (
    await lstat(finalSlot).then(
      () => true,
      () => false,
    )
  )
    fail(`slot already exists and will not be overwritten: ${finalSlot}`);
  const temporarySlot = path.join(
    outputRoot,
    "slots",
    `.staging-${process.pid}-${Date.now()}`,
  );
  await mkdir(temporarySlot, { mode: 0o755 });
  let published = false;

  try {
    const entries = [];
    entries.push(
      await copyEntry(
        options["audio-node"],
        temporarySlot,
        `bin/a2-synthetic-capture${executableSuffix}`,
        "audio_node",
        true,
      ),
      await copyEntry(
        options.supervisor,
        temporarySlot,
        `bin/a2-supervisor-smoke${executableSuffix}`,
        "supervisor",
        true,
      ),
      await copyEntry(
        options["node-runtime"],
        temporarySlot,
        `runtime/node${executableSuffix}`,
        "node_runtime",
        true,
      ),
      await copyEntry(
        options["node-license"],
        temporarySlot,
        "licenses/node/LICENSE",
        "license",
      ),
      await copyEntry(
        options["process-contract"],
        temporarySlot,
        "config/process-boundaries.v0.json",
        "process_contract",
      ),
    );
    entries.push(
      ...(await copyTree(
        backendFiles,
        temporarySlot,
        "backend/dist",
        "backend",
      )),
    );
    entries.push(
      await writeGeneratedEntry(
        temporarySlot,
        "backend/package.json",
        "backend",
        '{\n  "private": true,\n  "type": "module"\n}\n',
      ),
    );
    entries.push(
      ...(await copyTree(
        dependencyFiles,
        temporarySlot,
        "backend/node_modules",
        "backend_dependency",
      )),
    );
    entries.push(
      ...(await copyTree(
        protocolFiles.runtime,
        temporarySlot,
        "backend/node_modules/@rvlt/pulse-protocol",
        "protocol_runtime",
      )),
      ...(await copyTree(
        protocolFiles.schemas,
        temporarySlot,
        "backend/node_modules/@rvlt/pulse-protocol",
        "protocol_schema",
      )),
    );
    entries.push(
      ...(await copyTree(
        managerFiles,
        temporarySlot,
        "web/manager",
        "manager_asset",
      )),
    );
    entries.push(
      ...(await copyTree(liveFiles, temporarySlot, "web/live", "live_asset")),
    );
    entries.sort((left, right) => compareUtf8(left.path, right.path));

    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      artifactKind: "unsigned-smoke-slot",
      slotId: options["build-id"],
      buildId: options["build-id"],
      appVersion: buildIdentity.version,
      platform: options.platform,
      arch: options.arch,
      targetTriple: releaseMetadata.targetTriple,
      buildProfile: releaseMetadata.buildProfile,
      identityKind: buildIdentity.identityKind,
      sourceSha256: buildIdentity.sourceSha256,
      lockSha256: {
        cargo: await sha256File(options["cargo-lock"]),
        npm: await sha256File(options["npm-lock"]),
      },
      inventorySha256: {
        cargo: await sha256File(options["cargo-inventory"]),
        node: await sha256File(options["node-inventory"]),
      },
      toolchains: releaseMetadata.toolchains,
      entrypoints: {
        audioNode: `bin/a2-synthetic-capture${executableSuffix}`,
        backend: "backend/dist/start.js",
        nodeRuntime: `runtime/node${executableSuffix}`,
        supervisor: `bin/a2-supervisor-smoke${executableSuffix}`,
      },
      frontendRoots: { live: "web/live", manager: "web/manager" },
      protocolVersion: releaseMetadata.protocolVersion,
      files: entries,
    };
    validateManifestShape(manifest);
    const manifestPath = path.join(temporarySlot, MANIFEST_NAME);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o444,
    });
    await setFileMetadata(manifestPath, false);
    await freezeDirectories(temporarySlot, false);
    await utimes(temporarySlot, FIXED_TIME_SECONDS, FIXED_TIME_SECONDS);
    await rename(temporarySlot, finalSlot);
    published = true;
    await chmod(finalSlot, 0o555);
    return finalSlot;
  } catch (error) {
    const failedSlot = published ? finalSlot : temporarySlot;
    await makeTreeRemovable(failedSlot);
    await rm(failedSlot, { force: true, recursive: true });
    throw error;
  }
}

export async function verifyApplicationSlot(slot) {
  await assertDirectory(slot, "application slot");
  const manifestPath = path.join(slot, MANIFEST_NAME);
  await assertRegularFile(manifestPath, "slot manifest");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    fail(`slot manifest is not valid JSON: ${error.message}`);
  }
  validateManifestShape(manifest);

  const actualFiles = await collectTree(slot, "application slot");
  const actualPaths = actualFiles
    .map((file) => file.relativePath)
    .filter((entry) => entry !== MANIFEST_NAME)
    .sort(compareUtf8);
  const expectedPaths = manifest.files.map((entry) => entry.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    fail("slot contents do not exactly match the closed manifest");
  }
  for (const entry of manifest.files) {
    const filename = path.join(slot, ...entry.path.split("/"));
    const metadata = await stat(filename);
    if (metadata.size !== entry.size)
      fail(`slot file size mismatch: ${entry.path}`);
    if ((await sha256File(filename)) !== entry.sha256)
      fail(`slot file SHA-256 mismatch: ${entry.path}`);
    if (
      process.platform !== "win32" &&
      (metadata.mode & 0o777) !== Number.parseInt(entry.mode, 8)
    ) {
      fail(`slot file mode mismatch: ${entry.path}`);
    }
  }
  await readAndValidateProcessBoundaryContract(
    path.join(slot, "config", "process-boundaries.v0.json"),
  );
  return manifest;
}

function parseArguments(argv) {
  const [command, ...argumentsList] = argv;
  if (!new Set(["stage", "verify"]).has(command)) {
    fail("usage: stage-application-slot.mjs <stage|verify> [--name value ...]");
  }
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !flag?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      fail(`invalid argument near ${flag ?? "end of command"}`);
    }
    const name = flag.slice(2);
    if (Object.hasOwn(options, name)) fail(`duplicate option: ${flag}`);
    options[name] = value;
  }
  const allowed =
    command === "stage" ? new Set(REQUIRED_STAGE_OPTIONS) : new Set(["slot"]);
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) fail(`unknown option: --${name}`);
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "stage") {
    const slot = await stageApplicationSlot(options);
    process.stdout.write(`${slot}\n`);
  } else {
    if (typeof options.slot !== "string") fail("missing --slot");
    const manifest = await verifyApplicationSlot(path.resolve(options.slot));
    process.stdout.write(
      `verified ${manifest.buildId} (${manifest.files.length} files)\n`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`slot staging failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
