import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants, lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";

const DEFAULT_LIMITS = Object.freeze({
  maxArtifacts: 256,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});
const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_LIMITS).sort());
const DESCRIPTOR_KEYS = Object.freeze([
  "bytes",
  "kind",
  "mediaType",
  "path",
  "sha256",
]);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PATH_BYTES = 1_024;
const MAX_SEGMENT_BYTES = 255;
const READ_CHUNK_BYTES = 64 * 1024;

export class ArtifactVerificationError extends Error {
  constructor(code, message, artifactPath) {
    super(message);
    this.name = "ArtifactVerificationError";
    this.code = code;
    if (artifactPath !== undefined) this.artifactPath = artifactPath;
  }
}

/**
 * Immutable access to verified artifact bytes.
 *
 * The underlying Buffer is private. `copy()` returns a defensive copy and
 * `utf8()` performs fatal UTF-8 decoding for JSON/metrics consumers.
 */
export class VerifiedArtifactBytes {
  #bytes;

  constructor(bytes) {
    this.#bytes = Buffer.from(bytes);
    Object.freeze(this);
  }

  get byteLength() {
    return this.#bytes.byteLength;
  }

  copy() {
    return Buffer.from(this.#bytes);
  }

  utf8() {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.#bytes);
    } catch {
      throw new ArtifactVerificationError(
        "ARTIFACT_UTF8_INVALID",
        "verified artifact is not valid UTF-8",
      );
    }
  }
}

function fail(code, message, artifactPath) {
  throw new ArtifactVerificationError(code, message, artifactPath);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function assertPlainObject(value, label, code) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail(code, `${label} must be an object`);
  }
}

function sameKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

/**
 * Validates and returns a canonical portable relative artifact path.
 */
export function validateArtifactPath(artifactPath) {
  if (typeof artifactPath !== "string" || artifactPath.length === 0) {
    fail("ARTIFACT_PATH_INVALID", "artifact path must be a non-empty string");
  }
  if (artifactPath.includes("\0")) {
    fail(
      "ARTIFACT_PATH_NUL",
      "artifact path must not contain NUL",
      artifactPath,
    );
  }
  if (artifactPath !== artifactPath.normalize("NFC")) {
    fail("ARTIFACT_PATH_NON_NFC", "artifact path must use NFC", artifactPath);
  }
  if (
    artifactPath.startsWith("/") ||
    artifactPath.startsWith("//") ||
    /^[A-Za-z]:/.test(artifactPath)
  ) {
    fail(
      "ARTIFACT_PATH_ABSOLUTE",
      "artifact path must be relative",
      artifactPath,
    );
  }
  if (artifactPath.includes("\\")) {
    fail(
      "ARTIFACT_PATH_BACKSLASH",
      "artifact path must use portable forward slashes",
      artifactPath,
    );
  }
  if (artifactPath.includes(":")) {
    fail(
      "ARTIFACT_PATH_ADS",
      "artifact path must not contain drive or alternate-stream syntax",
      artifactPath,
    );
  }
  if (byteLength(artifactPath) > MAX_PATH_BYTES) {
    fail("ARTIFACT_PATH_TOO_LONG", "artifact path is too long", artifactPath);
  }

  const segments = artifactPath.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      fail(
        "ARTIFACT_PATH_TRAVERSAL",
        "artifact path contains an empty or traversal segment",
        artifactPath,
      );
    }
    if (hasControlCharacter(segment)) {
      fail(
        "ARTIFACT_PATH_CONTROL",
        "artifact path contains a control character",
        artifactPath,
      );
    }
    if (/[. ]$/u.test(segment)) {
      fail(
        "ARTIFACT_PATH_TRAILING_DOT_SPACE",
        "artifact path segment ends in a dot or space",
        artifactPath,
      );
    }
    if (WINDOWS_RESERVED.test(segment)) {
      fail(
        "ARTIFACT_PATH_RESERVED",
        "artifact path contains a reserved Windows name",
        artifactPath,
      );
    }
    if (byteLength(segment) > MAX_SEGMENT_BYTES) {
      fail(
        "ARTIFACT_PATH_SEGMENT_TOO_LONG",
        "artifact path segment is too long",
        artifactPath,
      );
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      fail(
        "ARTIFACT_PATH_NON_PORTABLE",
        "artifact path segments must use portable ASCII characters",
        artifactPath,
      );
    }
  }
  return artifactPath;
}

function validateLimits(overrides) {
  if (overrides === undefined) return DEFAULT_LIMITS;
  assertPlainObject(overrides, "artifact limits", "ARTIFACT_LIMITS_INVALID");
  const keys = Object.keys(overrides).sort();
  if (keys.some((key) => !LIMIT_KEYS.includes(key))) {
    fail("ARTIFACT_LIMITS_INVALID", "artifact limits contain an unknown field");
  }
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of LIMIT_KEYS) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      fail(
        "ARTIFACT_LIMITS_INVALID",
        `artifact limit ${key} must be a positive safe integer`,
      );
    }
    if (limits[key] > DEFAULT_LIMITS[key]) {
      fail(
        "ARTIFACT_LIMITS_INVALID",
        `artifact limit ${key} exceeds its immutable hard ceiling`,
      );
    }
  }
  return Object.freeze(limits);
}

function validateDescriptors(artifacts, limits) {
  if (!Array.isArray(artifacts)) {
    fail("ARTIFACT_DESCRIPTORS_INVALID", "artifacts must be an array");
  }
  if (artifacts.length > limits.maxArtifacts) {
    fail("ARTIFACT_COUNT_LIMIT", "artifact count exceeds the configured limit");
  }

  const exactPaths = new Set();
  const foldedPaths = new Map();
  let declaredTotal = 0;
  return artifacts.map((descriptor) => {
    assertPlainObject(
      descriptor,
      "artifact descriptor",
      "ARTIFACT_DESCRIPTOR_INVALID",
    );
    if (!sameKeys(descriptor, DESCRIPTOR_KEYS)) {
      fail(
        "ARTIFACT_DESCRIPTOR_INVALID",
        "artifact descriptor must contain exactly bytes, kind, mediaType, path and sha256",
      );
    }
    const artifactPath = validateArtifactPath(descriptor.path);
    if (!KIND_PATTERN.test(descriptor.kind)) {
      fail(
        "ARTIFACT_KIND_INVALID",
        "artifact kind must be a bounded lowercase hyphenated identifier",
        artifactPath,
      );
    }
    if (
      typeof descriptor.mediaType !== "string" ||
      descriptor.mediaType.length > 127 ||
      !MEDIA_TYPE_PATTERN.test(descriptor.mediaType)
    ) {
      fail(
        "ARTIFACT_MEDIA_TYPE_INVALID",
        "artifact mediaType must be a bounded lowercase type/subtype",
        artifactPath,
      );
    }
    if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 0) {
      fail(
        "ARTIFACT_BYTES_INVALID",
        "artifact bytes must be a non-negative safe integer",
        artifactPath,
      );
    }
    if (descriptor.bytes > limits.maxFileBytes) {
      fail(
        "ARTIFACT_FILE_LIMIT",
        "declared artifact bytes exceed the per-file limit",
        artifactPath,
      );
    }
    if (!SHA256_PATTERN.test(descriptor.sha256)) {
      fail(
        "ARTIFACT_SHA256_INVALID",
        "artifact SHA-256 must be 64 lowercase hexadecimal characters",
        artifactPath,
      );
    }
    if (exactPaths.has(artifactPath)) {
      fail(
        "ARTIFACT_PATH_DUPLICATE",
        "artifact path is duplicated",
        artifactPath,
      );
    }
    exactPaths.add(artifactPath);
    const folded = artifactPath.toLowerCase();
    const prior = foldedPaths.get(folded);
    if (prior !== undefined && prior !== artifactPath) {
      fail(
        "ARTIFACT_PATH_CASE_COLLISION",
        `artifact path collides case-insensitively with ${prior}`,
        artifactPath,
      );
    }
    foldedPaths.set(folded, artifactPath);
    declaredTotal += descriptor.bytes;
    if (
      !Number.isSafeInteger(declaredTotal) ||
      declaredTotal > limits.maxTotalBytes
    ) {
      fail(
        "ARTIFACT_TOTAL_LIMIT",
        "declared artifact bytes exceed the total limit",
      );
    }
    return Object.freeze({ ...descriptor, path: artifactPath });
  });
}

function identity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mode: stat.mode,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function sameIdentity(left, right, includeTimes = true) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    (!includeTimes ||
      (left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs))
  );
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function stableRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    fail("ARTIFACT_ROOT_INVALID", "artifact root must be an absolute path");
  }
  const before = await lstat(root, { bigint: true }).catch(() =>
    fail("ARTIFACT_ROOT_MISSING", "artifact root does not exist"),
  );
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail(
      "ARTIFACT_ROOT_INVALID",
      "artifact root must be a real directory, not a symlink",
    );
  }
  const canonical = await realpath(root);
  const after = await lstat(root, { bigint: true });
  if (!sameIdentity(identity(before), identity(after))) {
    fail("ARTIFACT_ROOT_CHANGED", "artifact root changed during validation");
  }
  return Object.freeze({
    supplied: path.normalize(root),
    canonical,
    identity: identity(after),
  });
}

async function assertRootStable(rootState) {
  const current = await lstat(rootState.supplied, { bigint: true }).catch(() =>
    fail(
      "ARTIFACT_ROOT_CHANGED",
      "artifact root disappeared during verification",
    ),
  );
  const canonical = await realpath(rootState.supplied).catch(() =>
    fail("ARTIFACT_ROOT_CHANGED", "artifact root became unresolved"),
  );
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    canonical !== rootState.canonical ||
    !sameIdentity(rootState.identity, identity(current))
  ) {
    fail("ARTIFACT_ROOT_CHANGED", "artifact root changed during verification");
  }
}

async function inspectPath(rootState, artifactPath) {
  let current = rootState.supplied;
  const segments = artifactPath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const metadata = await lstat(current, { bigint: true }).catch(() =>
      fail("ARTIFACT_MISSING", "artifact path does not exist", artifactPath),
    );
    if (metadata.isSymbolicLink()) {
      fail(
        "ARTIFACT_SYMLINK",
        "artifact path contains a symlink",
        artifactPath,
      );
    }
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      fail(
        "ARTIFACT_INTERMEDIATE_INVALID",
        "artifact path contains a non-directory intermediate component",
        artifactPath,
      );
    }
    if (index === segments.length - 1 && !metadata.isFile()) {
      fail(
        "ARTIFACT_NOT_REGULAR",
        "artifact must be a regular file",
        artifactPath,
      );
    }
  }
  const canonical = await realpath(current);
  if (!isWithin(rootState.canonical, canonical)) {
    fail(
      "ARTIFACT_ESCAPES_ROOT",
      "artifact resolves outside its root",
      artifactPath,
    );
  }
  return Object.freeze({
    filename: current,
    canonical,
    identity: identity(await lstat(current, { bigint: true })),
  });
}

async function verifyOne(
  rootState,
  descriptor,
  limits,
  totalRead,
  openedIdentities,
  testHooks,
) {
  await assertRootStable(rootState);
  const pathState = await inspectPath(rootState, descriptor.path);
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(pathState.filename, constants.O_RDONLY | noFollow);
  } catch {
    fail(
      "ARTIFACT_OPEN_FAILED",
      "artifact could not be opened safely",
      descriptor.path,
    );
  }

  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) {
      fail(
        "ARTIFACT_NOT_REGULAR",
        "opened artifact is not a regular file",
        descriptor.path,
      );
    }
    const openedIdentity = identity(opened);
    if (!sameIdentity(pathState.identity, openedIdentity)) {
      fail(
        "ARTIFACT_CHANGED",
        "artifact changed before it was opened",
        descriptor.path,
      );
    }
    const identityKey = `${openedIdentity.dev}:${openedIdentity.ino}`;
    if (openedIdentities.has(identityKey)) {
      fail(
        "ARTIFACT_IDENTITY_ALIAS",
        "artifact path aliases an already opened file",
        descriptor.path,
      );
    }
    openedIdentities.add(identityKey);
    if (opened.size > BigInt(limits.maxFileBytes)) {
      fail(
        "ARTIFACT_FILE_LIMIT",
        "artifact exceeds the per-file limit",
        descriptor.path,
      );
    }
    if (testHooks?.afterOpen !== undefined) {
      await testHooks.afterOpen(
        Object.freeze({ path: descriptor.path, filename: pathState.filename }),
      );
    }

    const hash = createHash("sha256");
    const chunks = [];
    let observed = 0;
    const stream = handle.createReadStream({
      autoClose: false,
      highWaterMark: READ_CHUNK_BYTES,
      start: 0,
    });
    try {
      for await (const chunk of stream) {
        observed += chunk.byteLength;
        if (observed > limits.maxFileBytes) {
          fail(
            "ARTIFACT_FILE_LIMIT",
            "artifact exceeds the per-file limit",
            descriptor.path,
          );
        }
        if (totalRead.value + observed > limits.maxTotalBytes) {
          fail("ARTIFACT_TOTAL_LIMIT", "artifact bytes exceed the total limit");
        }
        hash.update(chunk);
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error instanceof ArtifactVerificationError) throw error;
      fail(
        "ARTIFACT_READ_FAILED",
        "artifact could not be read",
        descriptor.path,
      );
    }
    const postRead = identity(await handle.stat({ bigint: true }));
    if (!sameIdentity(openedIdentity, postRead)) {
      fail(
        "ARTIFACT_CHANGED",
        "artifact changed while it was read",
        descriptor.path,
      );
    }
    if (observed !== descriptor.bytes) {
      fail(
        "ARTIFACT_LENGTH_MISMATCH",
        "artifact length does not match",
        descriptor.path,
      );
    }
    const digest = hash.digest("hex");
    if (digest !== descriptor.sha256) {
      fail(
        "ARTIFACT_SHA256_MISMATCH",
        "artifact SHA-256 does not match",
        descriptor.path,
      );
    }

    await assertRootStable(rootState);
    const postPath = await inspectPath(rootState, descriptor.path);
    if (
      postPath.canonical !== pathState.canonical ||
      !sameIdentity(openedIdentity, postPath.identity)
    ) {
      fail(
        "ARTIFACT_CHANGED",
        "artifact path changed after it was read",
        descriptor.path,
      );
    }
    totalRead.value += observed;
    return Object.freeze({
      kind: descriptor.kind,
      path: descriptor.path,
      mediaType: descriptor.mediaType,
      declaredBytes: descriptor.bytes,
      sha256: descriptor.sha256,
      content: new VerifiedArtifactBytes(Buffer.concat(chunks, observed)),
    });
  } finally {
    await handle.close();
  }
}

/**
 * Opens and verifies a closed set of artifact descriptors beneath `root`.
 *
 * Each artifact is opened once. Path, root, inode, size and timestamps are
 * checked around the streamed read because portable Node.js does not expose
 * `openat`. Returned entries and descriptors are frozen; raw bytes are exposed
 * only through defensive copies or fatal UTF-8 decoding. `descriptors`
 * preserves the exact `{ bytes, kind, mediaType, path, sha256 }` contract.
 * `artifacts`, `byPath()` and `byKind()` expose verified entries shaped as
 * `{ declaredBytes, kind, mediaType, path, sha256, content }`, where `content`
 * is a `VerifiedArtifactBytes` instance.
 */
export async function verifyArtifactSet({
  root,
  artifacts,
  limits,
  testHooks,
} = {}) {
  if (
    testHooks !== undefined &&
    (testHooks === null ||
      typeof testHooks !== "object" ||
      typeof testHooks.afterOpen !== "function" ||
      Object.keys(testHooks).length !== 1)
  ) {
    fail("ARTIFACT_TEST_HOOK_INVALID", "artifact test hook is invalid");
  }
  const checkedLimits = validateLimits(limits);
  const descriptors = validateDescriptors(artifacts, checkedLimits);
  const rootState = await stableRoot(root);
  const totalRead = { value: 0 };
  const openedIdentities = new Set();
  const verified = [];
  for (const descriptor of descriptors) {
    verified.push(
      await verifyOne(
        rootState,
        descriptor,
        checkedLimits,
        totalRead,
        openedIdentities,
        testHooks,
      ),
    );
  }
  await assertRootStable(rootState);
  const frozenArtifacts = Object.freeze(verified);
  return Object.freeze({
    descriptors: Object.freeze(
      descriptors.map((descriptor) => Object.freeze({ ...descriptor })),
    ),
    artifacts: frozenArtifacts,
    totalBytes: totalRead.value,
    byPath(artifactPath) {
      return frozenArtifacts.find((artifact) => artifact.path === artifactPath);
    },
    byKind(kind) {
      return Object.freeze(
        frozenArtifacts.filter((artifact) => artifact.kind === kind),
      );
    },
  });
}
