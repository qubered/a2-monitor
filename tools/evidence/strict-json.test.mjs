import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  canonicalize,
  parseStrictJson,
  sha256Canonical,
} from "./strict-json.mjs";

const bytes = (value) => Buffer.from(value, "utf8");

test("parses closed JSON into null-prototype objects and canonicalizes it", () => {
  const value = parseStrictJson(
    bytes('{"z":[null,true,false,9007199254740991],"a":{"safe":-12}}'),
  );

  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.getPrototypeOf(value.a), null);
  assert.equal(
    canonicalize(value),
    '{"a":{"safe":-12},"z":[null,true,false,9007199254740991]}',
  );
  assert.match(sha256Canonical(value), /^[0-9a-f]{64}$/);
});

test("sorts object keys by UTF-16 code units without Unicode normalization", () => {
  const value = parseStrictJson(
    bytes(
      '{"€":"Euro Sign","\\r":"Carriage Return","דּ":"Hebrew Letter Dalet With Dagesh","1":"One","😀":"Emoji: Grinning Face","":"Control","ö":"Latin Small Letter O With Diaeresis"}',
    ),
  );

  assert.equal(
    canonicalize(value),
    '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  );

  const composedAndDecomposed = parseStrictJson(bytes('{"é":1,"é":2}'));
  assert.equal(canonicalize(composedAndDecomposed), '{"é":2,"é":1}');
});

test("rejects duplicate decoded keys, including escaped aliases", () => {
  assert.throws(
    () => parseStrictJson(bytes('{"key":1,"key":2}')),
    /duplicate object key/,
  );
  assert.throws(
    () => parseStrictJson(bytes('{"key":1,"k\\u0065y":2}')),
    /duplicate object key/,
  );
  assert.throws(
    () => parseStrictJson(bytes('{"__proto__":1,"\\u005f_proto__":2}')),
    /duplicate object key/,
  );
});

test("rejects BOM, invalid UTF-8, trailing data, and non-JSON whitespace", () => {
  assert.throws(
    () => parseStrictJson(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    /BOM/,
  );
  assert.throws(
    () => parseStrictJson(Buffer.from([0x22, 0xc0, 0xaf, 0x22])),
    /valid UTF-8/,
  );
  assert.throws(() => parseStrictJson(bytes("{}{}")), /trailing content/);
  assert.throws(
    () => parseStrictJson(bytes("\u00a0{}")),
    /expected JSON value/,
  );
  assert.throws(() => parseStrictJson("{}"), /Uint8Array of UTF-8 bytes/);
});

test("rejects lone surrogates in escapes and canonical input values", () => {
  assert.throws(
    () => parseStrictJson(bytes('"\\ud800"')),
    /lone high surrogate/,
  );
  assert.throws(
    () => parseStrictJson(bytes('"\\udc00"')),
    /lone low surrogate/,
  );
  assert.throws(
    () => parseStrictJson(bytes('"\\ud800\\u0041"')),
    /not followed by a low surrogate/,
  );
  assert.equal(parseStrictJson(bytes('"\\ud83d\\ude00"')), "😀");
  assert.throws(() => canonicalize("\ud800"), /lone high surrogate/);
});

test("accepts only safe integer number syntax", () => {
  for (const valid of [
    "0",
    "1",
    "-1",
    "9007199254740991",
    "-9007199254740991",
  ]) {
    assert.equal(parseStrictJson(bytes(valid)), Number(valid));
  }
  for (const invalid of [
    "-0",
    "01",
    "1.0",
    "1e0",
    "1E3",
    "9007199254740992",
    "-9007199254740992",
  ]) {
    assert.throws(() => parseStrictJson(bytes(invalid)));
  }
  for (const invalid of [-0, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => canonicalize(invalid), /safe integers|negative zero/);
  }
});

test("enforces input, depth, member, item, string, and total-value limits", () => {
  assert.throws(
    () => parseStrictJson(bytes("null"), { maxInputBytes: 3 }),
    /maxInputBytes/,
  );
  assert.throws(
    () => parseStrictJson(bytes("[[0]]"), { maxDepth: 1 }),
    /maxDepth/,
  );
  assert.throws(
    () => parseStrictJson(bytes('{"a":1,"b":2}'), { maxObjectMembers: 1 }),
    /maxObjectMembers/,
  );
  assert.throws(
    () => parseStrictJson(bytes("[1,2]"), { maxArrayItems: 1 }),
    /maxArrayItems/,
  );
  assert.throws(
    () => parseStrictJson(bytes('"😀"'), { maxStringBytes: 3 }),
    /maxStringBytes/,
  );
  assert.throws(
    () => parseStrictJson(bytes("[1,2]"), { maxTotalValues: 2 }),
    /maxTotalValues/,
  );
  assert.throws(
    () => parseStrictJson(bytes("null"), { misspelledLimit: 1 }),
    /unknown strict JSON option/,
  );
});

test("canonicalization rejects prototypes, accessors, sparse arrays, extras, and cycles", () => {
  assert.throws(() => canonicalize({ value: 1 }), /null prototype/);

  const accessor = Object.create(null);
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => 1,
  });
  assert.throws(() => canonicalize(accessor), /data properties only/);

  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalize(sparse), /dense data arrays/);

  const extra = [1];
  extra.note = true;
  assert.throws(() => canonicalize(extra), /extra properties/);

  const cyclic = Object.create(null);
  cyclic.self = cyclic;
  assert.throws(() => canonicalize(cyclic), /cycle/);
});
