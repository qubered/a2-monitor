import {
  parseNodeLevels,
  parseShureTelemetry,
  type NodeLevels,
  type ShureTelemetry,
} from "@rvlt/pulse-protocol/http";

/** The node is reported unreachable once its level summary is older than this. */
export const NODE_UNREACHABLE_AFTER_MS = 3_000;
const DEFAULT_POLL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 900;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type NodeObservation = {
  configured: boolean;
  /** Last validated level summary and when it arrived (backend clock). */
  levels: NodeLevels | null;
  levelsAtMs: number | null;
  /** Last validated receiver telemetry and when it arrived (backend clock). */
  shure: ShureTelemetry | null;
  shureAtMs: number | null;
  firstAttemptAtMs: number | null;
  error: string | null;
};

export interface NodeSource {
  current(): NodeObservation;
  start(): void;
  stop(): void;
}

export type NodeObserverOptions = {
  origin?: string;
  fetch?: typeof fetch;
  pollMs?: number;
  now?: () => number;
};

async function readJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new Error("Audio node response exceeded the size limit.");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("Audio node response exceeded the size limit.");
  }
  return JSON.parse(text) as unknown;
}

/**
 * Polls the audio node's normalized observations. The backend never enters
 * the sample path: it reads only the node's per-second level summary and its
 * normalized receiver telemetry, both validated against their contracts.
 */
export class NodeObserver implements NodeSource {
  private readonly origin: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly pollMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private observation: NodeObservation;

  constructor(options: NodeObserverOptions = {}) {
    this.origin = options.origin;
    this.fetcher = options.fetch ?? fetch;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.now = options.now ?? Date.now;
    this.observation = {
      configured: Boolean(this.origin),
      levels: null,
      levelsAtMs: null,
      shure: null,
      shureAtMs: null,
      firstAttemptAtMs: null,
      error: this.origin
        ? null
        : "No audio node is configured for this backend.",
    };
  }

  current(): NodeObservation {
    return this.observation;
  }

  start(): void {
    if (!this.origin || this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One poll of both endpoints; exposed for deterministic tests. */
  async poll(): Promise<void> {
    if (!this.origin || this.polling) return;
    this.polling = true;
    const startedAt = this.now();
    if (this.observation.firstAttemptAtMs === null) {
      this.observation = { ...this.observation, firstAttemptAtMs: startedAt };
    }
    try {
      const [levels, shure] = await Promise.allSettled([
        this.fetchContract("/audio/v0/levels", parseNodeLevels),
        this.fetchContract("/audio/v0/shure", parseShureTelemetry),
      ]);
      const at = this.now();
      this.observation = {
        ...this.observation,
        ...(levels.status === "fulfilled"
          ? { levels: levels.value, levelsAtMs: at }
          : {}),
        ...(shure.status === "fulfilled"
          ? { shure: shure.value, shureAtMs: at }
          : {}),
        error:
          levels.status === "rejected"
            ? levels.reason instanceof Error
              ? levels.reason.message
              : "The audio node could not be read."
            : null,
      };
    } finally {
      this.polling = false;
    }
  }

  private async fetchContract<T>(
    path: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const response = await this.fetcher(new URL(path, this.origin), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Audio node ${path} returned HTTP ${response.status}.`);
    }
    return parse(await readJson(response));
  }
}
