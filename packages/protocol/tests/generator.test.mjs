import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedSchema } from "../scripts/generate-http-contracts.mjs";

test("the generator rejects unsupported assertion keywords", () => {
  assert.throws(
    () =>
      assertSupportedSchema({
        type: "string",
        pattern: "^[a-z]+$",
      }),
    /Unsupported schema keyword pattern/,
  );
});

test("the generator checks nested schema keywords", () => {
  assert.throws(
    () =>
      assertSupportedSchema({
        type: "object",
        properties: {
          nested: { type: "array", minItems: 1, items: { type: "string" } },
        },
      }),
    /Unsupported schema keyword minItems.*properties\/nested/,
  );
});

test("the generator accepts the implemented date-time format assertion", () => {
  assert.doesNotThrow(() =>
    assertSupportedSchema({ type: "string", format: "date-time" }),
  );
});

test("the generator rejects unimplemented format assertions", () => {
  assert.throws(
    () => assertSupportedSchema({ type: "string", format: "email" }),
    /Unsupported schema format email/,
  );
});
