import Fastify, { type FastifyInstance } from "fastify";
import healthResponseSchema from "@a2-monitor/protocol/schema/health-response" with { type: "json" };
import liveSnapshotResponseSchema from "@a2-monitor/protocol/schema/live-snapshot-response" with { type: "json" };
import type { HealthResponse, LiveSnapshot } from "@a2-monitor/protocol/http";
import {
  createStrictAjv2020,
  stringifyValidatedJson,
} from "@a2-monitor/protocol/validation/strict-ajv";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";

export type SnapshotProvider = () => LiveSnapshot | Promise<LiveSnapshot>;

type BuildServerOptions = {
  snapshotProvider?: SnapshotProvider;
  logger?: boolean;
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const ajv = createStrictAjv2020();

  ajv.addSchema(healthResponseSchema);
  ajv.addSchema(liveSnapshotResponseSchema);

  server.setValidatorCompiler(({ schema }) => ajv.compile(schema as object));
  server.setSerializerCompiler(({ schema }) => {
    const validate = ajv.compile(schema as object);
    return (data) => stringifyValidatedJson(validate, data);
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
