import Fastify, { type FastifyInstance } from "fastify";
import { isIP } from "node:net";
import healthResponseSchema from "@rvlt/pulse-protocol/schema/health-response" with { type: "json" };
import liveSnapshotResponseSchema from "@rvlt/pulse-protocol/schema/live-snapshot-response" with { type: "json" };
import showfileSchema from "@rvlt/pulse-protocol/schema/showfile" with { type: "json" };
import productionListSchema from "@rvlt/pulse-protocol/schema/production-list" with { type: "json" };
import channelLevelHistorySchema from "@rvlt/pulse-protocol/schema/channel-level-history" with { type: "json" };
import type {
  ChannelLevelHistory,
  HealthResponse,
  LiveSnapshot,
  ProductionList,
  Showfile,
} from "@rvlt/pulse-protocol/http";
import {
  createStrictAjv2020,
  stringifyValidatedJson,
} from "@rvlt/pulse-protocol/validation/strict-ajv";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";
import { LevelHistoryStore } from "./level-history.js";
import {
  ActiveProductionError,
  MemoryProductionStore,
  ProductionNotFoundError,
  ShowfileConflictError,
  type ProductionStore,
} from "./productions.js";

export type SnapshotProvider = () => LiveSnapshot | Promise<LiveSnapshot>;

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

const createProductionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string", minLength: 1, maxLength: 120 } },
} as const;

const productionIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

const channelHistoryQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["channelId"],
  properties: {
    channelId: { type: "string", minLength: 1, maxLength: 64 },
    // Fastify querystrings arrive as raw strings under strict Ajv (no
    // coercion), so the bound is validated as a numeric-looking string and
    // parsed by hand in the handler rather than declared as an integer.
    windowMs: { type: "string", pattern: "^[0-9]{4,7}$" },
  },
} as const;

const DEFAULT_HISTORY_WINDOW_MS = 30 * 60 * 1000;
const MIN_HISTORY_WINDOW_MS = 1000;
const MAX_HISTORY_WINDOW_MS = 60 * 60 * 1000;
const HISTORY_INTERVAL_MS = 1000;

const IMAGE_URL_SCHEMES = ["http://", "https://"];
const DATA_IMAGE_URL =
  /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

function isValidImageUrl(imageUrl: string): boolean {
  return (
    IMAGE_URL_SCHEMES.some((scheme) => imageUrl.startsWith(scheme)) ||
    DATA_IMAGE_URL.test(imageUrl)
  );
}

type BuildServerOptions = {
  snapshotProvider?: SnapshotProvider;
  productionStore?: ProductionStore;
  historyStore?: LevelHistoryStore;
  logger?: boolean;
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const ajv = createStrictAjv2020();

  ajv.addSchema(healthResponseSchema);
  ajv.addSchema(liveSnapshotResponseSchema);
  ajv.addSchema(showfileSchema);
  ajv.addSchema(productionListSchema);
  ajv.addSchema(channelLevelHistorySchema);

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
      service: "pulse-backend",
      version: "0.0.0",
    }),
  );

  const snapshotProvider =
    options.snapshotProvider ?? (() => fabricatedLiveSnapshot);
  const productionStore =
    options.productionStore ?? new MemoryProductionStore();

  server.get(
    "/api/v1/live/snapshot",
    { schema: { response: { 200: liveSnapshotResponseSchema } } },
    async (): Promise<LiveSnapshot> => snapshotProvider(),
  );

  const historyStore =
    options.historyStore ??
    new LevelHistoryStore(snapshotProvider, {
      intervalMs: HISTORY_INTERVAL_MS,
    });
  historyStore.start();
  server.addHook("onClose", async () => historyStore.stop());

  server.get(
    "/api/v1/live/history",
    {
      schema: {
        querystring: channelHistoryQuerySchema,
        response: { 200: channelLevelHistorySchema, 404: errorResponseSchema },
      },
    },
    async (request, reply): Promise<ChannelLevelHistory | undefined> => {
      const { channelId, windowMs: rawWindowMs } = request.query as {
        channelId: string;
        windowMs?: string;
      };
      const snapshot = await snapshotProvider();
      if (!snapshot.channels.some(({ id }) => id === channelId)) {
        await reply.code(404).send({ error: "channel-not-found" });
        return undefined;
      }
      const windowMs = rawWindowMs
        ? Math.min(
            MAX_HISTORY_WINDOW_MS,
            Math.max(MIN_HISTORY_WINDOW_MS, Number(rawWindowMs)),
          )
        : DEFAULT_HISTORY_WINDOW_MS;
      return {
        schemaVersion: "0",
        channelId,
        generatedAtUtc: new Date().toISOString(),
        windowMs,
        intervalMs: HISTORY_INTERVAL_MS,
        samples: historyStore.getWindow(channelId, windowMs),
      };
    },
  );

  server.get(
    "/api/v1/showfile",
    { schema: { response: { 200: showfileSchema } } },
    async (): Promise<Showfile> => productionStore.loadActive(),
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
          )) ||
        candidate.channels.some(
          ({ imageUrl }) => imageUrl != null && !isValidImageUrl(imageUrl),
        );
      if (invalid) {
        await reply.code(400).send({ error: "invalid-showfile" });
        return undefined;
      }
      try {
        return await productionStore.saveActive(candidate);
      } catch (error) {
        if (error instanceof ShowfileConflictError) {
          await reply.code(409).send({ error: "showfile-conflict" });
          return undefined;
        }
        throw error;
      }
    },
  );

  server.get(
    "/api/v1/productions",
    { schema: { response: { 200: productionListSchema } } },
    async (): Promise<ProductionList> => productionStore.list(),
  );

  server.get(
    "/api/v1/productions/:id",
    {
      schema: {
        params: productionIdParamsSchema,
        response: { 200: showfileSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply): Promise<Showfile | undefined> => {
      const { id } = request.params as { id: string };
      const showfile = await productionStore.loadById(id);
      if (!showfile) {
        await reply.code(404).send({ error: "production-not-found" });
        return undefined;
      }
      return showfile;
    },
  );

  server.post(
    "/api/v1/productions",
    {
      schema: {
        body: createProductionSchema,
        response: { 201: productionListSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply): Promise<ProductionList | undefined> => {
      const { name } = request.body as { name: string };
      if (name.trim().length === 0) {
        await reply.code(400).send({ error: "invalid-production-name" });
        return undefined;
      }
      await productionStore.create(name);
      reply.code(201);
      return productionStore.list();
    },
  );

  server.post(
    "/api/v1/productions/:id/activate",
    {
      schema: {
        params: productionIdParamsSchema,
        response: { 200: productionListSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply): Promise<ProductionList | undefined> => {
      const { id } = request.params as { id: string };
      try {
        await productionStore.activate(id);
        return await productionStore.list();
      } catch (error) {
        if (error instanceof ProductionNotFoundError) {
          await reply.code(404).send({ error: "production-not-found" });
          return undefined;
        }
        throw error;
      }
    },
  );

  server.delete(
    "/api/v1/productions/:id",
    {
      schema: {
        params: productionIdParamsSchema,
        response: {
          200: productionListSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply): Promise<ProductionList | undefined> => {
      const { id } = request.params as { id: string };
      try {
        await productionStore.remove(id);
        return await productionStore.list();
      } catch (error) {
        if (error instanceof ActiveProductionError) {
          await reply.code(400).send({ error: "active-production" });
          return undefined;
        }
        if (error instanceof ProductionNotFoundError) {
          await reply.code(404).send({ error: "production-not-found" });
          return undefined;
        }
        throw error;
      }
    },
  );

  return server;
}
