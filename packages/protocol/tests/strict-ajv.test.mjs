import assert from "node:assert/strict";
import test from "node:test";
import {
  createStrictAjv2020,
  stringifyValidatedJson,
} from "../validation/strict-ajv.mjs";

test("strict configuration rejects unknown schema keywords", () => {
  const ajv = createStrictAjv2020();

  assert.throws(
    () => ajv.compile({ type: "string", unsupportedKeyword: true }),
    /strict mode: unknown keyword/,
  );
});

test("validation never coerces, defaults, or removes properties", () => {
  const ajv = createStrictAjv2020();
  const validate = ajv.compile({
    type: "object",
    additionalProperties: false,
    properties: {
      count: { type: "integer", default: 7 },
    },
    required: ["count"],
  });
  const value = { count: "7", undeclared: true };
  const before = structuredClone(value);

  assert.equal(validate(value), false);
  assert.deepEqual(value, before);

  const missing = {};
  assert.equal(validate(missing), false);
  assert.deepEqual(missing, {});
});

test("compiling a frozen schema does not mutate it", () => {
  const schema = Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({ enabled: Object.freeze({ type: "boolean" }) }),
  });
  const before = structuredClone(schema);

  createStrictAjv2020().compile(schema);

  assert.deepEqual(schema, before);
});

test("validation accepts frozen input without attempting writes", () => {
  const ajv = createStrictAjv2020();
  const validate = ajv.compile({
    type: "object",
    additionalProperties: false,
    properties: { enabled: { type: "boolean" } },
    required: ["enabled"],
  });
  const value = Object.freeze({ enabled: true });

  assert.equal(validate(value), true);
  assert.deepEqual(value, { enabled: true });
});

test("required fields must be own properties", () => {
  const validate = createStrictAjv2020().compile({
    type: "object",
    additionalProperties: false,
    properties: { enabled: { type: "boolean" } },
    required: ["enabled"],
  });
  const value = Object.create({ enabled: true });

  assert.equal(validate(value), false);
});

test("serialized JSON is validated after toJSON transformation", () => {
  const validate = createStrictAjv2020().compile({
    type: "object",
    additionalProperties: false,
    properties: { enabled: { type: "boolean" } },
    required: ["enabled"],
  });
  const value = { enabled: true };
  Object.defineProperty(value, "toJSON", {
    value: () => ({ enabled: true, undeclared: true }),
  });

  assert.throws(
    () => stringifyValidatedJson(validate, value),
    /Serialized response contract violation/,
  );
});

test("registered date-time format rejects impossible calendar dates", () => {
  const validate = createStrictAjv2020().compile({
    type: "string",
    format: "date-time",
  });

  assert.equal(validate("2026-02-31T00:00:00Z"), false);
});

test("separate factories do not share registered schemas", () => {
  const first = createStrictAjv2020();
  const second = createStrictAjv2020();
  first.addSchema({ $id: "urn:a2:test-only", type: "boolean" });

  assert.ok(first.getSchema("urn:a2:test-only"));
  assert.equal(second.getSchema("urn:a2:test-only"), undefined);
});
