import Fastify, { type FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { isIP } from "node:net";
import healthResponseSchema from "@rvlt/pulse-protocol/schema/health-response" with { type: "json" };
import liveSnapshotResponseSchema from "@rvlt/pulse-protocol/schema/live-snapshot-response" with { type: "json" };
import showfileSchema from "@rvlt/pulse-protocol/schema/showfile" with { type: "json" };
import productionListSchema from "@rvlt/pulse-protocol/schema/production-list" with { type: "json" };
import channelLevelHistorySchema from "@rvlt/pulse-protocol/schema/channel-level-history" with { type: "json" };
import liveStateSchema from "@rvlt/pulse-protocol/schema/live-state" with { type: "json" };
import alertLogSchema from "@rvlt/pulse-protocol/schema/alert-log" with { type: "json" };
import micChecksSchema from "@rvlt/pulse-protocol/schema/mic-checks" with { type: "json" };
import type {
  AlertLog,
  MicChecks,
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
import { isCoherentAlertPolicy } from "./alert-policy.js";
import type { AlertPersistence } from "./alerts.js";
import {
  CheckNotFoundError,
  MIC_CHECK_DIMENSIONS,
  type CheckPersistence,
} from "./checks.js";
import {
  REPORT_ACTIONS,
  REPORTED_FAULTS,
  ReportError,
  type ReportAction,
  type ReportPersistence,
} from "./reports.js";
import type { SessionPersistence } from "./sessions.js";
import { fabricatedLiveSnapshot } from "./fixtures/live-snapshot.js";
import { LiveMonitor, type PublishedState } from "./live-monitor.js";
import type { NodeSource } from "./node-observer.js";
import {
  hasCoherentRooms,
  hasCoherentSessions,
  hasUniqueChannelIds,
} from "./showfile.js";
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

const alertIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

const acknowledgeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["operator"],
  properties: { operator: { type: "string", maxLength: 80 } },
} as const;

const startSessionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId", "operator"],
  properties: {
    sessionId: { type: ["string", "null"], minLength: 1, maxLength: 64 },
    roomId: { type: ["string", "null"], minLength: 1, maxLength: 64 },
    operator: { type: "string", maxLength: 80 },
  },
} as const;

const checkParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["channelId", "dimensionId"],
  properties: {
    channelId: { type: "string", minLength: 1, maxLength: 64 },
    dimensionId: { enum: MIC_CHECK_DIMENSIONS },
  },
} as const;

const checkChannelParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["channelId"],
  properties: { channelId: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

const checkVerdictBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "by"],
  properties: {
    verdict: { enum: ["pass", "fail", "waiting"] },
    by: { type: "string", minLength: 1, maxLength: 80 },
    reason: { type: ["string", "null"], maxLength: 200 },
  },
} as const;

const createReportBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["channelId", "faults", "requestedBy"],
  properties: {
    channelId: { type: "string", minLength: 1, maxLength: 64 },
    faults: {
      type: "array",
      minItems: 1,
      maxItems: 9,
      items: { enum: REPORTED_FAULTS },
    },
    note: { type: ["string", "null"], maxLength: 200 },
    requestedBy: { type: "string", maxLength: 80 },
  },
} as const;

const reportActionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

const reportActionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "by"],
  properties: {
    action: { enum: REPORT_ACTIONS },
    by: { type: "string", maxLength: 80 },
  },
} as const;

const DEFAULT_HISTORY_WINDOW_MS = 30 * 60 * 1000;
const MIN_HISTORY_WINDOW_MS = 1000;
const MAX_HISTORY_WINDOW_MS = 60 * 60 * 1000;
const MAX_EVENT_STREAMS = 64;
const EVENT_HEARTBEAT_MS = 15_000;

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
  nodeSource?: NodeSource;
  alertPersistence?: AlertPersistence;
  checkPersistence?: CheckPersistence;
  reportPersistence?: ReportPersistence;
  sessionPersistence?: SessionPersistence;
  liveMonitor?: LiveMonitor;
  logger?: boolean;
};

const DATA_URL_PARTS = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/;

function stateEvent({ state, json }: PublishedState): string {
  return `event: state\nid: ${state.revision}\ndata: ${json}\n\n`;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const ajv = createStrictAjv2020();

  ajv.addSchema(healthResponseSchema);
  ajv.addSchema(liveSnapshotResponseSchema);
  ajv.addSchema(showfileSchema);
  ajv.addSchema(productionListSchema);
  ajv.addSchema(channelLevelHistorySchema);
  ajv.addSchema(liveStateSchema);
  ajv.addSchema(alertLogSchema);
  ajv.addSchema(micChecksSchema);

  server.setValidatorCompiler(({ schema }) => ajv.compile(schema as object));
  // Request validation failures answer in the same closed `{ error }` shape as
  // every other refusal, so a route's declared 400 contract cannot turn a bad
  // request into a 500.
  server.setErrorHandler(async (error, _request, reply) => {
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: "invalid-request" });
    }
    throw error;
  });
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

  const liveMonitor =
    options.liveMonitor ??
    new LiveMonitor({
      productionStore,
      nodeSource: options.nodeSource,
      alertPersistence: options.alertPersistence,
      checkPersistence: options.checkPersistence,
      reportPersistence: options.reportPersistence,
      sessionPersistence: options.sessionPersistence,
      onError: (error) => server.log.error(error),
    });
  const eventStreams = new Set<ServerResponse>();
  server.addHook("onReady", async () => {
    await liveMonitor.start();
  });
  server.addHook("preClose", async () => {
    for (const stream of eventStreams) stream.end();
    eventStreams.clear();
  });
  server.addHook("onClose", async () => {
    await liveMonitor.stop();
  });

  server.get(
    "/api/v1/live/state",
    { schema: { response: { 200: liveStateSchema } } },
    async (_request, reply) => {
      const { json } = await liveMonitor.current();
      // Already serialized through the strict live-state validator.
      return reply
        .header("Cache-Control", "no-store")
        .type("application/json; charset=utf-8")
        .send(json);
    },
  );

  server.get("/api/v1/live/events", async (request, reply) => {
    if (eventStreams.size >= MAX_EVENT_STREAMS) {
      return reply.code(503).send({ error: "event-stream-capacity" });
    }
    const initial = await liveMonitor.current();
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    stream.write(`retry: 2000\n\n${stateEvent(initial)}`);
    eventStreams.add(stream);
    const onState = (published: PublishedState) => {
      // A client that cannot keep up misses intermediate states, never the latest.
      if (stream.writableLength > 1024 * 1024) return;
      stream.write(stateEvent(published));
    };
    const heartbeat = setInterval(
      () => stream.write(": heartbeat\n\n"),
      EVENT_HEARTBEAT_MS,
    );
    heartbeat.unref();
    liveMonitor.on("state", onState);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      liveMonitor.off("state", onState);
      eventStreams.delete(stream);
    });
  });

  server.get(
    "/api/v1/alerts",
    { schema: { response: { 200: alertLogSchema } } },
    async (): Promise<AlertLog> => liveMonitor.alertLog(),
  );

  server.post(
    "/api/v1/alerts/:id/acknowledge",
    {
      schema: {
        params: alertIdParamsSchema,
        body: acknowledgeBodySchema,
        response: { 200: liveStateSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { operator } = request.body as { operator: string };
      const alert = await liveMonitor.acknowledge(id, operator);
      if (!alert) {
        return reply.code(404).send({ error: "alert-not-active" });
      }
      const { json } = await liveMonitor.current();
      return reply
        .header("Cache-Control", "no-store")
        .type("application/json; charset=utf-8")
        .send(json);
    },
  );

  server.put(
    "/api/v1/live/session",
    {
      schema: {
        body: startSessionBodySchema,
        response: { 200: liveStateSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { sessionId, roomId, operator } = request.body as {
        sessionId: string | null;
        roomId?: string | null;
        operator: string;
      };
      const published = await liveMonitor.startSession(
        sessionId,
        roomId ?? null,
        operator,
      );
      if (!published) {
        return reply.code(404).send({ error: "session-not-found" });
      }
      return reply
        .header("Cache-Control", "no-store")
        .type("application/json; charset=utf-8")
        .send(published.json);
    },
  );

  server.post(
    "/api/v1/reports",
    {
      schema: {
        body: createReportBodySchema,
        response: {
          201: liveStateSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { channelId, faults, note, requestedBy } = request.body as {
        channelId: string;
        faults: Array<(typeof REPORTED_FAULTS)[number]>;
        note?: string | null;
        requestedBy: string;
      };
      try {
        const published = await liveMonitor.createReport(
          channelId,
          faults,
          note ?? null,
          requestedBy,
        );
        if (!published) {
          return reply.code(404).send({ error: "channel-not-found" });
        }
        return reply
          .code(201)
          .header("Cache-Control", "no-store")
          .type("application/json; charset=utf-8")
          .send(published.json);
      } catch (error) {
        if (error instanceof ReportError) {
          return reply.code(400).send({ error: error.code });
        }
        throw error;
      }
    },
  );

  server.post(
    "/api/v1/reports/:id/actions",
    {
      schema: {
        params: reportActionParamsSchema,
        body: reportActionBodySchema,
        response: {
          200: liveStateSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { action, by } = request.body as {
        action: ReportAction;
        by: string;
      };
      try {
        const published = await liveMonitor.reportAction(id, action, by);
        return reply
          .header("Cache-Control", "no-store")
          .type("application/json; charset=utf-8")
          .send(published.json);
      } catch (error) {
        if (error instanceof ReportError) {
          return reply
            .code(error.code === "report-not-found" ? 404 : 409)
            .send({ error: error.code });
        }
        throw error;
      }
    },
  );

  server.get(
    "/api/v1/checks",
    { schema: { response: { 200: micChecksSchema } } },
    async (): Promise<MicChecks> => liveMonitor.checkList(),
  );

  server.put(
    "/api/v1/checks/:channelId/dimensions/:dimensionId",
    {
      schema: {
        params: checkParamsSchema,
        body: checkVerdictBodySchema,
        response: { 200: micChecksSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply): Promise<MicChecks | undefined> => {
      const { channelId, dimensionId } = request.params as {
        channelId: string;
        dimensionId: (typeof MIC_CHECK_DIMENSIONS)[number];
      };
      const { verdict, by, reason } = request.body as {
        verdict: "pass" | "fail" | "waiting";
        by: string;
        reason?: string | null;
      };
      const checks = await liveMonitor.recordCheck(
        channelId,
        dimensionId,
        verdict,
        by,
        reason ?? null,
      );
      if (!checks) {
        await reply.code(404).send({ error: "channel-not-found" });
        return undefined;
      }
      return checks;
    },
  );

  server.delete(
    "/api/v1/checks/:channelId",
    {
      schema: {
        params: checkChannelParamsSchema,
        response: { 200: micChecksSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply): Promise<MicChecks | undefined> => {
      const { channelId } = request.params as { channelId: string };
      try {
        return await liveMonitor.resetChecks(channelId);
      } catch (error) {
        if (error instanceof CheckNotFoundError) {
          await reply.code(404).send({ error: "check-not-found" });
          return undefined;
        }
        throw error;
      }
    },
  );

  server.delete(
    "/api/v1/checks",
    { schema: { response: { 200: micChecksSchema } } },
    async (): Promise<MicChecks> => liveMonitor.resetChecks(),
  );

  server.get(
    "/api/v1/channels/:id/image",
    { schema: { params: productionIdParamsSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      // Photos come from the monitor's cached showfile: a grid of cards must
      // not re-read and re-validate the whole production library per image.
      const showfile = await liveMonitor.activeShowfile();
      const imageUrl = showfile.channels.find(
        (channel) => channel.id === id,
      )?.imageUrl;
      if (!imageUrl) {
        return reply.code(404).send({ error: "image-not-found" });
      }
      const inline = DATA_URL_PARTS.exec(imageUrl);
      if (!inline) return reply.redirect(imageUrl);
      const etag = `"${showfile.revision}-${id}"`;
      if (request.headers["if-none-match"] === etag) {
        return reply.code(304).send();
      }
      return reply
        .header("Cache-Control", "no-cache")
        .header("ETag", etag)
        .type(inline[1]!)
        .send(Buffer.from(inline[2]!, "base64"));
    },
  );

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
      const { state } = await liveMonitor.current();
      if (!state.channels.some(({ id }) => id === channelId)) {
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
        intervalMs: liveMonitor.history.intervalMs,
        samples: liveMonitor.history.getWindow(channelId, windowMs),
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
        ) ||
        !hasUniqueChannelIds(candidate) ||
        !hasCoherentSessions(candidate) ||
        !hasCoherentRooms(candidate) ||
        (candidate.alertPolicy !== undefined &&
          !isCoherentAlertPolicy(candidate.alertPolicy));
      if (invalid) {
        await reply.code(400).send({ error: "invalid-showfile" });
        return undefined;
      }
      try {
        const saved = await productionStore.saveActive(candidate);
        liveMonitor.invalidateShowfile();
        return saved;
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
      liveMonitor.invalidateShowfile();
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
        liveMonitor.invalidateShowfile();
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
