/**
 * Strict, bounded JSON for evidence-control inputs.
 *
 * `parseStrictJson(bytes, options?)` accepts UTF-8 bytes only and returns arrays,
 * primitives, and null-prototype objects. It rejects duplicate decoded keys,
 * ambiguous numeric forms, invalid Unicode, and inputs outside the configured
 * limits. `canonicalize(value, options?)` emits deterministic RFC 8785-style
 * JSON for the same deliberately narrow value domain. `sha256Canonical(value,
 * options?)` hashes those canonical UTF-8 bytes.
 */

import { createHash } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxDepth: 32,
  maxObjectMembers: 1024,
  maxArrayItems: 4096,
  maxStringBytes: 64 * 1024,
  maxTotalValues: 100_000,
});

const LIMIT_NAMES = new Set(Object.keys(DEFAULT_LIMITS));
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

function limitsFrom(options = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("strict JSON options must be an object");
  }
  for (const name of Object.keys(options)) {
    if (!LIMIT_NAMES.has(name)) {
      throw new TypeError(`unknown strict JSON option: ${name}`);
    }
  }
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    const minimum = name === "maxDepth" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
    }
  }
  return limits;
}

function assertValidUnicode(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new SyntaxError(`${label} contains a lone high surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new SyntaxError(`${label} contains a lone low surrogate`);
    }
  }
}

function assertStringLimit(value, limits, label) {
  assertValidUnicode(value, label);
  if (utf8Encoder.encode(value).byteLength > limits.maxStringBytes) {
    throw new RangeError(`${label} exceeds maxStringBytes`);
  }
}

export function parseStrictJson(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(
      "strict JSON input must be a Uint8Array of UTF-8 bytes",
    );
  }
  const limits = limitsFrom(options);
  if (bytes.byteLength > limits.maxInputBytes) {
    throw new RangeError("strict JSON input exceeds maxInputBytes");
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new SyntaxError("strict JSON input must not contain a UTF-8 BOM");
  }

  let source;
  try {
    source = utf8Decoder.decode(bytes);
  } catch {
    throw new SyntaxError("strict JSON input is not valid UTF-8");
  }

  let offset = 0;
  let totalValues = 0;

  const fail = (message) => {
    throw new SyntaxError(`${message} at character ${offset}`);
  };

  const skipWhitespace = () => {
    while (
      source[offset] === " " ||
      source[offset] === "\t" ||
      source[offset] === "\n" ||
      source[offset] === "\r"
    ) {
      offset += 1;
    }
  };

  const parseHexQuad = () => {
    const digits = source.slice(offset, offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("invalid Unicode escape");
    offset += 4;
    return Number.parseInt(digits, 16);
  };

  const parseString = () => {
    if (source[offset] !== '"') fail("expected string");
    offset += 1;
    let value = "";
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        assertStringLimit(value, limits, "JSON string");
        return value;
      }
      if (code < 0x20) fail("unescaped control character in string");
      if (code === 0x5c) {
        offset += 1;
        const escape = source[offset];
        offset += 1;
        const simple = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        }[escape];
        if (simple !== undefined) {
          value += simple;
          continue;
        }
        if (escape !== "u") fail("invalid string escape");
        const high = parseHexQuad();
        if (high >= 0xd800 && high <= 0xdbff) {
          if (source.slice(offset, offset + 2) !== "\\u") {
            fail("lone high surrogate escape");
          }
          offset += 2;
          const low = parseHexQuad();
          if (low < 0xdc00 || low > 0xdfff) {
            fail("high surrogate is not followed by a low surrogate");
          }
          value += String.fromCharCode(high, low);
        } else if (high >= 0xdc00 && high <= 0xdfff) {
          fail("lone low surrogate escape");
        } else {
          value += String.fromCharCode(high);
        }
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = source.charCodeAt(offset + 1);
        if (low < 0xdc00 || low > 0xdfff) fail("lone high surrogate");
        value += source[offset] + source[offset + 1];
        offset += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) fail("lone low surrogate");
      value += source[offset];
      offset += 1;
    }
    fail("unterminated string");
  };

  const parseNumber = () => {
    const start = offset;
    if (source[offset] === "-") offset += 1;
    if (source[offset] === "0") {
      offset += 1;
      if (source[offset] >= "0" && source[offset] <= "9") {
        fail("leading zero in number");
      }
    } else {
      if (!(source[offset] >= "1" && source[offset] <= "9")) {
        fail("invalid number");
      }
      while (source[offset] >= "0" && source[offset] <= "9") offset += 1;
    }
    if (
      source[offset] === "." ||
      source[offset] === "e" ||
      source[offset] === "E"
    ) {
      fail("strict JSON numbers must be integers without exponent notation");
    }
    const token = source.slice(start, offset);
    if (token === "-0") fail("negative zero is not allowed");
    const value = Number(token);
    if (!Number.isSafeInteger(value)) fail("number is not a safe integer");
    return value;
  };

  const parseValue = (depth) => {
    totalValues += 1;
    if (totalValues > limits.maxTotalValues) {
      throw new RangeError("strict JSON input exceeds maxTotalValues");
    }
    skipWhitespace();
    const first = source[offset];
    if (first === '"') return parseString();
    if (first === "-" || (first >= "0" && first <= "9")) {
      return parseNumber();
    }
    for (const [literal, value] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ]) {
      if (source.startsWith(literal, offset)) {
        offset += literal.length;
        return value;
      }
    }
    if (first !== "[" && first !== "{") fail("expected JSON value");
    if (depth >= limits.maxDepth) {
      throw new RangeError("strict JSON input exceeds maxDepth");
    }

    if (first === "[") {
      offset += 1;
      skipWhitespace();
      const result = [];
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      while (true) {
        if (result.length >= limits.maxArrayItems) {
          throw new RangeError("JSON array exceeds maxArrayItems");
        }
        result.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[offset] === "]") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail("expected ',' or ']' in array");
        offset += 1;
        skipWhitespace();
      }
    }

    offset += 1;
    skipWhitespace();
    const result = Object.create(null);
    let members = 0;
    if (source[offset] === "}") {
      offset += 1;
      return result;
    }
    while (true) {
      if (members >= limits.maxObjectMembers) {
        throw new RangeError("JSON object exceeds maxObjectMembers");
      }
      const key = parseString();
      if (Object.hasOwn(result, key)) fail(`duplicate object key ${key}`);
      skipWhitespace();
      if (source[offset] !== ":") fail("expected ':' after object key");
      offset += 1;
      result[key] = parseValue(depth + 1);
      members += 1;
      skipWhitespace();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") fail("expected ',' or '}' in object");
      offset += 1;
      skipWhitespace();
    }
  };

  const result = parseValue(0);
  skipWhitespace();
  if (offset !== source.length) fail("unexpected trailing content");
  return result;
}

export function canonicalize(value, options = {}) {
  const limits = limitsFrom(options);
  let totalValues = 0;
  const active = new WeakSet();

  const visit = (current, depth) => {
    totalValues += 1;
    if (totalValues > limits.maxTotalValues) {
      throw new RangeError("canonical value exceeds maxTotalValues");
    }
    if (current === null || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "string") {
      assertStringLimit(current, limits, "canonical string");
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isSafeInteger(current)) {
        throw new TypeError("canonical numbers must be safe integers");
      }
      if (Object.is(current, -0)) {
        throw new TypeError("canonical numbers must not be negative zero");
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError(
        `unsupported canonical value type: ${typeof current}`,
      );
    }
    if (depth >= limits.maxDepth) {
      throw new RangeError("canonical value exceeds maxDepth");
    }
    if (active.has(current))
      throw new TypeError("canonical value contains a cycle");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        if (current.length > limits.maxArrayItems) {
          throw new RangeError("canonical array exceeds maxArrayItems");
        }
        const descriptors = Object.getOwnPropertyDescriptors(current);
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            !descriptor ||
            !("value" in descriptor) ||
            !descriptor.enumerable
          ) {
            throw new TypeError("canonical arrays must be dense data arrays");
          }
        }
        const allowed = new Set([
          ...Array.from({ length: current.length }, (_, index) =>
            String(index),
          ),
          "length",
        ]);
        if (Reflect.ownKeys(current).some((key) => !allowed.has(key))) {
          throw new TypeError(
            "canonical arrays must not have extra properties",
          );
        }
        return `[${current.map((item) => visit(item, depth + 1)).join(",")}]`;
      }

      if (Object.getPrototypeOf(current) !== null) {
        throw new TypeError("canonical objects must have a null prototype");
      }
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) {
        throw new TypeError("canonical objects must not have symbol keys");
      }
      if (keys.length > limits.maxObjectMembers) {
        throw new RangeError("canonical object exceeds maxObjectMembers");
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of keys) {
        assertStringLimit(key, limits, "canonical object key");
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(
            "canonical objects must contain enumerable data properties only",
          );
        }
      }
      keys.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      return `{${keys
        .map(
          (key) =>
            `${JSON.stringify(key)}:${visit(descriptors[key].value, depth + 1)}`,
        )
        .join(",")}}`;
    } finally {
      active.delete(current);
    }
  };

  const result = visit(value, 0);
  if (utf8Encoder.encode(result).byteLength > limits.maxInputBytes) {
    throw new RangeError("canonical JSON exceeds maxInputBytes");
  }
  return result;
}

export function sha256Canonical(value, options = {}) {
  return createHash("sha256")
    .update(canonicalize(value, options), "utf8")
    .digest("hex");
}
