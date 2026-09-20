import { Ajv2020, type AnySchema, type ErrorObject } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import Fastify, { type FastifyInstance } from "fastify";
import healthResponseSchema from "@a2-monitor/protocol/schema/health-response" with { type: "json" };
import liveSnapshotResponseSchema from "@a2-monitor/protocol/schema/live-snapshot-response" with { type: "json" };
import type { HealthResponse, LiveSnapshot } from "@a2-monitor/protocol/http";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";

export type SnapshotProvider = () => LiveSnapshot | Promise<LiveSnapshot>;

type BuildServerOptions = {
  snapshotProvider?: SnapshotProvider;
  logger?: boolean;
};

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  return (
    errors
      ?.map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      )
      .join("; ") ?? "response is invalid"
  );
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
    validateSchema: true,
  });
  formatsPlugin.default(ajv);

  ajv.addSchema(healthResponseSchema);
  ajv.addSchema(liveSnapshotResponseSchema);

  server.setValidatorCompiler(({ schema }) => ajv.compile(schema as AnySchema));
  server.setSerializerCompiler(({ schema }) => {
    const validate = ajv.compile(schema as AnySchema);
    return (data) => {
      if (!validate(data)) {
        throw new Error(
          `Response contract violation: ${validationMessage(validate.errors)}`,
        );
      }
      return JSON.stringify(data);
    };
  });

  server.get(
    "/healthz",
    { schema: { response: { 200: healthResponseSchema } } },
    async (): Promise<HealthResponse> => ({
      status: "ok",
      service: "a2-backend",
      version: "0.0.0",
    }),
  );

  const snapshotProvider =
    options.snapshotProvider ?? (() => fabricatedLiveSnapshot);

  server.get(
    "/api/v1/live/snapshot",
    { schema: { response: { 200: liveSnapshotResponseSchema } } },
    async (): Promise<LiveSnapshot> => snapshotProvider(),
  );

  return server;
}
