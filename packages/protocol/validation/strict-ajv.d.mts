import type Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

export function createStrictAjv2020(): Ajv2020;

export function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
): string;

export function stringifyValidatedJson(
  validate: ValidateFunction,
  value: unknown,
): string;
