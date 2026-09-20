#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_BOUNDARY_IDS = [
  "node-supervisor-smoke",
  "synthetic-capture-smoke",
  "node-supervisor",
  "audio-engine",
  "sequencer",
  "replay-worker",
  "media-worker",
  "receiver-adapter",
  "client-gateway",
  "backend-supervisor",
  "backend",
  "storage-worker",
];
const TOP_LEVEL_KEYS = [
  "boundaries",
  "deploymentState",
  "kind",
  "profileId",
  "schemaVersion",
];
const BOUNDARY_KEYS = [
  "accountableOwner",
  "artifactEntrypoint",
  "boundaryKind",
  "current",
  "currentAuthorities",
  "id",
  "implementationState",
  "rustWorker",
  "target",
  "targetAuthorities",
  "targetForbiddenAuthorities",
  "tree",
];
const EXPECTED_CONTRACT_SHA256 =
  "745c09323d6a0a20b8f7db433161bb77915f9f61ac8bb5973ee42aa21ab48b9b";
const LIFECYCLE_KEYS = [
  "parentBoundaryId",
  "privilege",
  "processCreator",
  "readiness",
  "restart",
  "shutdown",
];
const CURRENT_KEYS = [...LIFECYCLE_KEYS, "privilegeVerified"].sort();
const RUST_WORKER_KEYS = [
  "cardinality",
  "configurationOrder",
  "readiness",
  "role",
];
const RUNNABLE_ENTRYPOINTS = new Map([
  ["audioNode", "synthetic-capture-smoke"],
  ["backend", "backend"],
  ["supervisor", "node-supervisor-smoke"],
]);
const RUST_WORKERS = new Map([
  ["audio-engine", ["singleton", "device-verified", 1]],
  ["sequencer", ["singleton", "ledger-checked", 2]],
  ["replay", ["singleton", "basic", 3]],
  ["media", ["sharded-one-or-more", "fresh-media-sessions", 4]],
  ["receiver-adapter", ["sharded-zero-or-more", "basic", 5]],
  ["client-gateway", ["singleton", "basic", 6]],
]);
const IMPLEMENTATION_STATES = new Set([
  "planned-process",
  "planned-thread",
  "policy-model-only",
  "runnable-scaffold",
]);
const BOUNDARY_KINDS = new Set([
  "native-worker",
  "os-process",
  "worker-thread",
]);

function fail(message) {
  throw new Error(`Invalid process-boundary contract: ${message}`);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertClosedObject(value, expectedKeys, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has unexpected or missing keys: ${actual.join(", ")}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertStringSet(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string array`);
  }
  for (const item of value) assertNonEmptyString(item, label);
  const sorted = [...value].sort();
  if (
    new Set(value).size !== value.length ||
    JSON.stringify(value) !== JSON.stringify(sorted)
  ) {
    fail(`${label} must contain unique byte-sorted values`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function assertLifecycle(value, label, current) {
  assertClosedObject(value, current ? CURRENT_KEYS : LIFECYCLE_KEYS, label);
  if (value.parentBoundaryId !== null) {
    assertNonEmptyString(value.parentBoundaryId, `${label}.parentBoundaryId`);
  }
  for (const key of LIFECYCLE_KEYS.filter(
    (key) => key !== "parentBoundaryId",
  )) {
    assertNonEmptyString(value[key], `${label}.${key}`);
  }
  if (current && value.privilegeVerified !== false) {
    fail(
      `${label}.privilegeVerified must remain false until named-host evidence exists`,
    );
  }
}

function assertNoParentCycle(boundary, byId) {
  const visited = new Set([boundary.id]);
  let parentId = boundary.target.parentBoundaryId;
  while (parentId !== null) {
    if (visited.has(parentId))
      fail(`target parent cycle includes ${boundary.id}`);
    visited.add(parentId);
    parentId = byId.get(parentId).target.parentBoundaryId;
  }
}

export function validateProcessBoundaryContract(contract) {
  assertClosedObject(contract, TOP_LEVEL_KEYS, "root");
  if (
    contract.schemaVersion !== 1 ||
    contract.kind !== "a2-process-boundaries" ||
    contract.profileId !== "phase-0t-scaffold" ||
    contract.deploymentState !== "scaffold-only"
  ) {
    fail("root identity must describe the closed Phase 0T scaffold profile");
  }
  if (!Array.isArray(contract.boundaries)) fail("boundaries must be an array");
  const actualIds = contract.boundaries.map((boundary) => boundary?.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(EXPECTED_BOUNDARY_IDS)) {
    fail(
      `boundary IDs/order must be exactly ${EXPECTED_BOUNDARY_IDS.join(", ")}`,
    );
  }
  const byId = new Map(
    contract.boundaries.map((boundary) => [boundary.id, boundary]),
  );

  const seenEntrypoints = new Map();
  const seenRustRoles = new Map();
  const configurationOrders = new Set();
  for (const boundary of contract.boundaries) {
    assertClosedObject(boundary, BOUNDARY_KEYS, `boundary ${boundary.id}`);
    if (!new Set(["node", "backend"]).has(boundary.tree)) {
      fail(`${boundary.id}.tree is unsupported`);
    }
    if (!BOUNDARY_KINDS.has(boundary.boundaryKind)) {
      fail(`${boundary.id}.boundaryKind is unsupported`);
    }
    if (!IMPLEMENTATION_STATES.has(boundary.implementationState)) {
      fail(`${boundary.id}.implementationState is unsupported`);
    }
    assertNonEmptyString(
      boundary.accountableOwner,
      `${boundary.id}.accountableOwner`,
    );
    assertStringSet(
      boundary.currentAuthorities,
      `${boundary.id}.currentAuthorities`,
      {
        allowEmpty: true,
      },
    );
    assertStringSet(
      boundary.targetAuthorities,
      `${boundary.id}.targetAuthorities`,
      { allowEmpty: boundary.id.endsWith("-smoke") },
    );
    assertStringSet(
      boundary.targetForbiddenAuthorities,
      `${boundary.id}.targetForbiddenAuthorities`,
    );
    for (const authority of boundary.targetAuthorities) {
      if (boundary.targetForbiddenAuthorities.includes(authority)) {
        fail(`${boundary.id} both allows and forbids ${authority}`);
      }
    }
    assertLifecycle(boundary.current, `${boundary.id}.current`, true);
    assertLifecycle(boundary.target, `${boundary.id}.target`, false);
    if (boundary.current.parentBoundaryId !== null) {
      fail(
        `${boundary.id} must not claim current supervision before a launcher exists`,
      );
    }

    if (boundary.implementationState === "runnable-scaffold") {
      assertNonEmptyString(
        boundary.artifactEntrypoint,
        `${boundary.id}.artifactEntrypoint`,
      );
      if (!RUNNABLE_ENTRYPOINTS.has(boundary.artifactEntrypoint)) {
        fail(`${boundary.id} names an unsupported runnable entrypoint`);
      }
      if (seenEntrypoints.has(boundary.artifactEntrypoint)) {
        fail(`${boundary.artifactEntrypoint} is assigned more than once`);
      }
      seenEntrypoints.set(boundary.artifactEntrypoint, boundary.id);
    } else if (boundary.artifactEntrypoint !== null) {
      fail(`${boundary.id} is not runnable and must not name an artifact`);
    }

    if (boundary.id.endsWith("-smoke")) {
      if (
        boundary.target.parentBoundaryId !== null ||
        LIFECYCLE_KEYS.filter((key) => key !== "parentBoundaryId").some(
          (key) => boundary.target[key] !== "not-deployable-smoke",
        )
      ) {
        fail(`${boundary.id} must remain explicitly non-deployable`);
      }
    }

    const parentId = boundary.target.parentBoundaryId;
    if (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent)
        fail(`${boundary.id} references missing target parent ${parentId}`);
      if (parent.tree !== boundary.tree) {
        fail(`${boundary.id} target parent crosses process trees`);
      }
    }

    if (boundary.rustWorker === null) {
      if (boundary.implementationState === "policy-model-only") {
        fail(`${boundary.id} policy model is missing rustWorker metadata`);
      }
    } else {
      assertClosedObject(
        boundary.rustWorker,
        RUST_WORKER_KEYS,
        `${boundary.id}.rustWorker`,
      );
      const expected = RUST_WORKERS.get(boundary.rustWorker.role);
      if (!expected) fail(`${boundary.id} has an unknown Rust worker role`);
      if (
        boundary.implementationState !== "policy-model-only" ||
        boundary.boundaryKind !== "native-worker" ||
        boundary.rustWorker.cardinality !== expected[0] ||
        boundary.rustWorker.readiness !== expected[1] ||
        boundary.rustWorker.configurationOrder !== expected[2] ||
        boundary.target.readiness !== expected[1]
      ) {
        fail(
          `${boundary.id} Rust worker policy does not match the supervisor catalog`,
        );
      }
      if (seenRustRoles.has(boundary.rustWorker.role)) {
        fail(
          `${boundary.rustWorker.role} Rust worker role is assigned more than once`,
        );
      }
      if (configurationOrders.has(boundary.rustWorker.configurationOrder)) {
        fail(
          `${boundary.rustWorker.configurationOrder} configuration order is duplicated`,
        );
      }
      seenRustRoles.set(boundary.rustWorker.role, boundary.id);
      configurationOrders.add(boundary.rustWorker.configurationOrder);
    }
  }

  for (const [entrypoint, boundaryId] of RUNNABLE_ENTRYPOINTS) {
    if (seenEntrypoints.get(entrypoint) !== boundaryId) {
      fail(`${entrypoint} must be owned by ${boundaryId}`);
    }
  }
  for (const role of RUST_WORKERS.keys()) {
    if (!seenRustRoles.has(role)) fail(`missing Rust worker role ${role}`);
  }
  for (const boundary of contract.boundaries)
    assertNoParentCycle(boundary, byId);

  const allowedBy = (authority) =>
    contract.boundaries
      .filter((boundary) => boundary.targetAuthorities.includes(authority))
      .map((boundary) => boundary.id);
  if (
    JSON.stringify(allowedBy("audio-device")) !==
    JSON.stringify(["audio-engine"])
  ) {
    fail("audio-engine must be the sole target audio-device authority");
  }
  if (
    JSON.stringify(allowedBy("ledger-append")) !== JSON.stringify(["sequencer"])
  ) {
    fail("sequencer must be the sole ledger-append authority");
  }

  const storage = byId.get("storage-worker");
  if (
    storage.boundaryKind !== "worker-thread" ||
    storage.implementationState !== "planned-thread" ||
    storage.target.parentBoundaryId !== "backend" ||
    storage.target.privilege !== "same-backend-process-not-os-boundary" ||
    storage.target.restart !== "backend-restart-on-native-worker-crash"
  ) {
    fail("storage-worker must remain a planned, non-OS backend worker thread");
  }

  const semanticDigest = createHash("sha256")
    .update(JSON.stringify(canonicalize(contract)))
    .digest("hex");
  if (semanticDigest !== EXPECTED_CONTRACT_SHA256) {
    fail(
      `semantic digest ${semanticDigest} does not match the closed v0 contract`,
    );
  }
  return contract;
}

export async function readAndValidateProcessBoundaryContract(filename) {
  const bytes = await readFile(filename, "utf8");
  return validateProcessBoundaryContract(JSON.parse(bytes));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  const defaultPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "process-boundaries.v0.json",
  );
  const filename = process.argv[2]
    ? path.resolve(process.argv[2])
    : defaultPath;
  await readAndValidateProcessBoundaryContract(filename);
  console.log(`Process-boundary contract is valid: ${filename}`);
}
