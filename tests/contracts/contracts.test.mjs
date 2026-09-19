import assert from "node:assert/strict";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  canonicalize,
  createSchemaValidators,
  signDocument,
  sha256Hex,
  validateOperatorManifest,
  verifyOperatorRun,
  verifyPromotion,
  verifyRun
} from "../../tools/evidence-verifier.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const json = async relative => JSON.parse(await readFile(path.join(root, relative), "utf8"));

async function walkJson(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkJson(target));
    else if (entry.name.endsWith(".json")) files.push(target);
  }
  return files;
}

const schemaFiles = [
  ...await walkJson(path.join(root, "packages/protocol/schema")),
  ...await walkJson(path.join(root, "tests/manifests"))
];
const schemas = await Promise.all(schemaFiles.map(async file => JSON.parse(await readFile(file, "utf8"))));
const { ajv } = createSchemaValidators(schemas);
const catalog = await json("tests/catalog/evidence-tests.v0.json");
const keyring = await json("tests/fixtures/evidence/test-keyring.json");

function enumValues(schema, definition) {
  return schema.$defs[definition].properties.type.enum ?? [schema.$defs[definition].properties.type.const];
}

test("all JSON Schemas compile under Draft 2020-12", () => {
  for (const schema of schemas) assert.equal(typeof ajv.getSchema(schema.$id), "function", schema.$id);
});

test("u64-string rejects values above 2^64-1 and accepts the maximum", () => {
  const validate = ajv.compile({ type: "string", format: "u64-string" });
  assert.equal(validate("18446744073709551615"), true);
  assert.equal(validate("18446744073709551616"), false);
  assert.equal(validate("99999999999999999999"), false);
});

test("signed Phase 0A evidence verifies and computes pass", async () => {
  const manifest = await json("tests/fixtures/evidence/phase0a-nominal.manifest.valid.json");
  const result = await json("tests/fixtures/evidence/phase0a-nominal.result.valid.json");
  const verification = verifyRun({
    manifest, result, catalog, keyring,
    validateManifestSchema: ajv.getSchema("https://local.audio.invalid/tests/phase0a-capture-run.schema.json"),
    validateResultSchema: ajv.getSchema("https://local.audio.invalid/tests/evidence-result.schema.json")
  });
  assert.deepEqual(verification, { outcome: "pass", test_id: manifest.test_id, result_id: result.result_id });
});

test("a schema-valid result containing a failed assertion cannot promote", async () => {
  const manifest = await json("tests/fixtures/evidence/phase0a-nominal.manifest.valid.json");
  const result = await json("tests/fixtures/evidence/phase0a-nominal.result.false-pass.json");
  assert.throws(() => verifyRun({
    manifest, result, catalog, keyring,
    validateManifestSchema: ajv.getSchema("https://local.audio.invalid/tests/phase0a-capture-run.schema.json"),
    validateResultSchema: ajv.getSchema("https://local.audio.invalid/tests/evidence-result.schema.json")
  }), /did not pass/);
});

test("phase promotion requires every closed catalogue test", () => {
  assert.throws(() => verifyPromotion("0A", [{ outcome: "pass", test_id: "capture.64ch.48k.nominal-soak.v1" }], catalog), /missing passing test/);
});

test("Phase 1 operator catalogue freezes fixture, repetitions, faults, assertions and artifacts", async () => {
  const operatorCatalog = await json("tests/catalog/operator-tests.v0.json");
  const validate = ajv.getSchema("https://local.audio.invalid/tests/phase1-operator-run.schema.json");
  const selected = operatorCatalog.tests["operator.1a1.identify-monitor.v1"];
  const manifest = {
    schema_version: "phase1-operator-run/v0",
    manifest_id: "11111111-1111-4111-8111-111111111111",
    test_id: "operator.1a1.identify-monitor.v1",
    commit: "0123456789abcdef0123456789abcdef01234567",
    fixture_revision: "theatre-reference/v1",
    operators: [
      {participant_id: "22222222-2222-4222-8222-222222222222", role: "a1", experience_band: "working"},
      {participant_id: "33333333-3333-4333-8333-333333333333", role: "a2", experience_band: "senior"}
    ],
    training: {script_revision: "operator-training/v1", minutes: 60, competency_check_passed: true},
    repetitions: 5,
    blind_faults: selected.required_faults,
    thresholds: {detection_p95_ms: 5000, correct_action_p95_ms: 15000, swap_p95_ms: 20000, recovery_p95_ms: 120000, maximum_noncritical_errors: 2, wrong_source_actions: 0, unsafe_actions: 0},
    abort_criteria: ["hearing-safety", "programme-path-risk", "wrong-source-action", "loss-of-conventional-comms", "observer-stop"],
    assertion_ids: selected.required_assertions,
    artifact_kinds: selected.required_artifacts
  };
  assert.equal(validateOperatorManifest(manifest, operatorCatalog, validate), selected);
  assert.throws(() => validateOperatorManifest({...manifest, repetitions: 4}, operatorCatalog, validate), /schema|repetitions/);

  const unsignedResult = {
    schema_version: "evidence-result/v0",
    result_id: "44444444-4444-4444-8444-444444444444",
    manifest_id: manifest.manifest_id,
    manifest_sha256: sha256Hex(manifest),
    test_id: manifest.test_id,
    commit: manifest.commit,
    runner_id: "operator-lab-1",
    started_utc: "2026-09-19T01:00:00Z",
    ended_utc: "2026-09-19T02:00:00Z",
    assertions: selected.required_assertions.map(id => ({id, status: "pass", observed: true, unit: "boolean"})),
    artifacts: selected.required_artifacts.map((kind, index) => ({kind, sha256: String(index + 1).padStart(64, "0"), bytes: 1, store_key: `operator/${kind}`})),
    deviations: [],
    waiver_ids: []
  };
  const signingKey = keyring.keys.find(key => key.key_id === "test-runner-2026");
  const result = signDocument(unsignedResult, signingKey.private_jwk, signingKey.key_id);
  const verified = verifyOperatorRun({manifest, result, catalog: operatorCatalog, keyring, validateManifestSchema: validate, validateResultSchema: ajv.getSchema("https://local.audio.invalid/tests/evidence-result.schema.json")});
  assert.equal(verified.outcome, "pass");
});

test("canonical command validates and its ES256 test vector verifies", async () => {
  const command = await json("tests/fixtures/protocol/v0/runtime-command.valid.json");
  const validate = ajv.getSchema("https://local.audio.invalid/protocol/v0/runtime-command.schema.json");
  assert.equal(validate(command), true, JSON.stringify(validate.errors));
  const publicJwk = keyring.keys.find(key => key.key_id === command.signature.kid).public_jwk;
  const valid = verifySignature("sha256", Buffer.from(canonicalize(command.signed)), {
    key: createPublicKey({ key: publicJwk, format: "jwk" }), dsaEncoding: "ieee-p1363"
  }, Buffer.from(command.signature.value, "base64url"));
  assert.equal(valid, true);
});

test("boot authority grant is signature-bound to its exact boot", async () => {
  const grant = await json("tests/fixtures/protocol/v0/boot-authority-grant.valid.json");
  const validate = ajv.getSchema("https://local.audio.invalid/protocol/v0/boot-authority-grant.schema.json");
  assert.equal(validate(grant), true, JSON.stringify(validate.errors));
  const publicJwk = keyring.keys.find(key => key.key_id === grant.signature.kid).public_jwk;
  const key = createPublicKey({ key: publicJwk, format: "jwk" });
  const signature = Buffer.from(grant.signature.value, "base64url");
  assert.equal(verifySignature("sha256", Buffer.from(canonicalize(grant.signed)), { key, dsaEncoding: "ieee-p1363" }, signature), true);
  const wrongBoot = structuredClone(grant.signed);
  wrongBoot.node_boot_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(verifySignature("sha256", Buffer.from(canonicalize(wrongBoot)), { key, dsaEncoding: "ieee-p1363" }, signature), false);
});

test("unknown command types are schema-invalid", async () => {
  const command = await json("tests/fixtures/protocol/v0/invalid/runtime-command.unknown-type.json");
  const validate = ajv.getSchema("https://local.audio.invalid/protocol/v0/runtime-command.schema.json");
  assert.equal(validate(command), false);
});

test("event payload and result acknowledgement hashes match their JCS projections", async () => {
  const event = await json("tests/fixtures/protocol/v0/runtime-event.valid.json");
  const eventValidate = ajv.getSchema("https://local.audio.invalid/protocol/v0/runtime-event.schema.json");
  assert.equal(eventValidate(event), true, JSON.stringify(eventValidate.errors));
  assert.equal(event.payload_hash, sha256Hex(event.payload));

  const result = await json("tests/fixtures/protocol/v0/runtime-result.valid.json");
  const resultValidate = ajv.getSchema("https://local.audio.invalid/protocol/v0/runtime-result.schema.json");
  assert.equal(resultValidate(result), true, JSON.stringify(resultValidate.errors));
  assert.equal(result.result_hash, sha256Hex(result.result));
  const { ack_hash: _ackHash, ...ackProjection } = result;
  assert.equal(result.ack_hash, sha256Hex(ackProjection));
});

test("runtime command enums agree with the aggregate transition catalogue", async () => {
  const body = await json("packages/protocol/schema/v0/commands/runtime-command-body.schema.json");
  const transitions = await json("packages/protocol/model/aggregate-transitions.v0.json");
  const commands = aggregate => new Set(transitions.aggregates[aggregate].transitions.map(item => item.command));
  const expectIncluded = (aggregate, definitions) => {
    const catalogued = commands(aggregate);
    for (const definition of definitions) {
      for (const command of enumValues(body, definition)) {
        assert.equal(catalogued.has(command), true, `${command} missing from ${aggregate} transition catalogue`);
      }
    }
  };
  expectIncluded("Performance", ["performanceTransition"]);
  expectIncluded("PhysicalChange", ["assignmentPlan", "componentBoundary", "pathObservation", "verification"]);
  expectIncluded("CueAuthority", ["cueCommand"]);
  for (const [aggregate, machine] of Object.entries(transitions.aggregates)) {
    const seen = new Set();
    for (const transition of machine.transitions) {
      assert.equal(seen.has(transition.command), false, `${aggregate} duplicates ${transition.command}`);
      seen.add(transition.command);
    }
  }
});
