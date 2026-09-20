import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setImmediate } from "node:timers";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ArtifactVerificationError,
  validateArtifactPath,
  verifyArtifactSet,
} from "./artifact-loader.mjs";

const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function descriptor(artifactPath, bytes, overrides = {}) {
  return {
    kind: "metrics",
    path: artifactPath,
    mediaType: "application/json",
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    ...overrides,
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "a2-artifacts-"));
  t.after(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert(error instanceof ArtifactVerificationError);
    assert.equal(error.code, code);
    return true;
  });
}

function captureRejection(promise) {
  return promise.then(
    () => undefined,
    (error) => error,
  );
}

test("validates portable relative paths", () => {
  assert.equal(
    validateArtifactPath("metrics/run-01.json"),
    "metrics/run-01.json",
  );
  for (const [value, code] of [
    ["", "ARTIFACT_PATH_INVALID"],
    ["/absolute", "ARTIFACT_PATH_ABSOLUTE"],
    ["//server/share", "ARTIFACT_PATH_ABSOLUTE"],
    ["C:/drive", "ARTIFACT_PATH_ABSOLUTE"],
    ["\\\\server\\share", "ARTIFACT_PATH_BACKSLASH"],
    ["\\\\?\\C:\\device", "ARTIFACT_PATH_BACKSLASH"],
    ["a\\b", "ARTIFACT_PATH_BACKSLASH"],
    ["../escape", "ARTIFACT_PATH_TRAVERSAL"],
    ["a/./b", "ARTIFACT_PATH_TRAVERSAL"],
    ["a//b", "ARTIFACT_PATH_TRAVERSAL"],
    ["file:stream", "ARTIFACT_PATH_ADS"],
    ["con", "ARTIFACT_PATH_RESERVED"],
    ["LPT9.txt", "ARTIFACT_PATH_RESERVED"],
    ["name.", "ARTIFACT_PATH_TRAILING_DOT_SPACE"],
    ["name ", "ARTIFACT_PATH_TRAILING_DOT_SPACE"],
    ["bad\0name", "ARTIFACT_PATH_NUL"],
    ["bad\nname", "ARTIFACT_PATH_CONTROL"],
    ["cafe\u0301.json", "ARTIFACT_PATH_NON_NFC"],
    ["caf\u00e9.json", "ARTIFACT_PATH_NON_PORTABLE"],
  ]) {
    assert.throws(
      () => validateArtifactPath(value),
      (error) => error.code === code,
    );
  }
  assert.throws(
    () => validateArtifactPath(`${"a".repeat(256)}.json`),
    (error) => error.code === "ARTIFACT_PATH_SEGMENT_TOO_LONG",
  );
});

test("streams verified bytes once and exposes only defensive copies", async (t) => {
  const root = await fixture(t);
  const bytes = Buffer.from('{"value":7}\n');
  await mkdir(path.join(root, "metrics"));
  await writeFile(path.join(root, "metrics/run.json"), bytes);
  const result = await verifyArtifactSet({
    root,
    artifacts: [
      descriptor("metrics/run.json", bytes, {
        kind: "runner-log",
        mediaType: "text/plain",
      }),
    ],
  });

  assert.equal(result.totalBytes, bytes.byteLength);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.artifacts));
  assert(Object.isFrozen(result.artifacts[0]));
  assert.equal(
    result.byKind("runner-log")[0],
    result.byPath("metrics/run.json"),
  );
  assert.deepEqual(
    result.descriptors[0],
    descriptor("metrics/run.json", bytes, {
      kind: "runner-log",
      mediaType: "text/plain",
    }),
  );
  assert.equal(result.artifacts[0].declaredBytes, bytes.byteLength);
  assert.equal(result.artifacts[0].content.utf8(), bytes.toString("utf8"));
  const copy = result.artifacts[0].content.copy();
  copy[0] = 0;
  assert.equal(result.artifacts[0].content.copy()[0], bytes[0]);
});

test("rejects malformed descriptors before filesystem access", async () => {
  const missingRoot = path.join(tmpdir(), "a2-definitely-missing-root");
  await expectCode(
    verifyArtifactSet({
      root: missingRoot,
      artifacts: [
        {
          kind: "metrics",
          path: "a",
          mediaType: "application/json",
          bytes: 0,
          sha256: "0".repeat(64),
          extra: true,
        },
      ],
    }),
    "ARTIFACT_DESCRIPTOR_INVALID",
  );
  await expectCode(
    verifyArtifactSet({
      root: missingRoot,
      artifacts: [{ ...descriptor("a", Buffer.alloc(0)), kind: "Bad" }],
    }),
    "ARTIFACT_KIND_INVALID",
  );
  await expectCode(
    verifyArtifactSet({
      root: missingRoot,
      artifacts: [
        {
          ...descriptor("a", Buffer.alloc(0)),
          mediaType: "APPLICATION/JSON",
        },
      ],
    }),
    "ARTIFACT_MEDIA_TYPE_INVALID",
  );
  await expectCode(
    verifyArtifactSet({
      root: missingRoot,
      artifacts: [{ ...descriptor("a", Buffer.alloc(0)), bytes: -1 }],
    }),
    "ARTIFACT_BYTES_INVALID",
  );
  await expectCode(
    verifyArtifactSet({
      root: missingRoot,
      artifacts: [
        { ...descriptor("a", Buffer.alloc(0)), sha256: "A".repeat(64) },
      ],
    }),
    "ARTIFACT_SHA256_INVALID",
  );
});

test("rejects duplicate and case-fold-colliding paths", async () => {
  const bytes = Buffer.from("x");
  await expectCode(
    verifyArtifactSet({
      root: "/missing",
      artifacts: [descriptor("a", bytes), descriptor("a", bytes)],
    }),
    "ARTIFACT_PATH_DUPLICATE",
  );
  await expectCode(
    verifyArtifactSet({
      root: "/missing",
      artifacts: [descriptor("A/file", bytes), descriptor("a/file", bytes)],
    }),
    "ARTIFACT_PATH_CASE_COLLISION",
  );
});

test("enforces descriptor count, per-file and total caps before reads", async () => {
  const bytes = Buffer.from("1234");
  await expectCode(
    verifyArtifactSet({
      root: "/missing",
      artifacts: [descriptor("a", bytes), descriptor("b", bytes)],
      limits: { maxArtifacts: 1 },
    }),
    "ARTIFACT_COUNT_LIMIT",
  );
  await expectCode(
    verifyArtifactSet({
      root: "/missing",
      artifacts: [descriptor("a", bytes)],
      limits: { maxFileBytes: 3 },
    }),
    "ARTIFACT_FILE_LIMIT",
  );
  await expectCode(
    verifyArtifactSet({
      root: "/missing",
      artifacts: [descriptor("a", bytes), descriptor("b", bytes)],
      limits: { maxTotalBytes: 7 },
    }),
    "ARTIFACT_TOTAL_LIMIT",
  );
  await expectCode(
    verifyArtifactSet({
      root: "/missing",
      artifacts: [],
      limits: { surprise: 1 },
    }),
    "ARTIFACT_LIMITS_INVALID",
  );
  for (const limits of [
    { maxArtifacts: 257 },
    { maxFileBytes: 64 * 1024 * 1024 + 1 },
    { maxTotalBytes: 256 * 1024 * 1024 + 1 },
  ]) {
    await expectCode(
      verifyArtifactSet({ root: "/missing", artifacts: [], limits }),
      "ARTIFACT_LIMITS_INVALID",
    );
  }
});

test("rejects distinct paths that hard-link the same file", async (t) => {
  const root = await fixture(t);
  const bytes = Buffer.from("shared bytes");
  await writeFile(path.join(root, "first"), bytes);
  await link(path.join(root, "first"), path.join(root, "second"));
  await expectCode(
    verifyArtifactSet({
      root,
      artifacts: [descriptor("first", bytes), descriptor("second", bytes)],
    }),
    "ARTIFACT_IDENTITY_ALIAS",
  );
});

test("rejects relative, missing, symlink and non-directory roots", async (t) => {
  await expectCode(
    verifyArtifactSet({ root: "relative", artifacts: [] }),
    "ARTIFACT_ROOT_INVALID",
  );
  await expectCode(
    verifyArtifactSet({
      root: path.join(tmpdir(), "missing-a2-root"),
      artifacts: [],
    }),
    "ARTIFACT_ROOT_MISSING",
  );
  const parent = await fixture(t);
  const file = path.join(parent, "file");
  await writeFile(file, "x");
  await expectCode(
    verifyArtifactSet({ root: file, artifacts: [] }),
    "ARTIFACT_ROOT_INVALID",
  );
  const link = path.join(parent, "root-link");
  await symlink(parent, link, "dir");
  await expectCode(
    verifyArtifactSet({ root: link, artifacts: [] }),
    "ARTIFACT_ROOT_INVALID",
  );
});

test("rejects root, intermediate and final symlinks", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const bytes = Buffer.from("secret");
  await writeFile(path.join(outside, "value"), bytes);
  await symlink(outside, path.join(root, "linked-dir"), "dir");
  await symlink(
    path.join(outside, "value"),
    path.join(root, "linked-file"),
    "file",
  );
  await expectCode(
    verifyArtifactSet({
      root,
      artifacts: [descriptor("linked-dir/value", bytes)],
    }),
    "ARTIFACT_SYMLINK",
  );
  await expectCode(
    verifyArtifactSet({ root, artifacts: [descriptor("linked-file", bytes)] }),
    "ARTIFACT_SYMLINK",
  );
});

test("rejects directories and non-directory intermediate components", async (t) => {
  const root = await fixture(t);
  const bytes = Buffer.from("x");
  await mkdir(path.join(root, "directory"));
  await writeFile(path.join(root, "plain"), bytes);
  await expectCode(
    verifyArtifactSet({ root, artifacts: [descriptor("directory", bytes)] }),
    "ARTIFACT_NOT_REGULAR",
  );
  await expectCode(
    verifyArtifactSet({ root, artifacts: [descriptor("plain/child", bytes)] }),
    "ARTIFACT_INTERMEDIATE_INVALID",
  );
});

test("rejects FIFO and other non-regular final entries where supported", async (t) => {
  if (process.platform === "win32") return;
  const root = await fixture(t);
  const fifo = path.join(root, "pipe");
  try {
    await execFileAsync("mkfifo", [fifo]);
  } catch {
    t.skip("mkfifo is unavailable");
    return;
  }
  await expectCode(
    verifyArtifactSet({
      root,
      artifacts: [descriptor("pipe", Buffer.alloc(0))],
    }),
    "ARTIFACT_NOT_REGULAR",
  );
});

test("rejects missing, wrong-length and tampered artifact bytes", async (t) => {
  const root = await fixture(t);
  const bytes = Buffer.from("expected");
  await expectCode(
    verifyArtifactSet({ root, artifacts: [descriptor("missing", bytes)] }),
    "ARTIFACT_MISSING",
  );
  await writeFile(path.join(root, "value"), bytes);
  await expectCode(
    verifyArtifactSet({
      root,
      artifacts: [{ ...descriptor("value", bytes), bytes: bytes.length - 1 }],
    }),
    "ARTIFACT_LENGTH_MISMATCH",
  );
  await expectCode(
    verifyArtifactSet({
      root,
      artifacts: [{ ...descriptor("value", bytes), sha256: "0".repeat(64) }],
    }),
    "ARTIFACT_SHA256_MISMATCH",
  );
});

test("rejects invalid UTF-8 only when a consumer requests text", async (t) => {
  const root = await fixture(t);
  const bytes = Buffer.from([0xff, 0xfe]);
  await writeFile(path.join(root, "binary"), bytes);
  const result = await verifyArtifactSet({
    root,
    artifacts: [descriptor("binary", bytes)],
  });
  assert.throws(
    () => result.artifacts[0].content.utf8(),
    (error) => error.code === "ARTIFACT_UTF8_INVALID",
  );
});

test("detects a final-path swap while retaining the originally opened bytes", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not permit replacing an open file");
    return;
  }
  const root = await fixture(t);
  const size = 24 * 1024 * 1024;
  const original = Buffer.alloc(size, 0x61);
  const replacement = Buffer.alloc(size, 0x62);
  await writeFile(path.join(root, "large"), original);
  await writeFile(path.join(root, "replacement"), replacement);
  const verifying = captureRejection(
    verifyArtifactSet({
      root,
      artifacts: [descriptor("large", original)],
      limits: { maxFileBytes: size, maxTotalBytes: size },
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await rename(path.join(root, "replacement"), path.join(root, "large"));
  const error = await verifying;
  assert(error instanceof ArtifactVerificationError);
  assert(
    [
      "ARTIFACT_CHANGED",
      "ARTIFACT_ROOT_CHANGED",
      "ARTIFACT_SHA256_MISMATCH",
    ].includes(error.code),
  );
});
