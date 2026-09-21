import Fastify, { type FastifyInstance } from "fastify";
import healthResponseSchema from "@a2-monitor/protocol/schema/health-response" with { type: "json" };
import liveSnapshotResponseSchema from "@a2-monitor/protocol/schema/live-snapshot-response" with { type: "json" };
import showfileSchema from "@a2-monitor/protocol/schema/showfile" with { type: "json" };
import type {
  HealthResponse,
  LiveSnapshot,
  Showfile,
} from "@a2-monitor/protocol/http";
import {
  createStrictAjv2020,
  stringifyValidatedJson,
} from "@a2-monitor/protocol/validation/strict-ajv";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";
import {
  MemoryShowfileStore,
  ShowfileConflictError,
  type ShowfileStore,
} from "./showfile.js";

export type SnapshotProvider = () => LiveSnapshot | Promise<LiveSnapshot>;

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

type BuildServerOptions = {
  snapshotProvider?: SnapshotProvider;
  showfileStore?: ShowfileStore;
  logger?: boolean;
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const ajv = createStrictAjv2020();

  ajv.addSchema(healthResponseSchema);
  ajv.addSchema(liveSnapshotResponseSchema);
  ajv.addSchema(showfileSchema);

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
  const showfileStore = options.showfileStore ?? new MemoryShowfileStore();

  server.get(
    "/api/v1/live/snapshot",
    { schema: { response: { 200: liveSnapshotResponseSchema } } },
    async (): Promise<LiveSnapshot> => snapshotProvider(),
  );

  server.get(
    "/api/v1/showfile",
    { schema: { response: { 200: showfileSchema } } },
    async (): Promise<Showfile> => showfileStore.load(),
  );

  server.put(
    "/api/v1/showfile",
    {
      schema: {
        body: showfileSchema,
        response: {
          200: showfileSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply): Promise<Showfile | undefined> => {
      const candidate = request.body as Showfile;
      const indexes = new Set(
        candidate.channels.map(({ inputIndex }) => inputIndex),
      );
      const invalid =
        candidate.show.name.trim().length === 0 ||
        candidate.channels.some(({ name }) => name.trim().length === 0) ||
        indexes.size !== candidate.channels.length ||
        (candidate.device === null && candidate.channels.length > 0) ||
        (candidate.device !== null &&
          candidate.channels.some(
            ({ inputIndex }) => inputIndex >= candidate.device!.channelCount,
          ));
      if (invalid) {
        await reply.code(400).send({ error: "invalid-showfile" });
        return undefined;
      }
      try {
        return await showfileStore.save(candidate);
      } catch (error) {
        if (error instanceof ShowfileConflictError) {
          await reply.code(409).send({ error: "showfile-conflict" });
          return undefined;
        }
        throw error;
      }
    },
  );

  return server;
}
