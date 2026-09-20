import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBuildIdentity,
  renderRustBuildIdentity,
  selectBuildIdentityPaths,
  serializeBuildIdentity,
} from "./generate-build-identity.mjs";

const entries = [
  { path: "src/b.rs", bytes: Buffer.from("bravo") },
  { path: "src/a.rs", bytes: Buffer.from("alpha") },
];

test("build identity is deterministic and independent of input order", () => {
  const first = createBuildIdentity(entries, "1.2.3");
  const reordered = createBuildIdentity([...entries].reverse(), "1.2.3");

  assert.equal(
    serializeBuildIdentity(first),
    serializeBuildIdentity(reordered),
  );
  assert.equal(first.inputCount, 2);
  assert.match(first.buildId, /^a2-1\.2\.3\+sha256\.[0-9a-f]{16}$/);
  assert.deepEqual(
    first.inputs.map((input) => input.path),
    ["src/a.rs", "src/b.rs"],
  );
});

test("content changes alter the build identifier", () => {
  const first = createBuildIdentity(entries, "1.2.3");
  const changed = createBuildIdentity(
    [{ path: "src/a.rs", bytes: Buffer.from("changed") }, entries[0]],
    "1.2.3",
  );
  assert.notEqual(first.buildId, changed.buildId);
  assert.notEqual(first.sourceSha256, changed.sourceSha256);
});

test("rejects ambiguous identity inputs", () => {
  assert.throws(() => createBuildIdentity([], "1.2.3"), /no source inputs/);
  for (const version of [undefined, null, "", " 1.2.3", "1.2", "UNKNOWN"]) {
    assert.throws(
      () => createBuildIdentity(entries, version),
      /SemVer-compatible/,
    );
  }
  assert.throws(
    () => createBuildIdentity([entries[0], entries[0]], "1.2.3"),
    /duplicate build identity input/,
  );
});

test("selects tracked inputs except identity and build output", () => {
  assert.deepEqual(
    selectBuildIdentityPaths([
      "assets/no-extension",
      ".gitattributes",
      "future.config",
      "docs/quality/build-identity.json",
      "crates/build-info/src/generated.rs",
      "target/debug/binary",
      "apps/live/dist/index.js",
      "z",
      "A",
    ]),
    [".gitattributes", "A", "assets/no-extension", "future.config", "z"],
  );
});

test("renders project-owned Rust constants without timestamps", () => {
  const rendered = renderRustBuildIdentity(
    createBuildIdentity(entries, "1.2.3"),
  );
  assert.match(rendered, /pub const BUILD_ID/);
  assert.match(rendered, /pub const SOURCE_SHA256/);
  assert.doesNotMatch(rendered, /timestamp|dirty/i);
});
