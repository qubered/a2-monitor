import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const options = Object.freeze({
  allErrors: true,
  coerceTypes: false,
  ownProperties: true,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
  validateFormats: true,
  validateSchema: true,
});

/**
 * Build the only Ajv configuration permitted for authoritative protocol data.
 * Callers may register schemas and project formats, but cannot override the
 * non-mutating and strict base policy.
 */
export function createStrictAjv2020() {
  const ajv = new Ajv2020(options);
  addFormats(ajv);
  return ajv;
}

export function formatAjvErrors(errors) {
  return (
    errors
      ?.map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      )
      .join("; ") ?? "value is invalid"
  );
}

/**
 * Validate both the supplied value and the JSON value that will cross the
 * boundary. The second pass prevents inherited properties or toJSON hooks from
 * making the bytes differ from the value Ajv inspected.
 */
export function stringifyValidatedJson(validate, value) {
  if (!validate(value)) {
    throw new Error(
      `Response contract violation: ${formatAjvErrors(validate.errors)}`,
    );
  }

  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error(
      "Response contract violation: serialization produced no JSON value",
    );
  }

  const serializedValue = JSON.parse(serialized);
  if (!validate(serializedValue)) {
    throw new Error(
      `Serialized response contract violation: ${formatAjvErrors(validate.errors)}`,
    );
  }
  return serialized;
}
