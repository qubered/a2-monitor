#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error(`JCS rejects ${typeof value}`);
}

export function sha256Hex(value) {
  const bytes = typeof value === "string" ? value : canonicalize(value);
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function unsignedProjection(document) {
  const { signature: _signature, ...unsigned } = document;
  return unsigned;
}

export function signDocument(document, privateJwk, keyId) {
  const bytes = Buffer.from(canonicalize(unsignedProjection(document)), "utf8");
  const signature = sign("sha256", bytes, {
    key: createPrivateKey({ key: privateJwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363"
  });
  return {
    ...document,
    signature: { alg: "ES256", key_id: keyId, value: signature.toString("base64url") }
  };
}

export function verifyDocumentSignature(document, keyring) {
  const signature = document.signature;
  if (!signature || signature.alg !== "ES256") throw new Error("missing ES256 signature");
  const key = keyring.keys.find(candidate => candidate.key_id === signature.key_id);
  if (!key || !key.public_jwk) throw new Error(`unknown signing key ${signature.key_id}`);
  const bytes = Buffer.from(canonicalize(unsignedProjection(document)), "utf8");
  const valid = verify("sha256", bytes, {
    key: createPublicKey({ key: key.public_jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363"
  }, Buffer.from(signature.value, "base64url"));
  if (!valid) throw new Error("invalid evidence signature");
}

function exactSet(actual, required, label) {
  const actualSet = new Set(actual);
  const requiredSet = new Set(required);
  const missing = required.filter(value => !actualSet.has(value));
  const unexpected = actual.filter(value => !requiredSet.has(value));
  if (missing.length || unexpected.length) {
    throw new Error(`${label} mismatch; missing=[${missing}] unexpected=[${unexpected}]`);
  }
}

function assertionIds(test) {
  if (!test.assertions || typeof test.assertions !== "object" || Array.isArray(test.assertions)) {
    throw new Error("catalog test has no assertion predicates");
  }
  return Object.keys(test.assertions);
}

function predicatePasses(predicate, observed) {
  switch (predicate.operator) {
    case "eq": return observed === predicate.expected;
    case "lt": return typeof observed === "number" && observed < predicate.expected;
    case "lte": return typeof observed === "number" && observed <= predicate.expected;
    case "gt": return typeof observed === "number" && observed > predicate.expected;
    case "gte": return typeof observed === "number" && observed >= predicate.expected;
    case "abs_lte": return typeof observed === "number" && Math.abs(observed) <= predicate.expected;
    default: throw new Error(`unsupported assertion operator ${predicate.operator}`);
  }
}

function parseMetricsArtifact(bytes) {
  let metrics;
  try {
    metrics = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("verifier-metrics artifact is not valid JSON");
  }
  if (metrics?.schema_version !== "evidence-metrics/v0" ||
      !metrics.assertions || typeof metrics.assertions !== "object" ||
      Array.isArray(metrics.assertions)) {
    throw new Error("invalid verifier-metrics artifact");
  }
  if (Object.keys(metrics).some(key => key !== "schema_version" && key !== "assertions")) {
    throw new Error("unexpected verifier-metrics field");
  }
  for (const [id, metric] of Object.entries(metrics.assertions)) {
    if (!id || !metric || typeof metric !== "object" || Array.isArray(metric) ||
        Object.keys(metric).length !== 2 || !("observed" in metric) ||
        typeof metric.unit !== "string" || metric.unit.length === 0) {
      throw new Error(`invalid verifier metric ${id}`);
    }
    const kind = typeof metric.observed;
    if (!["number", "boolean", "string"].includes(kind) ||
        (kind === "number" && !Number.isFinite(metric.observed))) {
      throw new Error(`invalid observed value for ${id}`);
    }
  }
  return metrics;
}

async function verifyArtifacts(result, loadArtifact) {
  if (typeof loadArtifact !== "function") throw new Error("artifact loader is required");
  const seenKinds = new Set();
  const seenKeys = new Set();
  const verified = new Map();
  for (const artifact of result.artifacts) {
    if (seenKinds.has(artifact.kind)) throw new Error(`duplicate artifact kind ${artifact.kind}`);
    if (seenKeys.has(artifact.store_key)) throw new Error(`duplicate artifact store key ${artifact.store_key}`);
    seenKinds.add(artifact.kind);
    seenKeys.add(artifact.store_key);
    const bytes = Buffer.from(await loadArtifact(artifact.store_key));
    if (bytes.byteLength !== artifact.bytes) throw new Error(`artifact byte count mismatch for ${artifact.kind}`);
    if (sha256Bytes(bytes) !== artifact.sha256) throw new Error(`artifact hash mismatch for ${artifact.kind}`);
    verified.set(artifact.sha256, { ...artifact, bytes });
  }
  return verified;
}

function validateElapsedRun(manifest, result) {
  const started = Date.parse(result.started_utc);
  const ended = Date.parse(result.ended_utc);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
    throw new Error("invalid result time interval");
  }
  const minimumMs = manifest.trials.count *
    (manifest.trials.duration_s + manifest.trials.warmup_s) * 1000;
  if (ended - started < minimumMs) throw new Error("measured elapsed time is below the manifest run time");
  for (const fault of manifest.faults) {
    if (fault.at_s + fault.duration_s > manifest.trials.duration_s) {
      throw new Error(`fault ${fault.kind} is scheduled outside the trial`);
    }
  }
}

function computeAssertions(test, result, verifiedArtifacts) {
  const required = assertionIds(test);
  exactSet(result.assertions.map(assertion => assertion.id), required, "result assertions");
  const metricsArtifact = result.artifacts.find(artifact => artifact.kind === "verifier-metrics");
  if (!metricsArtifact) throw new Error("missing verifier-metrics artifact");
  const verified = verifiedArtifacts.get(metricsArtifact.sha256);
  const metrics = parseMetricsArtifact(verified.bytes);
  exactSet(Object.keys(metrics.assertions), required, "metrics assertions");
  const failures = [];
  for (const assertion of result.assertions) {
    if (assertion.artifact_sha256 !== metricsArtifact.sha256) {
      throw new Error(`assertion ${assertion.id} is not bound to verifier-metrics`);
    }
    const predicate = test.assertions[assertion.id];
    const metric = metrics.assertions[assertion.id];
    if (!metric || metric.unit !== predicate.unit) {
      throw new Error(`assertion ${assertion.id} unit mismatch`);
    }
    if (!predicatePasses(predicate, metric.observed)) failures.push(assertion.id);
  }
  if (failures.length) throw new Error(`computed assertions did not pass: ${failures.join(",")}`);
}

export function createSchemaValidators(schemas) {
  const ajv = new Ajv2020({
    allErrors: false,
    strict: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false
  });
  addFormats(ajv);
  ajv.addFormat("u64-string", value => {
    if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) return false;
    return BigInt(value) <= 18446744073709551615n;
  });
  ajv.addFormat("utc-date-time", value => {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(value)) return false;
    return Number.isFinite(Date.parse(value));
  });
  const validators = new Map();
  for (const schema of schemas) ajv.addSchema(schema);
  for (const schema of schemas) validators.set(schema.title, ajv.getSchema(schema.$id));
  return { ajv, validators };
}

export function validateManifest(manifest, catalog, validateSchema) {
  if (!validateSchema(manifest)) {
    throw new Error(`manifest schema: ${JSON.stringify(validateSchema.errors)}`);
  }
  const test = catalog.tests[manifest.test_id];
  if (!test) throw new Error(`unknown test_id ${manifest.test_id}`);
  if (test.manifest_schema !== manifest.schema_version) throw new Error("catalog/schema mismatch");
  if (manifest.trials.count < test.minimum_trials) throw new Error("too few trials");
  if (manifest.trials.duration_s < test.minimum_duration_s) throw new Error("trial duration below catalogue minimum");
  const clients = manifest.clients ?? [];
  if (clients.length < test.minimum_clients) throw new Error("too few clients");
  if (test.client_admission === "declared-limit-plus-one" &&
      clients.length !== manifest.limits?.audio_clients + 1) {
    throw new Error("admission test requires declared audio-client limit plus one");
  }
  for (const clientClass of test.required_client_classes ?? []) {
    if (!clients.some(client => client.class === clientClass)) throw new Error(`missing client class ${clientClass}`);
  }
  exactSet(manifest.faults.map(fault => fault.kind), test.required_faults, "fault catalogue");
  exactSet(manifest.assertion_ids, assertionIds(test), "assertion catalogue");
  exactSet(manifest.artifact_kinds, test.required_artifacts, "artifact catalogue");
  return test;
}

export function validateOperatorManifest(manifest, catalog, validateSchema) {
  if (!validateSchema(manifest)) {
    throw new Error(`operator manifest schema: ${JSON.stringify(validateSchema.errors)}`);
  }
  const test = catalog.tests[manifest.test_id];
  if (!test) throw new Error(`unknown operator test_id ${manifest.test_id}`);
  if (manifest.fixture_revision !== catalog.reference_fixture.id) throw new Error("operator fixture mismatch");
  if (manifest.repetitions < test.minimum_repetitions) throw new Error("too few operator repetitions");
  exactSet(manifest.blind_faults, test.required_faults, "operator fault catalogue");
  exactSet(manifest.assertion_ids, assertionIds(test), "operator assertion catalogue");
  exactSet(manifest.artifact_kinds, test.required_artifacts, "operator artifact catalogue");
  for (const key of test.zero_tolerance) {
    if (manifest.thresholds[key] !== 0) throw new Error(`zero-tolerance threshold ${key} must be zero`);
  }
  return test;
}

export async function verifyRun({ manifest, result, catalog, keyring, validateManifestSchema, validateResultSchema, loadArtifact }) {
  const test = validateManifest(manifest, catalog, validateManifestSchema);
  if (!validateResultSchema(result)) {
    throw new Error(`result schema: ${JSON.stringify(validateResultSchema.errors)}`);
  }
  if (result.manifest_id !== manifest.manifest_id) throw new Error("manifest_id mismatch");
  if (result.manifest_sha256 !== sha256Hex(manifest)) throw new Error("manifest hash mismatch");
  if (result.test_id !== manifest.test_id) throw new Error("test_id mismatch");
  if (result.commit !== manifest.commit) throw new Error("commit mismatch");
  if (result.deviations.length !== 0) throw new Error("a deviated run cannot promote without a separately verified waiver");
  if (result.waiver_ids.length !== 0) throw new Error("waiver verification is required before promotion");
  validateElapsedRun(manifest, result);
  const artifactKinds = result.artifacts.map(artifact => artifact.kind);
  for (const required of test.required_artifacts) {
    if (!artifactKinds.includes(required)) throw new Error(`missing artifact ${required}`);
  }
  verifyDocumentSignature(result, keyring);
  const verifiedArtifacts = await verifyArtifacts(result, loadArtifact);
  computeAssertions(test, result, verifiedArtifacts);
  return {
    outcome: "pass",
    test_id: result.test_id,
    result_id: result.result_id,
    coverage: { tuple: manifest.tuple, audio: manifest.audio ?? manifest.capture, clients: manifest.clients ?? [] }
  };
}

export async function verifyOperatorRun({ manifest, result, catalog, keyring, validateManifestSchema, validateResultSchema, loadArtifact }) {
  const test = validateOperatorManifest(manifest, catalog, validateManifestSchema);
  if (!validateResultSchema(result)) throw new Error(`result schema: ${JSON.stringify(validateResultSchema.errors)}`);
  if (result.manifest_id !== manifest.manifest_id || result.manifest_sha256 !== sha256Hex(manifest)) throw new Error("operator manifest binding mismatch");
  if (result.test_id !== manifest.test_id || result.commit !== manifest.commit) throw new Error("operator run identity mismatch");
  if (result.deviations.length || result.waiver_ids.length) throw new Error("operator promotion requires separately verified, eligible waivers");
  const artifactKinds = result.artifacts.map(artifact => artifact.kind);
  for (const required of test.required_artifacts) if (!artifactKinds.includes(required)) throw new Error(`missing operator artifact ${required}`);
  verifyDocumentSignature(result, keyring);
  const verifiedArtifacts = await verifyArtifacts(result, loadArtifact);
  computeAssertions(test, result, verifiedArtifacts);
  return { outcome: "pass", test_id: result.test_id, result_id: result.result_id };
}

function subsetMatches(actual, expected) {
  if (!expected) return true;
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

export function verifyPromotion(phase, verifiedRuns, catalog) {
  const requirements = catalog.phase_requirements[phase];
  if (!requirements) throw new Error(`unknown phase ${phase}`);
  const passing = verifiedRuns.filter(run => run.outcome === "pass");
  for (const testId of requirements.required_tests) {
    if (!passing.some(run => run.test_id === testId)) throw new Error(`phase ${phase} missing passing test ${testId}`);
  }
  for (const requirement of requirements.required_coverage) {
    const covered = passing.some(run =>
      run.test_id === requirement.test_id &&
      subsetMatches(run.coverage?.tuple, requirement.tuple) &&
      subsetMatches(run.coverage?.audio, requirement.audio) &&
      (!requirement.client || run.coverage?.clients?.some(client => subsetMatches(client, requirement.client)))
    );
    if (!covered) throw new Error(`phase ${phase} missing coverage ${requirement.id}`);
  }
  return { phase, outcome: "pass", required_tests: requirements.required_tests };
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function localArtifactLoader(root) {
  const resolvedRoot = await realpath(root);
  return async storeKey => {
    const candidate = path.resolve(resolvedRoot, storeKey);
    const resolved = await realpath(candidate);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("artifact path escapes the artifact root");
    }
    return readFile(resolved);
  };
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "sign-result" && args.length === 3) {
    const [resultPath, keyringPath, keyId] = args;
    const result = await loadJson(resultPath);
    const keyring = await loadJson(keyringPath);
    const key = keyring.keys.find(candidate => candidate.key_id === keyId);
    if (!key?.private_jwk) throw new Error(`private test key not found: ${keyId}`);
    process.stdout.write(`${JSON.stringify(signDocument(result, key.private_jwk, keyId), null, 2)}\n`);
    return;
  }
  if (command === "verify-run" && args.length === 7) {
    const [manifestPath, resultPath, catalogPath, keyringPath, manifestSchemaPath, resultSchemaPath, artifactRoot] = args;
    const [manifest, result, catalog, keyring, manifestSchema, resultSchema] = await Promise.all(
      [manifestPath, resultPath, catalogPath, keyringPath, manifestSchemaPath, resultSchemaPath].map(loadJson)
    );
    const { ajv } = createSchemaValidators([manifestSchema, resultSchema]);
    const verification = await verifyRun({
      manifest, result, catalog, keyring,
      validateManifestSchema: ajv.getSchema(manifestSchema.$id),
      validateResultSchema: ajv.getSchema(resultSchema.$id),
      loadArtifact: await localArtifactLoader(artifactRoot)
    });
    process.stdout.write(`${JSON.stringify(verification)}\n`);
    return;
  }
  throw new Error("usage: evidence-verifier.mjs sign-result RESULT KEYRING KEY_ID | verify-run MANIFEST RESULT CATALOG KEYRING MANIFEST_SCHEMA RESULT_SCHEMA ARTIFACT_ROOT");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`evidence verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
