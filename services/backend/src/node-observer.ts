import {
  parseNodeLevels,
  parseShureTelemetry,
  type NodeLevels,
  type ShureTelemetry,
} from "@rvlt/pulse-protocol/http";
import { SseParser } from "@rvlt/pulse-protocol/sse-parser";

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
  /** Calls back when new receiver telemetry arrives; returns an unsubscribe. */
  onTelemetry?(listener: () => void): () => void;
}

/** Where the node pushes receiver telemetry as it changes. */
const RECEIVER_EVENTS_PATH = "/audio/v0/receivers/events";
const STREAM_RETRY_MS = 1_000;
/** The node repeats its fleet document every second; this much silence means the stream is gone. */
const DEFAULT_STREAM_QUIET_MS = 3_000;

export type NodeObserverOptions = {
  origin?: string;
  fetch?: typeof fetch;
  pollMs?: number;
  now?: () => number;
  /** How long the receiver stream may stay silent before polling takes over. */
  streamQuietMs?: number;
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
  private readonly listeners = new Set<() => void>();
  private stream: AbortController | null = null;
  /** True while the node's receiver stream delivers; polling stands in otherwise. */
  private streaming = false;
  private streamRetry: NodeJS.Timeout | undefined;
  private readonly streamQuietMs: number;
  /** Bumped by every streamed document, so an older poll cannot overwrite it. */
  private telemetrySequence = 0;
  /** Bumped on every start and stop, so work from an earlier run is dropped. */
  private run = 0;

  constructor(options: NodeObserverOptions = {}) {
    this.origin = options.origin;
    this.fetcher = options.fetch ?? fetch;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.now = options.now ?? Date.now;
    this.streamQuietMs = options.streamQuietMs ?? DEFAULT_STREAM_QUIET_MS;
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

  onTelemetry(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.origin || this.timer) return;
    this.run += 1;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
    this.openStream();
  }

  stop(): void {
    this.run += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.streamRetry) clearTimeout(this.streamRetry);
    this.streamRetry = undefined;
    this.stream?.abort();
    this.stream = null;
    this.streaming = false;
  }

  private telemetry(shure: ShureTelemetry): void {
    this.telemetrySequence += 1;
    this.observation = {
      ...this.observation,
      shure,
      shureAtMs: this.now(),
    };
    for (const listener of this.listeners) listener();
  }

  /**
   * Follows the node's receiver telemetry stream: a full `fleet` document,
   * then one `receiver` at a time as it changes. Every event is validated
   * against the same closed contract as the polled document; anything else is
   * dropped and the last good document kept.
   */
  private openStream(): void {
    if (!this.origin || this.stream) return;
    const controller = new AbortController();
    this.stream = controller;
    // A stream that never sends a valid fleet document, or goes quiet, is
    // abandoned; polling covers receiver telemetry until it is back.
    let watchdog: NodeJS.Timeout | undefined;
    const feed = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), this.streamQuietMs);
      watchdog.unref?.();
    };
    feed();
    const retry = () => {
      if (watchdog) clearTimeout(watchdog);
      if (this.stream !== controller) return;
      this.stream = null;
      this.streaming = false;
      if (!this.timer) return;
      this.streamRetry = setTimeout(() => {
        this.streamRetry = undefined;
        this.openStream();
      }, STREAM_RETRY_MS);
      this.streamRetry.unref?.();
    };
    void (async () => {
      const response = await this.fetcher(
        new URL(RECEIVER_EVENTS_PATH, this.origin),
        { signal: controller.signal },
      );
      if (
        !response.ok ||
        !response.body ||
        !/^text\/event-stream\b/.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        return;
      }
      const parser = new SseParser({ maxEventBytes: MAX_RESPONSE_BYTES });
      for await (const chunk of response.body) {
        for (const { event, data } of parser.push(chunk)) {
          // A stopped or replaced stream publishes nothing.
          if (this.stream !== controller) return;
          let value: unknown;
          try {
            value = JSON.parse(data);
          } catch {
            continue;
          }
          if (event === "fleet") {
            try {
              const fleet = parseShureTelemetry(value);
              this.streaming = true;
              feed();
              this.telemetry(fleet);
            } catch {
              // Not the contract: keep the last good document.
            }
          } else if (
            event === "receiver" &&
            this.streaming &&
            this.observation.shure
          ) {
            const current = this.observation.shure;
            try {
              const [receiver] = parseShureTelemetry({
                ...current,
                receivers: [value],
              }).receivers;
              const receivers = current.receivers.some(
                ({ id }) => id === receiver!.id,
              )
                ? current.receivers.map((existing) =>
                    existing.id === receiver!.id ? receiver! : existing,
                  )
                : [...current.receivers, receiver!];
              feed();
              this.telemetry({ ...current, receivers });
            } catch {
              // Not the contract: keep the last good document.
            }
          }
        }
      }
    })()
      .catch(() => undefined)
      .finally(retry);
  }

  /** One poll of both endpoints; exposed for deterministic tests. */
  async poll(): Promise<void> {
    if (!this.origin || this.polling) return;
    this.polling = true;
    const startedAt = this.now();
    const sequence = this.telemetrySequence;
    const run = this.run;
    if (this.observation.firstAttemptAtMs === null) {
      this.observation = { ...this.observation, firstAttemptAtMs: startedAt };
    }
    try {
      const [levels, shure] = await Promise.allSettled([
        this.fetchContract("/audio/v0/levels", parseNodeLevels),
        // Receiver telemetry is pushed while the stream is up.
        this.streaming
          ? Promise.reject(new Error("streamed"))
          : this.fetchContract("/audio/v0/shure", parseShureTelemetry),
      ]);
      const at = this.now();
      // Stopped (or restarted) while this poll was in flight: drop it.
      if (run !== this.run) return;
      this.observation = {
        ...this.observation,
        ...(levels.status === "fulfilled"
          ? { levels: levels.value, levelsAtMs: at }
          : {}),
        // A streamed document that arrived meanwhile is newer than this poll.
        ...(shure.status === "fulfilled" &&
        !this.streaming &&
        sequence === this.telemetrySequence
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
