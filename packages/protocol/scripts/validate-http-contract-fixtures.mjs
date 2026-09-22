import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStrictAjv2020,
  formatAjvErrors,
} from "../validation/strict-ajv.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const contracts = [
  {
    name: "health response",
    schema: "schema/v0/http/health-response.schema.json",
    accepted: [
      "fixtures/v0/http/current/health-response.valid.json",
      "fixtures/v0/http/previous/health-response.valid.json",
    ],
    rejected: [
      "fixtures/v0/http/incompatible/health-response.unknown-field.json",
    ],
  },
  {
    name: "Live snapshot response",
    schema: "schema/v0/http/live-snapshot-response.schema.json",
    accepted: [
      "fixtures/v0/http/current/live-snapshot-response.valid.json",
      "fixtures/v0/http/previous/live-snapshot-response.valid.json",
    ],
    rejected: [
      "fixtures/v0/http/incompatible/live-snapshot-response.major-version.json",
      "fixtures/v0/http/incompatible/live-snapshot-response.unknown-field.json",
    ],
  },
  {
    name: "showfile",
    schema: "schema/v0/http/showfile.schema.json",
    accepted: [
      "fixtures/v0/http/current/showfile.valid.json",
      "fixtures/v0/http/previous/showfile.valid.json",
    ],
    rejected: ["fixtures/v0/http/incompatible/showfile.unknown-field.json"],
  },
  {
    name: "shure-telemetry",
    schema: "schema/v0/http/shure-telemetry.schema.json",
    accepted: [
      "fixtures/v0/http/current/shure-telemetry.valid.json",
      "fixtures/v0/http/previous/shure-telemetry.valid.json",
    ],
    rejected: [
      "fixtures/v0/http/incompatible/shure-telemetry.unknown-field.json",
    ],
  },
  {
    name: "production-list",
    schema: "schema/v0/http/production-list.schema.json",
    accepted: [
      "fixtures/v0/http/current/production-list.valid.json",
      "fixtures/v0/http/previous/production-list.valid.json",
    ],
    rejected: [
      "fixtures/v0/http/incompatible/production-list.unknown-field.json",
    ],
  },
];

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(packageRoot, relativePath), "utf8"),
  );
}

async function schemaPaths(directory, prefix = "") {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      paths.push(
        ...(await schemaPaths(path.join(directory, entry.name), relativePath)),
      );
    } else if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      paths.push(path.posix.join("schema", relativePath));
    }
  }
  return paths.sort();
}

const discoveredSchemas = await schemaPaths(path.join(packageRoot, "schema"));
const registeredSchemas = contracts.map((contract) => contract.schema).sort();
if (JSON.stringify(discoveredSchemas) !== JSON.stringify(registeredSchemas)) {
  throw new Error(
    `HTTP fixture registry does not cover the complete schema tree. Discovered ${JSON.stringify(discoveredSchemas)}; registered ${JSON.stringify(registeredSchemas)}.`,
  );
}

const ajv = createStrictAjv2020();
const validators = new Map();

for (const contract of contracts) {
  const validate = ajv.compile(await readJson(contract.schema));
  validators.set(contract.schema, validate);
  for (const fixturePath of contract.accepted) {
    const value = await readJson(fixturePath);
    if (!validate(value)) {
      throw new Error(
        `${contract.name} fixture ${fixturePath} was rejected: ${formatAjvErrors(validate.errors)}`,
      );
    }
  }
  for (const fixturePath of contract.rejected) {
    const value = await readJson(fixturePath);
    if (validate(value)) {
      throw new Error(
        `${contract.name} fixture ${fixturePath} was unexpectedly accepted.`,
      );
    }
  }
}

const snapshotSchemaPath = "schema/v0/http/live-snapshot-response.schema.json";
const validateSnapshot = validators.get(snapshotSchemaPath);
if (!validateSnapshot) {
  throw new Error(`Missing validator for ${snapshotSchemaPath}.`);
}
const parity = await readJson("fixtures/v0/http/parity-values.json");
const snapshot = await readJson(
  "fixtures/v0/http/current/live-snapshot-response.valid.json",
);
const firstChannel = snapshot.channels[0];

function assertSnapshotParity(value, expected, label) {
  const before = structuredClone(value);
  const accepted = validateSnapshot(value);
  if (accepted !== expected) {
    throw new Error(
      `${label} was ${accepted ? "accepted" : `rejected: ${formatAjvErrors(validateSnapshot.errors)}`}.`,
    );
  }
  if (JSON.stringify(value) !== JSON.stringify(before)) {
    throw new Error(`${label} was mutated during validation.`);
  }
}

assertSnapshotParity(
  { ...snapshot, generatedAtUtc: parity.invalidCalendarDateTime },
  false,
  "invalid calendar date-time parity vector",
);
assertSnapshotParity(
  {
    ...snapshot,
    channels: [
      {
        ...firstChannel,
        alert: {
          ...firstChannel.alert,
          label: parity.validUnicodeAtAlertLabelBoundary,
        },
      },
    ],
  },
  true,
  "Unicode string-length boundary parity vector",
);
for (const linkQualityPercent of parity.validLinkQualityPercent) {
  assertSnapshotParity(
    {
      ...snapshot,
      channels: [
        {
          ...firstChannel,
          details: { ...firstChannel.details, linkQualityPercent },
        },
      ],
    },
    true,
    `valid link-quality parity vector ${linkQualityPercent}`,
  );
}
for (const linkQualityPercent of parity.invalidLinkQualityPercent) {
  assertSnapshotParity(
    {
      ...snapshot,
      channels: [
        {
          ...firstChannel,
          details: { ...firstChannel.details, linkQualityPercent },
        },
      ],
    },
    false,
    `invalid link-quality parity vector ${linkQualityPercent}`,
  );
}

console.log(
  `Validated ${contracts.length} HTTP schemas, their accepted/rejected fixtures, and committed parity vectors with the shared strict Ajv 2020 configuration.`,
);
