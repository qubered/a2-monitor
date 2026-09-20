import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { URL } from "node:url";
import {
  SYNTHETIC_CAPTURE_EXTRACTOR_ID,
  extractSyntheticCaptureMetrics,
} from "./synthetic-capture-extractor.mjs";

const manifestBytes = Buffer.from(
  '{"schemaVersion":1,"kind":"a2-evidence-run-manifest","trials":[{"id":"trial-001","warmupMs":0,"measurementMs":160}]}\n',
);
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const runtimeFixtureUrl = new URL(
  "fixtures/synthetic-capture-trace-v1.jsonl",
  import.meta.url,
);

function fixtureRecords() {
  const config = {
    sampleRateHz: 48_000,
    channelCount: 64,
    framesPerBlock: 480,
    sampleFormat: "f32",
  };
  return [
    {
      schemaVersion: 1,
      recordType: "capture_start",
      promotionEligible: false,
      expectedBlockCount: 16,
      captureEpoch: "7",
      requested: { ...config },
      resolved: { ...config },
    },
    ...Array.from({ length: 16 }, (_, index) => ({
      schemaVersion: 1,
      recordType: "capture_block",
      captureEpoch: "7",
      sequence: String(index),
      firstFrameIndex: String(index * 480),
      frameCount: 480,
      channelCount: 64,
      monotonicCaptureNs: String(index * 10_000_000),
      timingUncertaintyNs: 0,
      cumulativeSourceXruns: index < 8 ? "0" : "2",
      discontinuityFlags: index === 8 ? 1 : 0,
    })),
    {
      schemaVersion: 1,
      recordType: "capture_end",
      captureEpoch: "7",
      observedBlockCount: 16,
    },
  ];
}

function encode(records = fixtureRecords(), finalLf = true) {
  return Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}${finalLf ? "\n" : ""}`,
  );
}

function chunks(bytes, size = 37) {
  const result = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    result.push(bytes.subarray(offset, offset + size));
  }
  return Readable.from(result);
}

async function extract(bytes, options = {}) {
  return extractSyntheticCaptureMetrics({
    input: chunks(bytes),
    manifestBytes,
    ...options,
  });
}

test("extracts non-promotional metadata-only metrics from a bounded JSONL trace", async () => {
  const bytes = encode();
  const result = await extract(bytes);
  assert.deepEqual(result, {
    schemaVersion: 1,
    kind: "a2-synthetic-capture-extracted-metrics",
    extractorId: SYNTHETIC_CAPTURE_EXTRACTOR_ID,
    evidenceScope: "synthetic-metadata-only",
    promotionEligible: false,
    manifestSha256,
    sourceTraceSha256: createHash("sha256").update(bytes).digest("hex"),
    trials: [
      {
        id: "trial-001",
        measurements: [
          { id: "block-count", unit: "blocks", value: 16 },
          { id: "continuity-ok", unit: "boolean", value: true },
          {
            id: "cumulative-source-xruns",
            unit: "decimal-u64",
            value: "2",
          },
          { id: "discontinuity-mask-or", unit: "bitmask", value: 1 },
          { id: "timing-exact", unit: "boolean", value: true },
        ],
      },
    ],
  });
  assert.equal(result.promotionEligible, false);
  assert.equal(result.evidenceScope, "synthetic-metadata-only");
  assert.equal(Object.hasOwn(result.trials[0], "pcmIntegrity"), false);
});

test("extracts the byte-for-byte runtime trace fixture", async () => {
  const bytes = await readFile(runtimeFixtureUrl);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "5eca335523d5ff75590eeb7b81229d6ebbb29135f5078c3d9625ffd184faa97b",
  );
  const result = await extract(bytes);
  assert.equal(
    result.sourceTraceSha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.deepEqual(result.trials[0].measurements, [
    { id: "block-count", unit: "blocks", value: 16 },
    { id: "continuity-ok", unit: "boolean", value: true },
    { id: "cumulative-source-xruns", unit: "decimal-u64", value: "0" },
    { id: "discontinuity-mask-or", unit: "bitmask", value: 0 },
    { id: "timing-exact", unit: "boolean", value: true },
  ]);
});

test("rejects malformed, truncated, extra, and oversized traces", async () => {
  await assert.rejects(
    () => extract(Buffer.from("{broken}\n")),
    /expected string/,
  );
  await assert.rejects(
    () => extract(encode(fixtureRecords(), false)),
    /truncated/,
  );
  await assert.rejects(
    () => extract(encode([...fixtureRecords(), fixtureRecords()[0]])),
    /extra records/,
  );
  const bytes = encode();
  await assert.rejects(
    () => extract(bytes, { maximumBytes: bytes.byteLength - 1 }),
    /exceeds maximumBytes/,
  );
  await assert.rejects(
    () => extract(bytes, { maximumLineBytes: 32 }),
    /line exceeds maximumLineBytes/,
  );
});

test("rejects closed-field, framing, tuple, and epoch violations", async () => {
  for (const [mutate, pattern] of [
    [(records) => (records[0].extra = true), /fields are not closed/],
    [(records) => (records[0].promotionEligible = true), /non-promotional/],
    [(records) => (records[0].expectedBlockCount = 15), /expected block count/],
    [(records) => (records[0].resolved.channelCount = 63), /fixed tuple/],
    [(records) => (records[1].captureEpoch = "8"), /capture epoch changed/],
    [(records) => (records[0].captureEpoch = "0"), /allowed u64 range/],
    [(records) => (records[0].captureEpoch = "07"), /canonical decimal u64/],
    [
      (records) => (records[0].captureEpoch = (1n << 64n).toString()),
      /allowed u64 range/,
    ],
    [
      (records) => (records[17].recordType = "capture_block"),
      /end record identity/,
    ],
  ]) {
    const records = fixtureRecords();
    mutate(records);
    await assert.rejects(() => extract(encode(records)), pattern);
  }
});

test("rejects sequence/frame gaps and timing that is absent or not frame-exact", async () => {
  for (const [mutate, pattern] of [
    [(records) => (records[5].sequence = "9"), /sequence is not continuous/],
    [
      (records) => (records[5].firstFrameIndex = "999"),
      /frame index is not continuous/,
    ],
    [
      (records) => {
        records[5].monotonicCaptureNs = null;
      },
      /canonical decimal u64 string/,
    ],
    [
      (records) => {
        records[5].monotonicCaptureNs = "40000001";
      },
      /timing does not match/,
    ],
    [
      (records) => {
        records[5].cumulativeSourceXruns = "3";
        records[6].cumulativeSourceXruns = "2";
      },
      /source xruns decreased/,
    ],
    [
      (records) => (records[4].discontinuityFlags = 8),
      /unknown discontinuity flags/,
    ],
    [
      (records) => (records[4].timingUncertaintyNs = null),
      /timing uncertainty is not exact/,
    ],
  ]) {
    const records = fixtureRecords();
    mutate(records);
    await assert.rejects(() => extract(encode(records)), pattern);
  }
});

test("rejects missing records and invalid end continuity", async () => {
  await assert.rejects(
    () => extract(encode(fixtureRecords().slice(0, -1))),
    /exactly 18 records/,
  );
  for (const [field, value, pattern] of [
    ["observedBlockCount", 15, /end observed block count/],
    ["captureEpoch", "8", /end capture epoch changed/],
  ]) {
    const records = fixtureRecords();
    records[17][field] = value;
    await assert.rejects(() => extract(encode(records)), pattern);
  }
});

test("does not permit callers to raise immutable byte limits", async () => {
  await assert.rejects(
    () =>
      extract(encode(), {
        maximumBytes: 18 * 513 + 1,
      }),
    /immutable trace limit/,
  );
  await assert.rejects(
    () =>
      extract(encode(), {
        maximumLineBytes: 513,
      }),
    /immutable line limit/,
  );
});

test("validates the separate manifest and sources the trial ID from it", async () => {
  for (const [manifest, pattern] of [
    [
      {
        schemaVersion: 2,
        kind: "a2-evidence-run-manifest",
        trials: [{ id: "trial-001", warmupMs: 0, measurementMs: 160 }],
      },
      /manifest identity/,
    ],
    [
      {
        schemaVersion: 1,
        kind: "wrong",
        trials: [{ id: "trial-001", warmupMs: 0, measurementMs: 160 }],
      },
      /manifest identity/,
    ],
    [
      { schemaVersion: 1, kind: "a2-evidence-run-manifest", trials: [] },
      /exactly one trial/,
    ],
    [
      {
        schemaVersion: 1,
        kind: "a2-evidence-run-manifest",
        trials: [
          { id: "trial-001", warmupMs: 0, measurementMs: 160 },
          { id: "trial-002", warmupMs: 0, measurementMs: 160 },
        ],
      },
      /exactly one trial/,
    ],
    [
      {
        schemaVersion: 1,
        kind: "a2-evidence-run-manifest",
        trials: [{ id: "BAD ID", warmupMs: 0, measurementMs: 160 }],
      },
      /trial ID/,
    ],
  ]) {
    await assert.rejects(
      () =>
        extractSyntheticCaptureMetrics({
          input: chunks(encode()),
          manifestBytes: Buffer.from(JSON.stringify(manifest)),
        }),
      pattern,
    );
  }

  for (const [warmupMs, measurementMs] of [
    [1, 160],
    [0, 159],
    [0, 1000],
  ]) {
    await assert.rejects(
      () =>
        extractSyntheticCaptureMetrics({
          input: chunks(encode()),
          manifestBytes: Buffer.from(
            JSON.stringify({
              schemaVersion: 1,
              kind: "a2-evidence-run-manifest",
              trials: [{ id: "trial-001", warmupMs, measurementMs }],
            }),
          ),
        }),
      /fixed 160 ms trace duration/,
    );
  }
});
