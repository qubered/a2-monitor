import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const contracts = [
  {
    schemaPath: "schema/v0/http/health-response.schema.json",
    typeName: "HealthResponse",
    parserName: "parseHealthResponse",
  },
  {
    schemaPath: "schema/v0/http/live-snapshot-response.schema.json",
    typeName: "LiveSnapshot",
    parserName: "parseLiveSnapshot",
    definitionNames: { channel: "LiveChannel" },
  },
  {
    schemaPath: "schema/v0/http/showfile.schema.json",
    typeName: "Showfile",
    parserName: "parseShowfile",
  },
];

const outputPath = path.join(packageRoot, "generated/http-contracts.ts");
const generatorPath = fileURLToPath(import.meta.url);
const supportedSchemaKeywords = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "format",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "maxItems",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSupportedSchema(schema, location = "#") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Expected a schema object at ${location}.`);
  }
  for (const keyword of Object.keys(schema)) {
    if (!supportedSchemaKeywords.has(keyword)) {
      throw new Error(`Unsupported schema keyword ${keyword} at ${location}.`);
    }
  }
  if (schema.format !== undefined && schema.format !== "date-time") {
    throw new Error(
      `Unsupported schema format ${schema.format} at ${location}.`,
    );
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    assertSupportedSchema(child, `${location}/properties/${name}`);
  }
  for (const [name, child] of Object.entries(schema.$defs ?? {})) {
    assertSupportedSchema(child, `${location}/$defs/${name}`);
  }
  if (schema.items) assertSupportedSchema(schema.items, `${location}/items`);
}

function pascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
}

function typeFor(schema, definitions) {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    return definitions[name]?.typeName ?? pascalCase(name);
  }
  if (Object.hasOwn(schema, "const")) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((type) => typeFor({ ...schema, type }, definitions))
      .join(" | ");
  }
  if (schema.type === "string") return "string";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "null") return "null";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array")
    return `Array<${typeFor(schema.items, definitions)}>`;
  if (schema.type === "object") {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {})
      .map(
        ([name, property]) =>
          `${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${typeFor(property, definitions)};`,
      )
      .join("\n");
    return `{\n${properties}\n}`;
  }
  throw new Error(`Unsupported schema shape: ${JSON.stringify(schema)}`);
}

function emitTypes(schema, rootName, definitionNames = {}) {
  const definitions = Object.fromEntries(
    Object.entries(schema.$defs ?? {}).map(([name, definition]) => [
      name,
      { ...definition, typeName: definitionNames[name] ?? pascalCase(name) },
    ]),
  );
  const definitionTypes = Object.values(definitions)
    .map(
      (definition) =>
        `export type ${definition.typeName} = ${typeFor(definition, definitions)};`,
    )
    .join("\n\n");
  return `${definitionTypes}\n\nexport type ${rootName} = ${typeFor(schema, definitions)};`;
}

async function render() {
  const loaded = await Promise.all(
    contracts.map(async (contract) => {
      const schemaText = await readFile(
        path.join(packageRoot, contract.schemaPath),
        "utf8",
      );
      const schema = JSON.parse(schemaText);
      assertSupportedSchema(schema);
      return { ...contract, schemaText, schema };
    }),
  );

  const sources = loaded
    .map(({ schemaPath }) => `//   - ${schemaPath}`)
    .join("\n");
  const types = loaded
    .map(({ schema, typeName, definitionNames }) =>
      emitTypes(schema, typeName, definitionNames),
    )
    .join("\n\n");
  const schemas = loaded
    .map(
      ({ schema, typeName }) =>
        `const ${typeName[0].toLowerCase()}${typeName.slice(1)}Schema = ${JSON.stringify(schema, null, 2)} as const;`,
    )
    .join("\n\n");
  const parsers = loaded
    .map(({ typeName, parserName }) => {
      const schemaName = `${typeName[0].toLowerCase()}${typeName.slice(1)}Schema`;
      return `export function ${parserName}(value: unknown): ${typeName} {
        return parseWithSchema<${typeName}>(value, ${schemaName}, ${JSON.stringify(typeName)});
      }`;
    })
    .join("\n\n");

  const source = `${types}

export class ProtocolContractError extends Error {
  constructor(contract: string, path: string) {
    super(\`\${contract} did not match its closed schema at \${path}.\`);
    this.name = "ProtocolContractError";
  }
}

export class ProtocolHttpError extends Error {
  readonly status: number;

  constructor(status: number, path: string) {
    super(\`Request to \${path} failed with HTTP \${status}.\`);
    this.name = "ProtocolHttpError";
    this.status = status;
  }
}

${schemas}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateTime(value: string): boolean {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})[Tt]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:[Zz]|[+-]\\d{2}:\\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function resolveReference(root: Record<string, unknown>, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .reduce<unknown>((current, segment) =>
      isRecord(current) ? current[segment.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined,
    root);
}

function matchesSchema(
  value: unknown,
  schemaValue: unknown,
  root: Record<string, unknown>,
  path: string,
): string | null {
  if (!isRecord(schemaValue)) return path;
  if (typeof schemaValue.$ref === "string") {
    return matchesSchema(value, resolveReference(root, schemaValue.$ref), root, path);
  }
  if (Object.hasOwn(schemaValue, "const") && value !== schemaValue.const) return path;
  if (Array.isArray(schemaValue.enum) && !schemaValue.enum.includes(value)) return path;

  const declaredTypes = Array.isArray(schemaValue.type)
    ? schemaValue.type
    : schemaValue.type === undefined
      ? []
      : [schemaValue.type];
  if (declaredTypes.length > 1) {
    const matchesAny = declaredTypes.some(
      (type) => matchesSchema(value, { ...schemaValue, type }, root, path) === null,
    );
    return matchesAny ? null : path;
  }

  switch (declaredTypes[0]) {
    case "null":
      return value === null ? null : path;
    case "boolean":
      return typeof value === "boolean" ? null : path;
    case "string": {
      if (typeof value !== "string") return path;
      const length = codePointLength(value);
      if (typeof schemaValue.minLength === "number" && length < schemaValue.minLength) return path;
      if (typeof schemaValue.maxLength === "number" && length > schemaValue.maxLength) return path;
      if (schemaValue.format === "date-time" && !isDateTime(value)) return path;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return path;
      if (declaredTypes[0] === "integer" && !Number.isInteger(value)) return path;
      if (typeof schemaValue.minimum === "number" && value < schemaValue.minimum) return path;
      if (typeof schemaValue.maximum === "number" && value > schemaValue.maximum) return path;
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return path;
      if (typeof schemaValue.maxItems === "number" && value.length > schemaValue.maxItems) return path;
      for (let index = 0; index < value.length; index += 1) {
        const error = matchesSchema(value[index], schemaValue.items, root, \`\${path}/\${index}\`);
        if (error) return error;
      }
      return null;
    }
    case "object": {
      if (!isRecord(value)) return path;
      const properties = isRecord(schemaValue.properties) ? schemaValue.properties : {};
      const required = Array.isArray(schemaValue.required) ? schemaValue.required : [];
      for (const name of required) {
        if (typeof name !== "string" || !Object.hasOwn(value, name)) return \`\${path}/\${String(name)}\`;
      }
      if (schemaValue.additionalProperties === false) {
        const unknown = Object.keys(value).find((name) => !Object.hasOwn(properties, name));
        if (unknown) return \`\${path}/\${unknown}\`;
      }
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (!Object.hasOwn(value, name)) continue;
        const error = matchesSchema(value[name], propertySchema, root, \`\${path}/\${name}\`);
        if (error) return error;
      }
      return null;
    }
    default:
      return null;
  }
}

function parseWithSchema<T>(value: unknown, schema: object, contract: string): T {
  const errorPath = matchesSchema(value, schema, schema as Record<string, unknown>, "");
  if (errorPath !== null) throw new ProtocolContractError(contract, errorPath || "/");
  return value as T;
}

${parsers}

export type ProtocolFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export interface HttpContractClient {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  getLiveSnapshot(signal?: AbortSignal): Promise<LiveSnapshot>;
}

export const HTTP_RESPONSE_LIMITS = {
  healthBytes: 4096,
  liveSnapshotBytes: 1048576,
} as const;

async function readBoundedJson(
  response: Response,
  contract: string,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new ProtocolContractError(contract, "/response-bytes");
  }
  if (!response.body) throw new ProtocolContractError(contract, "/body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let chunks = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks += 1;
      if (bytes > maxBytes || chunks > 4096) {
        await reader.cancel();
        throw new ProtocolContractError(contract, "/response-bytes");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ProtocolContractError) throw error;
    throw new ProtocolContractError(contract, "/json");
  }
}

export function createHttpContractClient(fetchResponse: ProtocolFetch = fetch): HttpContractClient {
  async function request<T>(
    path: string,
    contract: string,
    maxBytes: number,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetchResponse(path, { signal });
    if (!response.ok) throw new ProtocolHttpError(response.status, path);
    return parse(await readBoundedJson(response, contract, maxBytes));
  }

  return {
    getHealth: (signal) =>
      request(
        "/healthz",
        "HealthResponse",
        HTTP_RESPONSE_LIMITS.healthBytes,
        parseHealthResponse,
        signal,
      ),
    getLiveSnapshot: (signal) =>
      request(
        "/api/v1/live/snapshot",
        "LiveSnapshot",
        HTTP_RESPONSE_LIMITS.liveSnapshotBytes,
        parseLiveSnapshot,
        signal,
      ),
  };
}
`;
  const { default: prettier } = await import("prettier");
  const body = await prettier.format(source, { parser: "typescript" });
  const schemaDigest = sha256(
    loaded
      .map(({ schemaPath, schemaText }) => `${schemaPath}\0${schemaText}`)
      .join("\0"),
  );
  const generatorDigest = sha256(await readFile(generatorPath));
  return `// Generated file. Do not edit by hand.
// Sources:
${sources}
// Regenerate: npm run generate --workspace @a2-monitor/protocol
// Schema-SHA256: ${schemaDigest}
// Generator-SHA256: ${generatorDigest}
// Body-SHA256: ${sha256(body)}

${body}`;
}

async function checkWithoutDependencies(actual) {
  const metadata =
    /^\/\/ Schema-SHA256: ([0-9a-f]{64})\n\/\/ Generator-SHA256: ([0-9a-f]{64})\n\/\/ Body-SHA256: ([0-9a-f]{64})\n\n/m.exec(
      actual,
    );
  if (!metadata) return false;
  const [header, recordedSchema, recordedGenerator, recordedBody] = metadata;
  const loaded = await Promise.all(
    contracts.map(async ({ schemaPath }) => ({
      schemaPath,
      schemaText: await readFile(path.join(packageRoot, schemaPath), "utf8"),
    })),
  );
  const schemaDigest = sha256(
    loaded
      .map(({ schemaPath, schemaText }) => `${schemaPath}\0${schemaText}`)
      .join("\0"),
  );
  const generatorDigest = sha256(await readFile(generatorPath));
  const body = actual.slice((metadata.index ?? 0) + header.length);
  return (
    recordedSchema === schemaDigest &&
    recordedGenerator === generatorDigest &&
    recordedBody === sha256(body)
  );
}

export async function generate({ check = false } = {}) {
  if (check) {
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch {
      actual = undefined;
    }
    let current = false;
    try {
      current = actual === (await render());
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
      current =
        actual !== undefined && (await checkWithoutDependencies(actual));
    }
    if (!current) {
      throw new Error(
        "Generated HTTP contracts are stale. Run: npm run generate --workspace @a2-monitor/protocol",
      );
    }
    return;
  }
  const expected = await render();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generate({ check: process.argv.includes("--check") }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
