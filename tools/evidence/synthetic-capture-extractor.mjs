import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { parseStrictJson } from "./strict-json.mjs";

/**
 * Extracts bounded synthetic capture metadata only. It proves internal record
 * framing and metadata continuity; it does not inspect PCM samples and cannot
 * establish channel/sample integrity, real-time behavior, or hardware truth.
 */
export const SYNTHETIC_CAPTURE_EXTRACTOR_ID =
  "a2.synthetic-capture-metadata.v1";

export const SYNTHETIC_TRACE_LIMITS = Object.freeze({
  maximumBytes: 18 * 513,
  maximumLineBytes: 512,
});

const BLOCK_COUNT = 16;
const RECORD_COUNT = BLOCK_COUNT + 2;
const BLOCK_DURATION_NS = 10_000_000n;
const MEASUREMENT_DURATION_MS = 160;
const KNOWN_DISCONTINUITY_MASK = 0b111;
const U64_MAX = (1n << 64n) - 1n;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const U64 = /^(0|[1-9][0-9]*)$/;

const FIXED_CONFIG = Object.freeze({
  sampleRateHz: 48_000,
  channelCount: 64,
  framesPerBlock: 480,
  sampleFormat: "f32",
});

function fail(message) {
  throw new Error(`synthetic capture trace: ${message}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} fields are not closed`);
  }
}

function exactConfig(value, label) {
  exactKeys(
    value,
    ["channelCount", "framesPerBlock", "sampleFormat", "sampleRateHz"],
    label,
  );
  for (const [key, expected] of Object.entries(FIXED_CONFIG)) {
    if (value[key] !== expected) fail(`${label}.${key} is not the fixed tuple`);
  }
}

function u64(value, label, { nonzero = false } = {}) {
  if (typeof value !== "string" || !U64.test(value)) {
    fail(`${label} must be a canonical decimal u64 string`);
  }
  if (value.length > 20) fail(`${label} is outside its allowed u64 range`);
  const parsed = BigInt(value);
  if (parsed > U64_MAX || (nonzero && parsed === 0n)) {
    fail(`${label} is outside its allowed u64 range`);
  }
  return parsed;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer in ${minimum}..${maximum}`);
  }
  return value;
}

function validateManifest(manifestBytes) {
  const manifest = parseStrictJson(manifestBytes);
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "a2-evidence-run-manifest"
  ) {
    fail("manifest identity is invalid");
  }
  if (!Array.isArray(manifest.trials) || manifest.trials.length !== 1) {
    fail("manifest must contain exactly one trial");
  }
  const trial = manifest.trials[0];
  if (
    trial === null ||
    typeof trial !== "object" ||
    Array.isArray(trial) ||
    typeof trial.id !== "string" ||
    !IDENTIFIER.test(trial.id)
  ) {
    fail("manifest trial ID is invalid");
  }
  if (trial.warmupMs !== 0 || trial.measurementMs !== MEASUREMENT_DURATION_MS) {
    fail(
      `manifest trial must declare zero warmup and the fixed ${MEASUREMENT_DURATION_MS} ms trace duration`,
    );
  }
  return trial.id;
}

function validateStart(record) {
  exactKeys(
    record,
    [
      "captureEpoch",
      "expectedBlockCount",
      "promotionEligible",
      "recordType",
      "requested",
      "resolved",
      "schemaVersion",
    ],
    "start record",
  );
  if (record.schemaVersion !== 1 || record.recordType !== "capture_start") {
    fail("start record identity is invalid");
  }
  if (record.promotionEligible !== false)
    fail("start record must be non-promotional");
  if (record.expectedBlockCount !== BLOCK_COUNT)
    fail("start expected block count is invalid");
  exactConfig(record.requested, "start requested");
  exactConfig(record.resolved, "start resolved");
  return u64(record.captureEpoch, "start captureEpoch", { nonzero: true });
}

function validateBlock(record, index, state) {
  const label = `block record ${index}`;
  exactKeys(
    record,
    [
      "captureEpoch",
      "channelCount",
      "cumulativeSourceXruns",
      "discontinuityFlags",
      "firstFrameIndex",
      "frameCount",
      "monotonicCaptureNs",
      "recordType",
      "schemaVersion",
      "sequence",
      "timingUncertaintyNs",
    ],
    label,
  );
  if (record.schemaVersion !== 1 || record.recordType !== "capture_block") {
    fail(`${label} identity is invalid`);
  }
  if (
    u64(record.captureEpoch, `${label} captureEpoch`, { nonzero: true }) !==
    state.epoch
  ) {
    fail(`${label} capture epoch changed`);
  }
  const sequence = u64(record.sequence, `${label} sequence`);
  const firstFrame = u64(record.firstFrameIndex, `${label} firstFrameIndex`);
  if (sequence !== BigInt(index)) fail(`${label} sequence is not continuous`);
  if (firstFrame !== BigInt(index * FIXED_CONFIG.framesPerBlock)) {
    fail(`${label} frame index is not continuous`);
  }
  if (record.frameCount !== FIXED_CONFIG.framesPerBlock) {
    fail(`${label} frame count does not match the fixed tuple`);
  }
  if (record.channelCount !== FIXED_CONFIG.channelCount) {
    fail(`${label} channel count does not match the fixed tuple`);
  }
  const timing = u64(record.monotonicCaptureNs, `${label} monotonicCaptureNs`);
  if (timing !== BigInt(index) * BLOCK_DURATION_NS) {
    fail(`${label} timing does not match its exact synthetic frame position`);
  }
  if (record.timingUncertaintyNs !== 0) {
    fail(`${label} timing uncertainty is not exact`);
  }
  const xruns = u64(
    record.cumulativeSourceXruns,
    `${label} cumulativeSourceXruns`,
  );
  if (state.lastXruns !== null && xruns < state.lastXruns) {
    fail(`${label} cumulative source xruns decreased`);
  }
  state.lastXruns = xruns;
  const flags = integer(
    record.discontinuityFlags,
    `${label} discontinuityFlags`,
    0,
    255,
  );
  if ((flags & ~KNOWN_DISCONTINUITY_MASK) !== 0) {
    fail(`${label} has unknown discontinuity flags`);
  }
  state.discontinuityMask |= flags;
}

function validateEnd(record, state) {
  exactKeys(
    record,
    ["captureEpoch", "observedBlockCount", "recordType", "schemaVersion"],
    "end record",
  );
  if (record.schemaVersion !== 1 || record.recordType !== "capture_end") {
    fail("end record identity is invalid");
  }
  if (
    u64(record.captureEpoch, "end captureEpoch", { nonzero: true }) !==
    state.epoch
  ) {
    fail("end capture epoch changed");
  }
  if (record.observedBlockCount !== BLOCK_COUNT)
    fail("end observed block count is invalid");
}

function metrics(state, trialId, manifestSha256, rawTraceSha256) {
  return {
    schemaVersion: 1,
    kind: "a2-synthetic-capture-extracted-metrics",
    extractorId: SYNTHETIC_CAPTURE_EXTRACTOR_ID,
    evidenceScope: "synthetic-metadata-only",
    promotionEligible: false,
    manifestSha256,
    sourceTraceSha256: rawTraceSha256,
    trials: [
      {
        id: trialId,
        measurements: [
          { id: "block-count", unit: "blocks", value: BLOCK_COUNT },
          { id: "continuity-ok", unit: "boolean", value: true },
          {
            id: "cumulative-source-xruns",
            unit: "decimal-u64",
            value: state.lastXruns.toString(),
          },
          {
            id: "discontinuity-mask-or",
            unit: "bitmask",
            value: state.discontinuityMask,
          },
          { id: "timing-exact", unit: "boolean", value: true },
        ],
      },
    ],
  };
}

export async function extractSyntheticCaptureMetrics({
  input,
  manifestBytes,
  maximumBytes = SYNTHETIC_TRACE_LIMITS.maximumBytes,
  maximumLineBytes = SYNTHETIC_TRACE_LIMITS.maximumLineBytes,
}) {
  if (!input || typeof input[Symbol.asyncIterator] !== "function") {
    throw new TypeError("input must be an async iterable of bytes");
  }
  if (!(manifestBytes instanceof Uint8Array)) {
    throw new TypeError("manifestBytes must be a Uint8Array");
  }
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > SYNTHETIC_TRACE_LIMITS.maximumBytes
  ) {
    throw new TypeError(
      "maximumBytes must be within the immutable trace limit",
    );
  }
  if (
    !Number.isSafeInteger(maximumLineBytes) ||
    maximumLineBytes < 1 ||
    maximumLineBytes > SYNTHETIC_TRACE_LIMITS.maximumLineBytes
  ) {
    throw new TypeError(
      "maximumLineBytes must be within the immutable line limit",
    );
  }

  const trialId = validateManifest(manifestBytes);
  const manifestSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  const traceHash = createHash("sha256");
  const records = [];
  let pending = Buffer.alloc(0);
  let totalBytes = 0;
  let endedWithLf = false;

  for await (const chunk of input) {
    if (!(chunk instanceof Uint8Array)) fail("input yielded a non-byte chunk");
    totalBytes += chunk.byteLength;
    if (totalBytes > maximumBytes) fail("input exceeds maximumBytes");
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    traceHash.update(bytes);
    pending = Buffer.concat([pending, bytes]);
    if (bytes.byteLength > 0) {
      endedWithLf = bytes[bytes.byteLength - 1] === 0x0a;
    }
    while (true) {
      const newline = pending.indexOf(0x0a);
      if (newline === -1) break;
      if (newline === 0) fail("empty JSONL record");
      if (newline > maximumLineBytes) fail("line exceeds maximumLineBytes");
      records.push(parseStrictJson(pending.subarray(0, newline)));
      if (records.length > RECORD_COUNT) fail("trace has extra records");
      pending = pending.subarray(newline + 1);
    }
    if (pending.byteLength > maximumLineBytes)
      fail("line exceeds maximumLineBytes");
  }
  if (!endedWithLf || pending.byteLength !== 0) fail("trace is truncated");
  if (records.length !== RECORD_COUNT) {
    fail(`trace must contain exactly ${RECORD_COUNT} records`);
  }

  const state = {
    epoch: validateStart(records[0]),
    lastXruns: null,
    discontinuityMask: 0,
  };
  for (let index = 0; index < BLOCK_COUNT; index += 1) {
    validateBlock(records[index + 1], index, state);
  }
  validateEnd(records[RECORD_COUNT - 1], state);
  return metrics(state, trialId, manifestSha256, traceHash.digest("hex"));
}
