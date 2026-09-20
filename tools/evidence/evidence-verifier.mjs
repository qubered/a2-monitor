#!/usr/bin/env node

import { Buffer } from "node:buffer";
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { constants, lstat, open } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { verifyArtifactSet } from "./artifact-loader.mjs";
import { canonicalize, parseStrictJson } from "./strict-json.mjs";
import {
  SYNTHETIC_CAPTURE_EXTRACTOR_ID,
  extractSyntheticCaptureMetrics,
} from "./synthetic-capture-extractor.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const BUILD_ID = /^a2-[0-9]+\.[0-9]+\.[0-9]+\+sha256\.[0-9a-f]{16}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const OPERATORS = new Set(["abs_lte", "eq", "gt", "gte", "lt", "lte"]);
const REDUCERS = new Set(["abs_max", "all", "any", "exact", "max", "min"]);
const VALUE_TYPES = new Set(["boolean", "integer", "string"]);
const METRIC_EXTRACTORS = new Set([
  "supplied-conformance-v1",
  SYNTHETIC_CAPTURE_EXTRACTOR_ID,
]);
const MAX_ARTIFACTS = 256;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 256 * 1024 * 1024;
const TOP_CATALOG_KEYS = [
  "catalogId",
  "kind",
  "promotionEligible",
  "schemaVersion",
  "tests",
];

function fail(message) {
  throw new Error(`Evidence verification failed: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} fields must be exactly ${expected.join(", ")}`);
  }
}

function string(value, label, pattern, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    (pattern && !pattern.test(value))
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function uniqueSortedStrings(value, label, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && value.length === 0)) {
    fail(`${label} must be ${empty ? "a" : "a non-empty"} string array`);
  }
  for (const item of value) string(item, label, IDENTIFIER);
  const sorted = [...value].sort();
  if (
    new Set(value).size !== value.length ||
    JSON.stringify(sorted) !== JSON.stringify(value)
  ) {
    fail(`${label} must contain unique byte-sorted values`);
  }
  return value;
}

function exactIds(actual, expected, label) {
  if (!Array.isArray(actual)) fail(`${label} must be an array`);
  const actualIds = actual.map((entry) => entry?.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(expected)) {
    fail(`${label} IDs/order must be exactly ${expected.join(", ")}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkedAdd(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value))
    fail(`${label} overflows safe integer range`);
  return value;
}

function parseUtc(value, label) {
  string(value, label, RFC3339_UTC);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    fail(`${label} is not a real UTC instant`);
  if (new Date(milliseconds).toISOString().replace(".000Z", "Z") !== value) {
    fail(`${label} must use canonical millisecond-or-second UTC form`);
  }
  return milliseconds;
}

function validateCatalog(catalog) {
  exactKeys(catalog, TOP_CATALOG_KEYS, "catalog");
  if (
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "a2-evidence-verifier-conformance-catalog" ||
    catalog.promotionEligible !== false
  ) {
    fail("catalog must be the non-promotional verifier-conformance v1 kind");
  }
  string(catalog.catalogId, "catalog.catalogId", IDENTIFIER);
  if (
    !Array.isArray(catalog.tests) ||
    catalog.tests.length === 0 ||
    catalog.tests.length > 32
  ) {
    fail("catalog.tests must contain 1..32 tests");
  }
  const testIds = [];
  for (const [testIndex, test] of catalog.tests.entries()) {
    const label = `catalog.tests[${testIndex}]`;
    exactKeys(
      test,
      [
        "assertions",
        "id",
        "metricExtractor",
        "minimumMeasurementMs",
        "minimumTrials",
        "minimumWarmupMs",
        "requiredArtifacts",
        "requiredFaults",
      ],
      label,
    );
    string(test.id, `${label}.id`, IDENTIFIER);
    string(test.metricExtractor, `${label}.metricExtractor`, IDENTIFIER);
    if (!METRIC_EXTRACTORS.has(test.metricExtractor)) {
      fail(`${label}.metricExtractor is unsupported`);
    }
    testIds.push(test.id);
    integer(test.minimumTrials, `${label}.minimumTrials`, 1);
    integer(test.minimumWarmupMs, `${label}.minimumWarmupMs`);
    integer(test.minimumMeasurementMs, `${label}.minimumMeasurementMs`, 1);
    uniqueSortedStrings(test.requiredFaults, `${label}.requiredFaults`, {
      empty: true,
    });
    if (
      !Array.isArray(test.requiredArtifacts) ||
      test.requiredArtifacts.length === 0 ||
      test.requiredArtifacts.length > MAX_ARTIFACTS
    ) {
      fail(
        `${label}.requiredArtifacts must contain 1..${MAX_ARTIFACTS} entries`,
      );
    }
    const artifactKinds = [];
    let maximumArtifactTotal = 0;
    for (const [artifactIndex, artifact] of test.requiredArtifacts.entries()) {
      exactKeys(
        artifact,
        ["kind", "maxBytes", "mediaType"],
        `${label}.requiredArtifacts[${artifactIndex}]`,
      );
      string(artifact.kind, `${label}.requiredArtifacts.kind`, IDENTIFIER);
      string(
        artifact.mediaType,
        `${label}.requiredArtifacts.mediaType`,
        /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/,
      );
      integer(artifact.maxBytes, `${label}.requiredArtifacts.maxBytes`, 1);
      if (artifact.maxBytes > MAX_ARTIFACT_BYTES) {
        fail(
          `${label}.requiredArtifacts.maxBytes exceeds the immutable hard ceiling`,
        );
      }
      maximumArtifactTotal = checkedAdd(
        maximumArtifactTotal,
        artifact.maxBytes,
        `${label}.requiredArtifacts total`,
      );
      artifactKinds.push(artifact.kind);
    }
    if (maximumArtifactTotal > MAX_TOTAL_ARTIFACT_BYTES) {
      fail(
        `${label}.requiredArtifacts total exceeds the immutable hard ceiling`,
      );
    }
    if (
      new Set(artifactKinds).size !== artifactKinds.length ||
      JSON.stringify(artifactKinds) !==
        JSON.stringify([...artifactKinds].sort()) ||
      !artifactKinds.includes("verifier-metrics")
    ) {
      fail(
        `${label}.requiredArtifacts must be unique, sorted and include verifier-metrics`,
      );
    }
    if (
      test.metricExtractor === SYNTHETIC_CAPTURE_EXTRACTOR_ID &&
      !artifactKinds.includes("synthetic-capture-trace")
    ) {
      fail(
        `${label}.requiredArtifacts must include synthetic-capture-trace for its metric extractor`,
      );
    }
    if (!Array.isArray(test.assertions) || test.assertions.length === 0) {
      fail(`${label}.assertions must be non-empty`);
    }
    const assertionIds = [];
    for (const [assertionIndex, assertion] of test.assertions.entries()) {
      const assertionLabel = `${label}.assertions[${assertionIndex}]`;
      exactKeys(
        assertion,
        [
          "expected",
          "id",
          "operator",
          "reducer",
          "sourceArtifactKind",
          "unit",
          "valueType",
        ],
        assertionLabel,
      );
      string(assertion.id, `${assertionLabel}.id`, IDENTIFIER);
      assertionIds.push(assertion.id);
      string(assertion.unit, `${assertionLabel}.unit`, IDENTIFIER);
      if (!VALUE_TYPES.has(assertion.valueType))
        fail(`${assertionLabel}.valueType is unsupported`);
      if (!REDUCERS.has(assertion.reducer))
        fail(`${assertionLabel}.reducer is unsupported`);
      if (!OPERATORS.has(assertion.operator))
        fail(`${assertionLabel}.operator is unsupported`);
      if (assertion.sourceArtifactKind !== "verifier-metrics") {
        fail(`${assertionLabel}.sourceArtifactKind is not implemented`);
      }
      assertValueType(
        assertion.expected,
        assertion.valueType,
        `${assertionLabel}.expected`,
      );
      if (assertion.operator !== "eq" && assertion.valueType !== "integer") {
        fail(`${assertionLabel} ordered predicates require integer values`);
      }
      if (
        ["all", "any"].includes(assertion.reducer) &&
        assertion.valueType !== "boolean"
      ) {
        fail(`${assertionLabel}.${assertion.reducer} requires boolean values`);
      }
      if (
        ["max", "min"].includes(assertion.reducer) &&
        assertion.valueType !== "integer"
      ) {
        fail(`${assertionLabel}.${assertion.reducer} requires integer values`);
      }
      if (
        (assertion.operator === "abs_lte") !==
        (assertion.reducer === "abs_max")
      ) {
        fail(`${assertionLabel} must pair abs_lte with abs_max`);
      }
    }
    if (
      new Set(assertionIds).size !== assertionIds.length ||
      JSON.stringify(assertionIds) !== JSON.stringify([...assertionIds].sort())
    ) {
      fail(`${label}.assertions must be unique and sorted`);
    }
  }
  if (
    new Set(testIds).size !== testIds.length ||
    JSON.stringify(testIds) !== JSON.stringify([...testIds].sort())
  ) {
    fail("catalog tests must be unique and sorted");
  }
  return catalog;
}

function validateManifest(manifest, catalog, catalogSha256) {
  exactKeys(
    manifest,
    [
      "buildId",
      "catalogSha256",
      "kind",
      "manifestId",
      "schemaVersion",
      "testId",
      "trials",
      "tuple",
    ],
    "manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "a2-evidence-run-manifest"
  ) {
    fail("manifest identity is invalid");
  }
  string(manifest.manifestId, "manifest.manifestId", UUID);
  string(manifest.testId, "manifest.testId", IDENTIFIER);
  string(manifest.buildId, "manifest.buildId", BUILD_ID);
  if (manifest.catalogSha256 !== catalogSha256)
    fail("manifest catalog digest mismatch");
  const test = catalog.tests.find(
    (candidate) => candidate.id === manifest.testId,
  );
  if (!test) fail(`manifest names unknown test ${manifest.testId}`);
  exactKeys(
    manifest.tuple,
    ["architecture", "executionProfile", "osFamily", "profileId"],
    "manifest.tuple",
  );
  for (const key of Object.keys(manifest.tuple))
    string(manifest.tuple[key], `manifest.tuple.${key}`, IDENTIFIER);
  if (
    !Array.isArray(manifest.trials) ||
    manifest.trials.length < test.minimumTrials ||
    manifest.trials.length > 1024
  ) {
    fail(`manifest must contain ${test.minimumTrials}..1024 trials`);
  }
  const trialIds = [];
  for (const [trialIndex, trial] of manifest.trials.entries()) {
    const label = `manifest.trials[${trialIndex}]`;
    exactKeys(trial, ["faults", "id", "measurementMs", "warmupMs"], label);
    string(trial.id, `${label}.id`, IDENTIFIER);
    trialIds.push(trial.id);
    if (integer(trial.warmupMs, `${label}.warmupMs`) < test.minimumWarmupMs)
      fail(`${label}.warmupMs is below the catalog minimum`);
    if (
      integer(trial.measurementMs, `${label}.measurementMs`, 1) <
      test.minimumMeasurementMs
    )
      fail(`${label}.measurementMs is below the catalog minimum`);
    if (!Array.isArray(trial.faults)) fail(`${label}.faults must be an array`);
    const faultKinds = [];
    const faultIds = [];
    for (const [faultIndex, fault] of trial.faults.entries()) {
      const faultLabel = `${label}.faults[${faultIndex}]`;
      exactKeys(
        fault,
        ["durationMs", "id", "kind", "startOffsetMs"],
        faultLabel,
      );
      string(fault.id, `${faultLabel}.id`, IDENTIFIER);
      string(fault.kind, `${faultLabel}.kind`, IDENTIFIER);
      faultIds.push(fault.id);
      faultKinds.push(fault.kind);
      integer(fault.startOffsetMs, `${faultLabel}.startOffsetMs`);
      integer(fault.durationMs, `${faultLabel}.durationMs`, 1);
      if (
        checkedAdd(fault.startOffsetMs, fault.durationMs, faultLabel) >
        trial.measurementMs
      ) {
        fail(`${faultLabel} falls outside the half-open measurement interval`);
      }
    }
    if (new Set(faultIds).size !== faultIds.length)
      fail(`${label} has duplicate fault IDs`);
    if (JSON.stringify(faultKinds) !== JSON.stringify(test.requiredFaults)) {
      fail(`${label} fault kinds do not match the catalog`);
    }
  }
  if (new Set(trialIds).size !== trialIds.length)
    fail("manifest has duplicate trial IDs");
  return test;
}

function assertValueType(value, type, label) {
  if (type === "integer") integer(value, label, Number.MIN_SAFE_INTEGER);
  else if (typeof value !== type) fail(`${label} must be ${type}`);
}

function validateResult(result, manifest, test, manifestSha256, catalogSha256) {
  exactKeys(
    result,
    [
      "artifacts",
      "buildId",
      "catalogSha256",
      "deviations",
      "endedUtc",
      "kind",
      "manifestSha256",
      "resultId",
      "runnerId",
      "schemaVersion",
      "signature",
      "startedUtc",
      "testId",
      "trials",
      "waiverIds",
    ],
    "result",
  );
  if (result.schemaVersion !== 1 || result.kind !== "a2-evidence-run-result")
    fail("result identity is invalid");
  string(result.resultId, "result.resultId", UUID);
  string(result.runnerId, "result.runnerId", IDENTIFIER);
  if (
    result.manifestSha256 !== manifestSha256 ||
    result.catalogSha256 !== catalogSha256 ||
    result.testId !== manifest.testId ||
    result.buildId !== manifest.buildId
  ) {
    fail("result bindings do not match the manifest and catalog bytes");
  }
  if (
    !Array.isArray(result.deviations) ||
    result.deviations.length !== 0 ||
    !Array.isArray(result.waiverIds) ||
    result.waiverIds.length !== 0
  ) {
    fail("conformance verification rejects every deviation and waiver");
  }
  const started = parseUtc(result.startedUtc, "result.startedUtc");
  const ended = parseUtc(result.endedUtc, "result.endedUtc");
  if (ended <= started) fail("result wall-clock interval is empty or reversed");
  const minimumWallMs = manifest.trials.reduce(
    (total, trial) =>
      checkedAdd(
        total,
        checkedAdd(trial.warmupMs, trial.measurementMs, "trial duration"),
        "total duration",
      ),
    0,
  );
  if (ended - started < minimumWallMs)
    fail("result wall-clock interval is shorter than all trials");
  exactIds(
    result.trials,
    manifest.trials.map((trial) => trial.id),
    "result.trials",
  );
  let previousEnd = -1;
  let bootId;
  for (const [index, trialResult] of result.trials.entries()) {
    const label = `result.trials[${index}]`;
    exactKeys(
      trialResult,
      [
        "bootId",
        "faults",
        "id",
        "measurementEndedMs",
        "startedMs",
        "warmupEndedMs",
      ],
      label,
    );
    string(trialResult.bootId, `${label}.bootId`, IDENTIFIER);
    bootId ??= trialResult.bootId;
    if (trialResult.bootId !== bootId)
      fail("all trials must share one boot ID");
    const start = integer(trialResult.startedMs, `${label}.startedMs`);
    const warmupEnd = integer(
      trialResult.warmupEndedMs,
      `${label}.warmupEndedMs`,
    );
    const measurementEnd = integer(
      trialResult.measurementEndedMs,
      `${label}.measurementEndedMs`,
    );
    if (start < previousEnd)
      fail("result trials overlap or are out of monotonic order");
    previousEnd = measurementEnd;
    const planned = manifest.trials[index];
    if (
      warmupEnd - start < planned.warmupMs ||
      measurementEnd - warmupEnd < planned.measurementMs
    ) {
      fail(
        `${label} is shorter than its planned warmup or measurement interval`,
      );
    }
    exactIds(
      trialResult.faults,
      planned.faults.map((fault) => fault.id),
      `${label}.faults`,
    );
    for (const [faultIndex, faultResult] of trialResult.faults.entries()) {
      const faultLabel = `${label}.faults[${faultIndex}]`;
      exactKeys(faultResult, ["endedMs", "id", "startedMs"], faultLabel);
      const faultStart = integer(
        faultResult.startedMs,
        `${faultLabel}.startedMs`,
      );
      const faultEnd = integer(faultResult.endedMs, `${faultLabel}.endedMs`);
      const fault = planned.faults[faultIndex];
      if (
        faultStart !== checkedAdd(warmupEnd, fault.startOffsetMs, faultLabel) ||
        faultEnd - faultStart !== fault.durationMs ||
        faultStart < warmupEnd ||
        faultEnd > measurementEnd
      ) {
        fail(`${faultLabel} does not match its planned in-window occurrence`);
      }
    }
  }
  if (!Array.isArray(result.artifacts))
    fail("result.artifacts must be an array");
  const requiredKinds = test.requiredArtifacts.map((artifact) => artifact.kind);
  const resultKinds = result.artifacts.map((artifact) => artifact?.kind);
  if (JSON.stringify(resultKinds) !== JSON.stringify(requiredKinds))
    fail("result artifact kinds/order do not exactly match the catalog");
  for (const [index, artifact] of result.artifacts.entries()) {
    exactKeys(
      artifact,
      ["bytes", "kind", "mediaType", "path", "sha256"],
      `result.artifacts[${index}]`,
    );
    const required = test.requiredArtifacts[index];
    if (
      artifact.kind !== required.kind ||
      artifact.mediaType !== required.mediaType
    )
      fail(
        `result artifact ${artifact.kind} metadata does not match the catalog`,
      );
    integer(artifact.bytes, `result artifact ${artifact.kind}.bytes`);
    if (artifact.bytes > required.maxBytes)
      fail(`result artifact ${artifact.kind} exceeds its catalog byte limit`);
    string(
      artifact.sha256,
      `result artifact ${artifact.kind}.sha256`,
      SHA256,
      64,
    );
    string(
      artifact.path,
      `result artifact ${artifact.kind}.path`,
      undefined,
      512,
    );
  }
  return result;
}

function validateKeyring(keyring, result) {
  exactKeys(keyring, ["keys", "kind", "schemaVersion"], "keyring");
  if (keyring.schemaVersion !== 1 || keyring.kind !== "a2-evidence-keyring")
    fail("keyring identity is invalid");
  if (
    !Array.isArray(keyring.keys) ||
    keyring.keys.length === 0 ||
    keyring.keys.length > 32
  )
    fail("keyring.keys must contain 1..32 keys");
  exactKeys(result.signature, ["alg", "keyId", "value"], "result.signature");
  if (result.signature.alg !== "ES256")
    fail("result signature algorithm must be ES256");
  string(result.signature.keyId, "result.signature.keyId", IDENTIFIER);
  string(
    result.signature.value,
    "result.signature.value",
    /^[A-Za-z0-9_-]{86}$/,
    86,
  );
  const keys = new Set();
  let selected;
  for (const [index, key] of keyring.keys.entries()) {
    const label = `keyring.keys[${index}]`;
    exactKeys(
      key,
      [
        "keyId",
        "notAfterUtc",
        "notBeforeUtc",
        "publicJwk",
        "purpose",
        "status",
      ],
      label,
    );
    string(key.keyId, `${label}.keyId`, IDENTIFIER);
    if (keys.has(key.keyId)) fail(`duplicate key ID ${key.keyId}`);
    keys.add(key.keyId);
    if (
      key.purpose !== "evidence-run-result" ||
      !["active", "revoked"].includes(key.status)
    )
      fail(`${label} purpose or status is invalid`);
    const notBefore = parseUtc(key.notBeforeUtc, `${label}.notBeforeUtc`);
    const notAfter = parseUtc(key.notAfterUtc, `${label}.notAfterUtc`);
    if (notAfter <= notBefore) fail(`${label} validity interval is invalid`);
    exactKeys(key.publicJwk, ["crv", "kty", "x", "y"], `${label}.publicJwk`);
    if (
      key.publicJwk.kty !== "EC" ||
      key.publicJwk.crv !== "P-256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(key.publicJwk.x) ||
      !/^[A-Za-z0-9_-]{43}$/.test(key.publicJwk.y)
    )
      fail(`${label} must be a public P-256 JWK`);
    if (key.keyId === result.signature.keyId)
      selected = { ...key, notBefore, notAfter };
  }
  if (!selected) fail(`unknown signing key ${result.signature.keyId}`);
  const signedAt = parseUtc(result.endedUtc, "result.endedUtc");
  if (
    selected.status !== "active" ||
    signedAt < selected.notBefore ||
    signedAt > selected.notAfter
  )
    fail("signing key is revoked or outside its validity interval");
  const unsigned = Object.create(null);
  for (const [name, value] of Object.entries(result)) {
    if (name !== "signature") unsigned[name] = value;
  }
  const signatureBytes = Buffer.from(result.signature.value, "base64url");
  if (signatureBytes.length !== 64)
    fail("result signature must be 64-byte IEEE-P1363");
  const valid = verifySignature(
    "sha256",
    Buffer.from(canonicalize(unsigned), "utf8"),
    {
      key: createPublicKey({ key: selected.publicJwk, format: "jwk" }),
      dsaEncoding: "ieee-p1363",
    },
    signatureBytes,
  );
  if (!valid) fail("result signature is invalid");
}

function parseMetrics(
  bytes,
  manifest,
  test,
  manifestSha256,
  sourceTraceSha256,
) {
  const metrics = parseStrictJson(bytes);
  if (test.metricExtractor === "supplied-conformance-v1") {
    exactKeys(
      metrics,
      ["kind", "manifestSha256", "schemaVersion", "trials"],
      "metrics",
    );
    if (
      metrics.schemaVersion !== 1 ||
      metrics.kind !== "a2-evidence-verifier-metrics" ||
      metrics.manifestSha256 !== manifestSha256
    ) {
      fail("metrics identity or manifest binding is invalid");
    }
  } else {
    exactKeys(
      metrics,
      [
        "evidenceScope",
        "extractorId",
        "kind",
        "manifestSha256",
        "promotionEligible",
        "schemaVersion",
        "sourceTraceSha256",
        "trials",
      ],
      "metrics",
    );
    if (
      metrics.schemaVersion !== 1 ||
      metrics.kind !== "a2-synthetic-capture-extracted-metrics" ||
      metrics.extractorId !== SYNTHETIC_CAPTURE_EXTRACTOR_ID ||
      metrics.evidenceScope !== "synthetic-metadata-only" ||
      metrics.promotionEligible !== false ||
      metrics.manifestSha256 !== manifestSha256 ||
      metrics.sourceTraceSha256 !== sourceTraceSha256
    ) {
      fail("extracted metrics identity or byte binding is invalid");
    }
  }
  exactIds(
    metrics.trials,
    manifest.trials.map((trial) => trial.id),
    "metrics.trials",
  );
  const assertionIds = test.assertions.map((assertion) => assertion.id);
  const byAssertion = new Map(assertionIds.map((id) => [id, []]));
  for (const [trialIndex, trial] of metrics.trials.entries()) {
    exactKeys(trial, ["id", "measurements"], `metrics.trials[${trialIndex}]`);
    if (!Array.isArray(trial.measurements))
      fail(`metrics.trials[${trialIndex}].measurements must be an array`);
    const actualIds = trial.measurements.map((measurement) => measurement?.id);
    if (JSON.stringify(actualIds) !== JSON.stringify(assertionIds))
      fail(
        `metrics trial ${trial.id} assertion IDs/order do not match the catalog`,
      );
    for (const [
      measurementIndex,
      measurement,
    ] of trial.measurements.entries()) {
      const assertion = test.assertions[measurementIndex];
      const label = `metrics.trials[${trialIndex}].measurements[${measurementIndex}]`;
      exactKeys(measurement, ["id", "unit", "value"], label);
      if (measurement.unit !== assertion.unit)
        fail(`${label} unit does not match the catalog`);
      assertValueType(measurement.value, assertion.valueType, `${label}.value`);
      byAssertion.get(assertion.id).push(measurement.value);
    }
  }
  return byAssertion;
}

function reduce(values, reducer, label) {
  if (reducer === "abs_max")
    return Math.max(...values.map((value) => Math.abs(value)));
  if (reducer === "max") return Math.max(...values);
  if (reducer === "min") return Math.min(...values);
  if (reducer === "all") return values.every((value) => value === true);
  if (reducer === "any") return values.some((value) => value === true);
  if (values.some((value) => value !== values[0]))
    fail(`${label} exact reducer received unequal trial values`);
  return values[0];
}

function predicatePasses(observed, operator, expected) {
  if (operator === "eq")
    return typeof observed === typeof expected && observed === expected;
  if (typeof observed !== "number" || typeof expected !== "number")
    return false;
  if (operator === "lt") return observed < expected;
  if (operator === "lte") return observed <= expected;
  if (operator === "gt") return observed > expected;
  if (operator === "gte") return observed >= expected;
  if (operator === "abs_lte") return Math.abs(observed) <= expected;
  return false;
}

export async function verifyConformanceRun({
  catalogBytes,
  manifestBytes,
  resultBytes,
  keyringBytes,
  artifactRoot,
}) {
  const catalog = validateCatalog(parseStrictJson(catalogBytes));
  const catalogSha256 = sha256(catalogBytes);
  const manifest = parseStrictJson(manifestBytes);
  const manifestSha256 = sha256(manifestBytes);
  const test = validateManifest(manifest, catalog, catalogSha256);
  const result = validateResult(
    parseStrictJson(resultBytes),
    manifest,
    test,
    manifestSha256,
    catalogSha256,
  );
  validateKeyring(parseStrictJson(keyringBytes), result);
  const verifiedArtifacts = await verifyArtifactSet({
    root: artifactRoot,
    artifacts: result.artifacts,
    limits: {
      maxArtifacts: test.requiredArtifacts.length,
      maxFileBytes: Math.max(
        ...test.requiredArtifacts.map((artifact) => artifact.maxBytes),
      ),
      maxTotalBytes: test.requiredArtifacts.reduce(
        (total, artifact) =>
          checkedAdd(total, artifact.maxBytes, "artifact total"),
        0,
      ),
    },
  });
  const [metrics] = verifiedArtifacts.byKind("verifier-metrics");
  if (!metrics) fail("verified artifact set has no verifier-metrics bytes");
  let sourceTraceSha256 = null;
  if (test.metricExtractor === SYNTHETIC_CAPTURE_EXTRACTOR_ID) {
    const [trace] = verifiedArtifacts.byKind("synthetic-capture-trace");
    if (!trace)
      fail("verified artifact set has no synthetic-capture-trace bytes");
    const input = {
      async *[Symbol.asyncIterator]() {
        yield trace.content.copy();
      },
    };
    const derived = await extractSyntheticCaptureMetrics({
      input,
      manifestBytes,
    });
    if (derived.sourceTraceSha256 !== trace.sha256) {
      fail("extractor source trace digest does not match verified bytes");
    }
    const canonicalDerived = Buffer.from(
      canonicalize(parseStrictJson(Buffer.from(JSON.stringify(derived)))),
    );
    if (!metrics.content.copy().equals(canonicalDerived)) {
      fail("supplied metrics bytes do not equal canonical extracted metrics");
    }
    sourceTraceSha256 = derived.sourceTraceSha256;
  }
  const values = parseMetrics(
    metrics.content.copy(),
    manifest,
    test,
    manifestSha256,
    sourceTraceSha256,
  );
  const assertions = Object.freeze(
    test.assertions.map((assertion) => {
      const observed = reduce(
        values.get(assertion.id),
        assertion.reducer,
        assertion.id,
      );
      if (!predicatePasses(observed, assertion.operator, assertion.expected))
        fail(`computed assertion ${assertion.id} did not pass`);
      return Object.freeze({
        expected: assertion.expected,
        id: assertion.id,
        observed,
        operator: assertion.operator,
        reducer: assertion.reducer,
        sourceArtifactSha256: metrics.sha256,
        sourceTraceSha256,
        unit: assertion.unit,
      });
    }),
  );
  const summarizedArtifacts = Object.freeze(
    verifiedArtifacts.artifacts.map((artifact) =>
      Object.freeze({
        declaredBytes: artifact.declaredBytes,
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        path: artifact.path,
        sha256: artifact.sha256,
      }),
    ),
  );
  return Object.freeze({
    schemaVersion: 1,
    kind: "a2-verified-conformance-run",
    outcome: "conformance-pass",
    promotionEligible: false,
    metricExtractor: test.metricExtractor,
    trust:
      "supplied-key-runner-attested-facts-not-independent-product-evidence",
    catalogSha256,
    manifestSha256,
    resultSha256: sha256(resultBytes),
    resultId: result.resultId,
    testId: result.testId,
    buildId: result.buildId,
    tuple: Object.freeze({ ...manifest.tuple }),
    assertions,
    artifacts: summarizedArtifacts,
  });
}

async function boundedRead(filename, maximumBytes = 2 * 1024 * 1024) {
  const before = await lstat(filename, { bigint: true }).catch(() =>
    fail(`${filename} is missing or unreadable`),
  );
  if (before.isSymbolicLink() || !before.isFile()) {
    fail(`${filename} must be a regular file, not a symlink or special file`);
  }
  if (before.size > BigInt(maximumBytes)) {
    fail(`${filename} exceeds ${maximumBytes} bytes`);
  }
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(filename, constants.O_RDONLY | noFollow).catch(() =>
    fail(`${filename} could not be opened safely`),
  );
  const identity = (stat) =>
    `${stat.dev}:${stat.ino}:${stat.size}:${stat.mode}:${stat.mtimeNs}:${stat.ctimeNs}`;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || identity(opened) !== identity(before)) {
      fail(`${filename} changed before it was opened`);
    }
    const chunks = [];
    let observed = 0;
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
      start: 0,
    })) {
      observed += chunk.byteLength;
      if (observed > maximumBytes)
        fail(`${filename} exceeds ${maximumBytes} bytes`);
      chunks.push(Buffer.from(chunk));
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(filename, { bigint: true }).catch(() =>
      fail(`${filename} changed while it was read`),
    );
    if (
      identity(after) !== identity(opened) ||
      identity(pathAfter) !== identity(opened)
    ) {
      fail(`${filename} changed while it was read`);
    }
    return Buffer.concat(chunks, observed);
  } finally {
    await handle.close();
  }
}

async function main(args) {
  if (args.length !== 6 || args[0] !== "verify-conformance-run") {
    throw new Error(
      "usage: evidence-verifier.mjs verify-conformance-run CATALOG MANIFEST RESULT KEYRING ARTIFACT_ROOT",
    );
  }
  const [, catalogPath, manifestPath, resultPath, keyringPath, artifactRoot] =
    args;
  const [catalogBytes, manifestBytes, resultBytes, keyringBytes] =
    await Promise.all(
      [catalogPath, manifestPath, resultPath, keyringPath].map((filename) =>
        boundedRead(filename),
      ),
    );
  const summary = await verifyConformanceRun({
    catalogBytes,
    manifestBytes,
    resultBytes,
    keyringBytes,
    artifactRoot,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
