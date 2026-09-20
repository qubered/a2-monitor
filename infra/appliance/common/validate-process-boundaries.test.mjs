import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateProcessBoundaryContract } from "./validate-process-boundaries.mjs";

const source = JSON.parse(
  await readFile(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "process-boundaries.v0.json",
    ),
    "utf8",
  ),
);

function changed(mutator) {
  const value = structuredClone(source);
  mutator(value);
  return value;
}

test("accepts the closed scaffold process-boundary contract", () => {
  assert.equal(
    validateProcessBoundaryContract(structuredClone(source)).schemaVersion,
    1,
  );
});

test("rejects unknown fields, missing boundaries, and duplicate identities", () => {
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed((value) => (value.unknown = true)),
      ),
    /unexpected or missing keys/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed((value) => value.boundaries.pop()),
      ),
    /boundary IDs\/order/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed((value) => (value.boundaries[1].id = value.boundaries[0].id)),
      ),
    /boundary IDs\/order/,
  );
});

test("rejects runnable/planned artifact confusion and unverified privilege claims", () => {
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) => (value.boundaries[2].artifactEntrypoint = "supervisor"),
        ),
      ),
    /not runnable and must not name an artifact/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) => (value.boundaries[0].current.privilegeVerified = true),
        ),
      ),
    /must remain false/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) =>
            (value.boundaries[1].target.processCreator = "node-supervisor"),
        ),
      ),
    /must remain explicitly non-deployable/,
  );
});

test("rejects cross-tree ownership and target-parent cycles", () => {
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) =>
            (value.boundaries[10].target.parentBoundaryId = "node-supervisor"),
        ),
      ),
    /crosses process trees/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) =>
            (value.boundaries[2].target.parentBoundaryId = "audio-engine"),
        ),
      ),
    /target parent cycle/,
  );
});

test("rejects authority and Rust supervisor catalog drift", () => {
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed((value) => {
          value.boundaries[6].targetAuthorities.push("ledger-append");
          value.boundaries[6].targetAuthorities.sort();
          value.boundaries[6].targetForbiddenAuthorities =
            value.boundaries[6].targetForbiddenAuthorities.filter(
              (authority) => authority !== "ledger-append",
            );
        }),
      ),
    /sequencer must be the sole ledger-append authority/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) => (value.boundaries[6].rustWorker.readiness = "basic"),
        ),
      ),
    /does not match the supervisor catalog/,
  );
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed(
          (value) =>
            (value.boundaries[7].rustWorker.configurationOrder =
              value.boundaries[6].rustWorker.configurationOrder),
        ),
      ),
    /configuration order is duplicated|does not match the supervisor catalog/,
  );
});

test("rejects otherwise well-formed lifecycle and authority semantic drift", () => {
  for (const mutate of [
    (value) => (value.boundaries[10].accountableOwner = "nobody"),
    (value) =>
      (value.boundaries[10].current.restart = "production-restart-enabled"),
    (value) => (value.boundaries[10].target.privilege = "root"),
    (value) => (value.boundaries[10].boundaryKind = "native-worker"),
    (value) =>
      value.boundaries[10].currentAuthorities.push("z-invented-authority"),
  ]) {
    assert.throws(
      () => validateProcessBoundaryContract(changed(mutate)),
      /semantic digest .* does not match the closed v0 contract/,
    );
  }
});

test("rejects promotion of the storage thread to a separate security boundary", () => {
  assert.throws(
    () =>
      validateProcessBoundaryContract(
        changed((value) => (value.boundaries[11].boundaryKind = "os-process")),
      ),
    /planned, non-OS backend worker thread/,
  );
});
