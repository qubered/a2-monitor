import Fastify, { type FastifyInstance } from "fastify";
import { isIP } from "node:net";
import healthResponseSchema from "@rvlt/pulse-protocol/schema/health-response" with { type: "json" };
import liveSnapshotResponseSchema from "@rvlt/pulse-protocol/schema/live-snapshot-response" with { type: "json" };
import showfileSchema from "@rvlt/pulse-protocol/schema/showfile" with { type: "json" };
import type {
  HealthResponse,
  LiveSnapshot,
  Showfile,
} from "@rvlt/pulse-protocol/http";
import {
  createStrictAjv2020,
  stringifyValidatedJson,
} from "@rvlt/pulse-protocol/validation/strict-ajv";
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
      const patchedInputs = candidate.channels
        .map(({ inputIndex }) => inputIndex)
        .filter((inputIndex): inputIndex is number => inputIndex !== null);
      const receiverIds = candidate.shureReceivers.map(({ id }) => id);
      const shurePatches = candidate.channels
        .filter(
          ({ shureReceiverId, shureChannelIndex }) =>
            shureReceiverId != null || shureChannelIndex != null,
        )
        .map(
          ({ shureReceiverId, shureChannelIndex }) =>
            `${shureReceiverId}:${shureChannelIndex}`,
        );
      const invalid =
        candidate.show.name.trim().length === 0 ||
        candidate.channels.some(({ name }) => name.trim().length === 0) ||
        new Set(patchedInputs).size !== patchedInputs.length ||
        new Set(receiverIds).size !== receiverIds.length ||
        new Set(shurePatches).size !== shurePatches.length ||
        candidate.shureReceivers.some(
          ({ id, name, host }) =>
            id.trim().length === 0 ||
            name.trim().length === 0 ||
            isIP(host.trim()) === 0,
        ) ||
        candidate.channels.some(({ shureReceiverId, shureChannelIndex }) => {
          if (shureReceiverId == null && shureChannelIndex == null)
            return false;
          if (shureReceiverId == null || shureChannelIndex == null) return true;
          const receiver = candidate.shureReceivers.find(
            ({ id }) => id === shureReceiverId,
          );
          return !receiver || shureChannelIndex >= receiver.channelCount;
        }) ||
        (candidate.device === null && patchedInputs.length > 0) ||
        (candidate.device !== null &&
          candidate.channels.some(
            ({ inputIndex }) =>
              inputIndex !== null &&
              inputIndex >= candidate.device!.channelCount,
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
