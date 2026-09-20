import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import test, { after } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { verifyConformanceRun } from "./evidence-verifier.mjs";
import { canonicalize, parseStrictJson } from "./strict-json.mjs";
import { extractSyntheticCaptureMetrics } from "./synthetic-capture-extractor.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const execFileAsync = promisify(execFile);
const temporaryRoots = [];
after(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
  );
});
const verifierPath = fileURLToPath(
  new URL("evidence-verifier.mjs", import.meta.url),
);

function cliArgs(input, overrides = {}) {
  return [
    verifierPath,
    "verify-conformance-run",
    overrides.catalog ?? input.inputPaths.catalog,
    overrides.manifest ?? input.inputPaths.manifest,
    overrides.result ?? input.inputPaths.result,
    overrides.keyring ?? input.inputPaths.keyring,
    input.artifactRoot,
  ];
}

function makeSignedResult(result, privateKey) {
  const signature = sign(
    "sha256",
    Buffer.from(canonicalize(parseStrictJson(jsonBytes(result)))),
    {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    },
  ).toString("base64url");
  return {
    ...result,
    signature: { alg: "ES256", keyId: "runner-test", value: signature },
  };
}

async function bundle({
  mutateCatalog,
  mutateManifest,
  mutateMetrics,
  mutateResult,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "a2-evidence-"));
  temporaryRoots.push(root);
  const catalog = {
    schemaVersion: 1,
    kind: "a2-evidence-verifier-conformance-catalog",
    catalogId: "verifier-self-test.v1",
    promotionEligible: false,
    tests: [
      {
        id: "verifier.predicates.v1",
        metricExtractor: "supplied-conformance-v1",
        minimumTrials: 2,
        minimumWarmupMs: 100,
        minimumMeasurementMs: 1000,
        requiredFaults: ["injected-fault"],
        requiredArtifacts: [
          { kind: "runner-log", maxBytes: 1024, mediaType: "text/plain" },
          {
            kind: "verifier-metrics",
            maxBytes: 65536,
            mediaType: "application/json",
          },
        ],
        assertions: [
          {
            id: "abs",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "abs_max",
            operator: "abs_lte",
            expected: 2,
            unit: "count",
          },
          {
            id: "all",
            sourceArtifactKind: "verifier-metrics",
            valueType: "boolean",
            reducer: "all",
            operator: "eq",
            expected: true,
            unit: "boolean",
          },
          {
            id: "eq",
            sourceArtifactKind: "verifier-metrics",
            valueType: "string",
            reducer: "exact",
            operator: "eq",
            expected: "stable",
            unit: "state",
          },
          {
            id: "gt",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "min",
            operator: "gt",
            expected: 9,
            unit: "count",
          },
          {
            id: "gte",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "min",
            operator: "gte",
            expected: 10,
            unit: "count",
          },
          {
            id: "lt",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "max",
            operator: "lt",
            expected: 11,
            unit: "count",
          },
          {
            id: "lte",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "max",
            operator: "lte",
            expected: 10,
            unit: "count",
          },
        ],
      },
    ],
  };
  mutateCatalog?.(catalog);
  const catalogBytes = jsonBytes(catalog);
  const manifest = {
    schemaVersion: 1,
    kind: "a2-evidence-run-manifest",
    manifestId: "00000000-0000-4000-8000-000000000001",
    catalogSha256: sha256(catalogBytes),
    testId: "verifier.predicates.v1",
    buildId: "a2-0.0.0+sha256.0000000000000000",
    tuple: {
      architecture: "test-arch",
      executionProfile: "synthetic-conformance",
      osFamily: "test-os",
      profileId: "verifier-self-test",
    },
    trials: [0, 1].map((index) => ({
      id: `trial-${index + 1}`,
      warmupMs: 100,
      measurementMs: 1000,
      faults: [
        {
          id: `fault-${index + 1}`,
          kind: "injected-fault",
          startOffsetMs: 100,
          durationMs: 10,
        },
      ],
    })),
  };
  mutateManifest?.(manifest);
  const manifestBytes = jsonBytes(manifest);
  const measurements = [
    { id: "abs", unit: "count", value: -2 },
    { id: "all", unit: "boolean", value: true },
    { id: "eq", unit: "state", value: "stable" },
    { id: "gt", unit: "count", value: 10 },
    { id: "gte", unit: "count", value: 10 },
    { id: "lt", unit: "count", value: 10 },
    { id: "lte", unit: "count", value: 10 },
  ];
  const metrics = {
    schemaVersion: 1,
    kind: "a2-evidence-verifier-metrics",
    manifestSha256: sha256(manifestBytes),
    trials: manifest.trials.map((trial) => ({
      id: trial.id,
      measurements: measurements.map((measurement) => ({ ...measurement })),
    })),
  };
  mutateMetrics?.(metrics);
  const metricsBytes = jsonBytes(metrics);
  const logBytes = Buffer.from("synthetic verifier conformance log\n");
  await writeFile(path.join(root, "runner.log"), logBytes);
  await writeFile(path.join(root, "metrics.json"), metricsBytes);
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const result = {
    schemaVersion: 1,
    kind: "a2-evidence-run-result",
    resultId: "00000000-0000-4000-8000-000000000002",
    manifestSha256: sha256(manifestBytes),
    catalogSha256: sha256(catalogBytes),
    testId: manifest.testId,
    buildId: manifest.buildId,
    runnerId: "synthetic-runner",
    startedUtc: "2026-09-20T00:00:00Z",
    endedUtc: "2026-09-20T00:00:03Z",
    trials: [
      {
        id: "trial-1",
        bootId: "boot-1",
        startedMs: 0,
        warmupEndedMs: 100,
        measurementEndedMs: 1100,
        faults: [{ id: "fault-1", startedMs: 200, endedMs: 210 }],
      },
      {
        id: "trial-2",
        bootId: "boot-1",
        startedMs: 1100,
        warmupEndedMs: 1200,
        measurementEndedMs: 2200,
        faults: [{ id: "fault-2", startedMs: 1300, endedMs: 1310 }],
      },
    ],
    artifacts: [
      {
        kind: "runner-log",
        path: "runner.log",
        mediaType: "text/plain",
        bytes: logBytes.length,
        sha256: sha256(logBytes),
      },
      {
        kind: "verifier-metrics",
        path: "metrics.json",
        mediaType: "application/json",
        bytes: metricsBytes.length,
        sha256: sha256(metricsBytes),
      },
    ],
    deviations: [],
    waiverIds: [],
  };
  mutateResult?.(result);
  const signedResult = makeSignedResult(result, privateKey);
  const keyring = {
    schemaVersion: 1,
    kind: "a2-evidence-keyring",
    keys: [
      {
        keyId: "runner-test",
        purpose: "evidence-run-result",
        status: "active",
        notBeforeUtc: "2026-09-19T00:00:00Z",
        notAfterUtc: "2026-09-21T00:00:00Z",
        publicJwk: publicKey.export({ format: "jwk" }),
      },
    ],
  };
  const resultBytes = jsonBytes(signedResult);
  const keyringBytes = jsonBytes(keyring);
  const inputPaths = {
    catalog: path.join(root, "catalog.json"),
    keyring: path.join(root, "keyring.json"),
    manifest: path.join(root, "manifest.json"),
    result: path.join(root, "result.json"),
  };
  await Promise.all([
    writeFile(inputPaths.catalog, catalogBytes),
    writeFile(inputPaths.keyring, keyringBytes),
    writeFile(inputPaths.manifest, manifestBytes),
    writeFile(inputPaths.result, resultBytes),
  ]);
  return {
    artifactRoot: root,
    catalogBytes,
    manifestBytes,
    resultBytes,
    keyringBytes,
    inputPaths,
  };
}

function syntheticTraceRecords() {
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
      discontinuityFlags: 0,
      cumulativeSourceXruns: "0",
    })),
    {
      schemaVersion: 1,
      recordType: "capture_end",
      captureEpoch: "7",
      observedBlockCount: 16,
    },
  ];
}

function traceBytes(records) {
  return Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

function canonicalBytes(value) {
  return Buffer.from(
    canonicalize(parseStrictJson(Buffer.from(JSON.stringify(value)))),
  );
}

async function syntheticBundle({
  mutateTrace,
  mutateMetrics,
  mutateSourceTrace,
  mutateResult,
  omitTrace = false,
  metricExtractor = "a2.synthetic-capture-metadata.v1",
  measurementMs = 160,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "a2-synthetic-evidence-"));
  temporaryRoots.push(root);
  const catalog = {
    schemaVersion: 1,
    kind: "a2-evidence-verifier-conformance-catalog",
    catalogId: "synthetic-trace-self-test.v1",
    promotionEligible: false,
    tests: [
      {
        id: "synthetic.trace.v1",
        metricExtractor,
        minimumTrials: 1,
        minimumWarmupMs: 0,
        minimumMeasurementMs: 1,
        requiredFaults: [],
        requiredArtifacts: [
          {
            kind: "synthetic-capture-trace",
            maxBytes: 18 * 513,
            mediaType: "application/x-ndjson",
          },
          {
            kind: "verifier-metrics",
            maxBytes: 4096,
            mediaType: "application/json",
          },
        ],
        assertions: [
          {
            id: "block-count",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "exact",
            operator: "eq",
            expected: 16,
            unit: "blocks",
          },
          {
            id: "continuity-ok",
            sourceArtifactKind: "verifier-metrics",
            valueType: "boolean",
            reducer: "all",
            operator: "eq",
            expected: true,
            unit: "boolean",
          },
          {
            id: "cumulative-source-xruns",
            sourceArtifactKind: "verifier-metrics",
            valueType: "string",
            reducer: "exact",
            operator: "eq",
            expected: "0",
            unit: "decimal-u64",
          },
          {
            id: "discontinuity-mask-or",
            sourceArtifactKind: "verifier-metrics",
            valueType: "integer",
            reducer: "max",
            operator: "eq",
            expected: 0,
            unit: "bitmask",
          },
          {
            id: "timing-exact",
            sourceArtifactKind: "verifier-metrics",
            valueType: "boolean",
            reducer: "all",
            operator: "eq",
            expected: true,
            unit: "boolean",
          },
        ],
      },
    ],
  };
  const catalogBytes = jsonBytes(catalog);
  const manifest = {
    schemaVersion: 1,
    kind: "a2-evidence-run-manifest",
    manifestId: "00000000-0000-4000-8000-000000000011",
    catalogSha256: sha256(catalogBytes),
    testId: "synthetic.trace.v1",
    buildId: "a2-0.0.0+sha256.0000000000000000",
    tuple: {
      architecture: "test-arch",
      executionProfile: "synthetic-conformance",
      osFamily: "test-os",
      profileId: "synthetic-trace-test",
    },
    trials: [
      {
        id: "trial-1",
        warmupMs: 0,
        measurementMs,
        faults: [],
      },
    ],
  };
  const manifestBytes = jsonBytes(manifest);
  const sourceRecords = syntheticTraceRecords();
  mutateSourceTrace?.(sourceRecords);
  const originalTraceBytes = traceBytes(sourceRecords);
  const derived = await extractSyntheticCaptureMetrics({
    input: Readable.from([originalTraceBytes]),
    manifestBytes,
  });
  mutateMetrics?.(derived);
  const metricsBytes = canonicalBytes(derived);
  const records = syntheticTraceRecords();
  mutateTrace?.(records);
  const storedTraceBytes = traceBytes(records);
  await writeFile(path.join(root, "metrics.json"), metricsBytes);
  if (!omitTrace)
    await writeFile(path.join(root, "capture.jsonl"), storedTraceBytes);

  const artifacts = [
    ...(!omitTrace
      ? [
          {
            kind: "synthetic-capture-trace",
            path: "capture.jsonl",
            mediaType: "application/x-ndjson",
            bytes: storedTraceBytes.length,
            sha256: sha256(storedTraceBytes),
          },
        ]
      : []),
    {
      kind: "verifier-metrics",
      path: "metrics.json",
      mediaType: "application/json",
      bytes: metricsBytes.length,
      sha256: sha256(metricsBytes),
    },
  ];
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const result = {
    schemaVersion: 1,
    kind: "a2-evidence-run-result",
    resultId: "00000000-0000-4000-8000-000000000012",
    manifestSha256: sha256(manifestBytes),
    catalogSha256: sha256(catalogBytes),
    testId: manifest.testId,
    buildId: manifest.buildId,
    runnerId: "synthetic-trace-runner",
    startedUtc: "2026-09-20T00:00:00Z",
    endedUtc: "2026-09-20T00:00:02Z",
    trials: [
      {
        id: "trial-1",
        bootId: "boot-1",
        startedMs: 0,
        warmupEndedMs: 0,
        measurementEndedMs: measurementMs,
        faults: [],
      },
    ],
    artifacts,
    deviations: [],
    waiverIds: [],
  };
  mutateResult?.(result);
  const resultBytes = jsonBytes(makeSignedResult(result, privateKey));
  const keyringBytes = jsonBytes({
    schemaVersion: 1,
    kind: "a2-evidence-keyring",
    keys: [
      {
        keyId: "runner-test",
        purpose: "evidence-run-result",
        status: "active",
        notBeforeUtc: "2026-09-19T00:00:00Z",
        notAfterUtc: "2026-09-21T00:00:00Z",
        publicJwk: publicKey.export({ format: "jwk" }),
      },
    ],
  });
  return {
    artifactRoot: root,
    catalogBytes,
    manifestBytes,
    resultBytes,
    keyringBytes,
    sourceTraceSha256: sha256(storedTraceBytes),
  };
}

test("verifies bytes, signature, per-trial time/fault evidence and all closed predicates", async () => {
  const summary = await verifyConformanceRun(await bundle());
  assert.equal(summary.outcome, "conformance-pass");
  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.assertions.length, 7);
  assert.match(summary.trust, /not-independent-product-evidence/);
  assert(Object.isFrozen(summary));
  assert(Object.isFrozen(summary.tuple));
  assert(Object.isFrozen(summary.assertions));
  assert.deepEqual(
    summary.artifacts.map((artifact) => artifact.kind),
    ["runner-log", "verifier-metrics"],
  );
});

test("exercises the conformance CLI against an on-disk bundle", async () => {
  const input = await bundle();
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    cliArgs(input),
  );
  assert.equal(stderr, "");
  const summary = JSON.parse(stdout);
  assert.equal(summary.outcome, "conformance-pass");
  assert.equal(summary.promotionEligible, false);
});

test("CLI rejects oversized, symlink and special control inputs before reading", async () => {
  const oversized = await bundle();
  await writeFile(
    oversized.inputPaths.catalog,
    Buffer.alloc(2 * 1024 * 1024 + 1),
  );
  await assert.rejects(
    execFileAsync(process.execPath, cliArgs(oversized)),
    (error) => /exceeds 2097152 bytes/.test(error.stderr),
  );

  if (process.platform === "win32") return;
  const linked = await bundle();
  const linkPath = path.join(linked.artifactRoot, "catalog-link.json");
  await symlink(linked.inputPaths.catalog, linkPath);
  await assert.rejects(
    execFileAsync(process.execPath, cliArgs(linked, { catalog: linkPath })),
    (error) => /regular file, not a symlink/.test(error.stderr),
  );

  const special = await bundle();
  const fifoPath = path.join(special.artifactRoot, "catalog.fifo");
  await execFileAsync("mkfifo", [fifoPath]);
  await assert.rejects(
    execFileAsync(process.execPath, cliArgs(special, { catalog: fifoPath })),
    (error) => /regular file, not a symlink or special file/.test(error.stderr),
  );
});

test("rejects runner-authored outcomes and false measurements", async () => {
  await assert.rejects(
    verifyConformanceRun(
      await bundle({ mutateResult: (result) => (result.outcome = "pass") }),
    ),
    /result fields must be exactly/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateMetrics: (metrics) =>
          (metrics.trials[1].measurements[6].value = 11),
      }),
    ),
    /computed assertion lte did not pass/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateMetrics: (metrics) =>
          (metrics.trials[0].measurements[0].value = -999),
      }),
    ),
    /computed assertion abs did not pass/,
  );
});

test("rejects short trials and wall-clock intervals", async () => {
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateResult: (result) => (result.trials[1].measurementEndedMs = 2199),
      }),
    ),
    /shorter than its planned/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateResult: (result) => (result.endedUtc = "2026-09-20T00:00:02Z"),
      }),
    ),
    /wall-clock interval is shorter/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateResult: (result) => (result.trials[1].startedMs = 1099),
      }),
    ),
    /trials overlap/,
  );
});

test("rejects missing, duplicate and out-of-window fault evidence", async () => {
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateManifest: (manifest) =>
          manifest.trials[0].faults.push({
            ...manifest.trials[0].faults[0],
            id: "fault-extra",
          }),
      }),
    ),
    /fault kinds do not match/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({ mutateResult: (result) => result.trials[0].faults.pop() }),
    ),
    /faults IDs\/order/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateResult: (result) => (result.trials[0].faults[0].startedMs = 199),
      }),
    ),
    /does not match its planned/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateManifest: (manifest) =>
          (manifest.trials[0].faults[0].startOffsetMs = 1000),
      }),
    ),
    /outside the half-open measurement interval/,
  );
});

test("binds exact raw manifest and catalog bytes", async () => {
  const changedManifest = await bundle();
  changedManifest.manifestBytes = Buffer.concat([
    changedManifest.manifestBytes,
    Buffer.from(" "),
  ]);
  await assert.rejects(
    verifyConformanceRun(changedManifest),
    /result bindings do not match/,
  );

  const changedCatalog = await bundle();
  changedCatalog.catalogBytes = Buffer.concat([
    changedCatalog.catalogBytes,
    Buffer.from(" "),
  ]);
  await assert.rejects(
    verifyConformanceRun(changedCatalog),
    /manifest catalog digest mismatch/,
  );
});

test("catalog cannot raise immutable artifact byte ceilings", async () => {
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateCatalog: (catalog) =>
          (catalog.tests[0].requiredArtifacts[0].maxBytes =
            64 * 1024 * 1024 + 1),
      }),
    ),
    /maxBytes exceeds the immutable hard ceiling/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await bundle({
        mutateCatalog: (catalog) => {
          catalog.tests[0].requiredArtifacts = [
            "a",
            "b",
            "c",
            "d",
            "verifier-metrics",
          ].map((kind) => ({
            kind,
            maxBytes: 64 * 1024 * 1024,
            mediaType: "application/octet-stream",
          }));
        },
      }),
    ),
    /total exceeds the immutable hard ceiling/,
  );
});

test("rejects a signed-result byte change", async () => {
  const input = await bundle();
  input.resultBytes = Buffer.from(
    input.resultBytes
      .toString("utf8")
      .replace("synthetic-runner", "synthetic-tamper"),
  );
  await assert.rejects(verifyConformanceRun(input), /signature is invalid/);
});

test("rejects wrong-purpose, revoked and expired signing keys", async () => {
  for (const mutate of [
    (key) => (key.purpose = "software-release"),
    (key) => (key.status = "revoked"),
    (key) => (key.notAfterUtc = "2026-09-19T23:59:59Z"),
  ]) {
    const input = await bundle();
    const keyring = JSON.parse(input.keyringBytes);
    mutate(keyring.keys[0]);
    input.keyringBytes = jsonBytes(keyring);
    await assert.rejects(
      verifyConformanceRun(input),
      /purpose or status is invalid|revoked or outside/,
    );
  }
});

test("derives synthetic trace metrics before evaluating the signed bundle", async () => {
  const input = await syntheticBundle();
  const summary = await verifyConformanceRun(input);
  assert.equal(summary.outcome, "conformance-pass");
  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.metricExtractor, "a2.synthetic-capture-metadata.v1");
  assert.equal(summary.assertions.length, 5);
  assert(
    summary.assertions.every(
      (assertion) => assertion.sourceTraceSha256 === input.sourceTraceSha256,
    ),
  );
});

test("rejects forged synthetic metrics and invalid or stale trace bindings", async () => {
  await assert.rejects(
    verifyConformanceRun(
      await syntheticBundle({
        mutateTrace: (records) => (records[5].discontinuityFlags = 1),
      }),
    ),
    /metrics bytes do not equal canonical extracted metrics/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await syntheticBundle({
        mutateTrace: (records) => (records[5].sequence = "99"),
      }),
    ),
    /sequence is not continuous/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await syntheticBundle({
        mutateTrace: (records) => (records[2].timingUncertaintyNs = 1),
      }),
    ),
    /timing uncertainty is not exact/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await syntheticBundle({
        mutateMetrics: (metrics) =>
          (metrics.sourceTraceSha256 = "0".repeat(64)),
      }),
    ),
    /metrics bytes do not equal canonical extracted metrics/,
  );
});

test("rejects invalid timing or duration even when metrics would be regenerated", async () => {
  await assert.rejects(
    syntheticBundle({
      mutateSourceTrace: (records) => (records[1].monotonicCaptureNs = null),
    }),
    /canonical decimal u64 string/,
  );
  await assert.rejects(
    syntheticBundle({ measurementMs: 1000 }),
    /fixed 160 ms trace duration/,
  );
});

test("rejects missing synthetic traces and unknown metric extractors", async () => {
  await assert.rejects(
    verifyConformanceRun(await syntheticBundle({ omitTrace: true })),
    /artifact kinds\/order do not exactly match the catalog/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await syntheticBundle({ metricExtractor: "supplied-conformance-v1" }),
    ),
    /metrics fields must be exactly/,
  );
  await assert.rejects(
    verifyConformanceRun(
      await syntheticBundle({ metricExtractor: "unknown.extractor.v1" }),
    ),
    /metricExtractor is unsupported/,
  );
});
