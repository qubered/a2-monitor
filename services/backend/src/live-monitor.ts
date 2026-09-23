import { EventEmitter } from "node:events";
import liveStateSchema from "@rvlt/pulse-protocol/schema/live-state" with { type: "json" };
import type {
  AlertLog,
  LiveAlert,
  LiveState,
  MicCheckDimensionId,
  MicCheckDimensionRecord,
  MicChecks,
  MicCheckSubject,
  ReportedFault,
  Showfile,
} from "@rvlt/pulse-protocol/http";
import {
  createStrictAjv2020,
  stringifyValidatedJson,
} from "@rvlt/pulse-protocol/validation/strict-ajv";
import { resolveAlertPolicy } from "./alert-policy.js";
import {
  AlertBook,
  MemoryAlertPersistence,
  type AlertPersistence,
} from "./alerts.js";
import {
  CheckStore,
  MemoryCheckPersistence,
  subjectOf,
  type CheckPersistence,
} from "./checks.js";
import { LevelHistoryStore } from "./level-history.js";
import {
  MemoryReportPersistence,
  ReportBook,
  type ReportAction,
  type ReportPersistence,
} from "./reports.js";
import { evaluate, type ChannelTracker } from "./live-model.js";
import { NodeObserver, type NodeSource } from "./node-observer.js";
import type { ProductionStore } from "./productions.js";
import { emptyShowfile } from "./showfile.js";

const DEFAULT_TICK_MS = 1_000;
const SHOWFILE_REFRESH_MS = 5_000;
const PERSIST_DEBOUNCE_MS = 1_000;

export type LiveMonitorOptions = {
  productionStore: ProductionStore;
  nodeSource?: NodeSource;
  alertPersistence?: AlertPersistence;
  checkPersistence?: CheckPersistence;
  reportPersistence?: ReportPersistence;
  history?: LevelHistoryStore;
  tickMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
};

export type PublishedState = { state: LiveState; json: string };

const validateLiveState = createStrictAjv2020().compile(liveStateSchema);

/** Stands in until the production library can be read again; it has no channels to judge. */
const UNREADABLE_SHOWFILE: Showfile = {
  ...emptyShowfile(),
  show: { name: "Showfile could not be read" },
};

/**
 * The backend's live monitoring loop. Once a second it evaluates the active
 * showfile against the node's latest observations, advances the alert
 * lifecycle, records level history and publishes one contract-validated
 * state document that every Live client shares.
 */
export class LiveMonitor extends EventEmitter<{ state: [PublishedState] }> {
  readonly history: LevelHistoryStore;
  private readonly productionStore: ProductionStore;
  private readonly nodeSource: NodeSource;
  private readonly persistence: AlertPersistence;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private readonly trackers = new Map<string, ChannelTracker>();
  private readonly book = new AlertBook(5 * 60_000);
  private readonly checks = new CheckStore();
  private readonly checkPersistence: CheckPersistence;
  private checkPersistTimer: NodeJS.Timeout | undefined;
  private readonly reports = new ReportBook();
  private readonly reportPersistence: ReportPersistence;
  private reportPersistTimer: NodeJS.Timeout | undefined;
  private showfile: Showfile | null = null;
  private showfileLoadedAtMs = 0;
  private published: PublishedState | null = null;
  private revision = 0;
  private timer: NodeJS.Timeout | undefined;
  private persistTimer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();
  private busy = false;
  private started: Promise<void> | null = null;

  constructor(options: LiveMonitorOptions) {
    super();
    this.productionStore = options.productionStore;
    this.nodeSource = options.nodeSource ?? new NodeObserver();
    this.persistence = options.alertPersistence ?? new MemoryAlertPersistence();
    this.checkPersistence =
      options.checkPersistence ?? new MemoryCheckPersistence();
    this.reportPersistence =
      options.reportPersistence ?? new MemoryReportPersistence();
    this.history = options.history ?? new LevelHistoryStore();
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => undefined);
  }

  /** Restores persisted alerts, then starts polling and evaluating. Idempotent. */
  start(): Promise<void> {
    this.started ??= (async () => {
      try {
        this.book.restore(await this.persistence.load());
      } catch (error) {
        this.onError(error);
      }
      try {
        this.checks.restore(await this.checkPersistence.load());
      } catch (error) {
        this.onError(error);
      }
      try {
        this.reports.restore(await this.reportPersistence.load());
      } catch (error) {
        this.onError(error);
      }
      this.nodeSource.start();
      await this.tick();
      this.timer = setInterval(() => {
        if (!this.busy) void this.tick();
      }, this.tickMs);
      this.timer.unref?.();
    })();
    return this.started;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.nodeSource.stop();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      await this.persist();
    }
    if (this.checkPersistTimer) {
      clearTimeout(this.checkPersistTimer);
      this.checkPersistTimer = undefined;
      await this.persistChecks();
    }
    if (this.reportPersistTimer) {
      clearTimeout(this.reportPersistTimer);
      this.reportPersistTimer = undefined;
      await this.persistReports();
    }
  }

  /** Forces the next pass to reload the active showfile after a Manager change. */
  invalidateShowfile(): void {
    this.showfileLoadedAtMs = 0;
  }

  /** The active showfile as of the last evaluation pass, loaded once if none has run. */
  async activeShowfile(): Promise<Showfile> {
    if (!this.showfile || this.showfileLoadedAtMs === 0) await this.tick();
    return this.showfile ?? this.productionStore.loadActive();
  }

  async current(): Promise<PublishedState> {
    if (!this.published) await this.tick();
    if (!this.published) throw new Error("Live state is unavailable.");
    return this.published;
  }

  alertLog(): AlertLog {
    return this.book.log(this.now());
  }

  /** Files an A1 fault report against a channel in the active show; null when the channel is unknown. */
  async createReport(
    channelId: string,
    faults: readonly ReportedFault[],
    note: string | null,
    requestedBy: string,
  ): Promise<PublishedState | null> {
    const { state } = await this.current();
    const channel = state.channels.find(({ id }) => id === channelId);
    if (!channel) return null;
    this.reports.create(channel, faults, note, requestedBy, this.now());
    this.scheduleReportPersist();
    await this.tick();
    return this.current();
  }

  async reportAction(
    reportId: string,
    action: ReportAction,
    by: string,
  ): Promise<PublishedState> {
    this.reports.act(reportId, action, by, this.now());
    this.scheduleReportPersist();
    await this.tick();
    return this.current();
  }

  /** Current subjects for every channel in the active show, keyed by channel id. */
  private async subjects(): Promise<Map<string, MicCheckSubject>> {
    const showfile = await this.activeShowfile();
    return new Map(
      showfile.channels.flatMap((channel) =>
        channel.id ? [[channel.id, subjectOf(channel)] as const] : [],
      ),
    );
  }

  async checkList(): Promise<MicChecks> {
    return this.checks.list(await this.subjects(), this.now());
  }

  /** Records one verdict; returns null when the channel is not in the active show. */
  async recordCheck(
    channelId: string,
    dimensionId: MicCheckDimensionId,
    verdict: MicCheckDimensionRecord["verdict"],
    by: string,
    reason: string | null,
  ): Promise<MicChecks | null> {
    const subjects = await this.subjects();
    const subject = subjects.get(channelId);
    if (!subject) return null;
    this.checks.prune(new Set(subjects.keys()));
    this.checks.record(
      channelId,
      subject,
      dimensionId,
      verdict,
      by,
      reason,
      this.now(),
    );
    this.scheduleCheckPersist();
    await this.tick();
    return this.checks.list(subjects, this.now());
  }

  /** Clears one channel's check, or every check for a new performance. */
  async resetChecks(channelId?: string): Promise<MicChecks> {
    if (channelId === undefined) this.checks.resetAll();
    else this.checks.reset(channelId);
    this.scheduleCheckPersist();
    await this.tick();
    return this.checkList();
  }

  async acknowledge(id: string, operator: string): Promise<LiveAlert | null> {
    const alert = this.book.acknowledge(id, operator, this.now());
    if (alert) {
      this.schedulePersist();
      await this.tick();
    }
    return alert;
  }

  /** Queues one evaluation pass after any pass already running; exposed for deterministic tests. */
  tick(): Promise<void> {
    this.queue = this.queue.then(() => this.evaluateOnce());
    return this.queue;
  }

  private async evaluateOnce(): Promise<void> {
    this.busy = true;
    try {
      const nowMs = this.now();
      if (
        !this.showfile ||
        nowMs - this.showfileLoadedAtMs >= SHOWFILE_REFRESH_MS
      ) {
        this.showfileLoadedAtMs = nowMs;
        try {
          this.showfile = await this.productionStore.loadActive();
        } catch (error) {
          // Keep the last good showfile; with none, keep publishing node and
          // receiver state under a name that says what happened, and retry.
          this.onError(error);
          this.showfile ??= UNREADABLE_SHOWFILE;
        }
      }
      const showfile = this.showfile;
      const policy = resolveAlertPolicy(showfile);
      this.book.setOverlayExpiryMs(policy.overlayExpiryMinutes * 60_000);
      const evaluation = evaluate({
        showfile,
        policy,
        observation: this.nodeSource.current(),
        trackers: this.trackers,
        nowMs,
        checks: new Map(
          showfile.channels.flatMap((channel) => {
            const check = channel.id ? this.checks.get(channel.id) : undefined;
            return check ? [[channel.id!, check] as const] : [];
          }),
        ),
      });
      if (this.book.apply(evaluation.conditions, nowMs)) this.schedulePersist();
      this.history.record(nowMs, evaluation.channels);
      const faulty = new Set(
        evaluation.channels
          .filter(({ statuses }) => Object.values(statuses).includes("fault"))
          .map(({ id }) => id),
      );
      if (this.reports.promoteForTelemetry(faulty))
        this.scheduleReportPersist();

      const alerts = this.book.activeAlerts();
      const outstanding = alerts.filter(
        ({ acknowledgedAtUtc }) => acknowledgedAtUtc === null,
      );
      this.revision += 1;
      const state: LiveState = {
        schemaVersion: "0",
        revision: this.revision,
        generatedAtUtc: new Date(nowMs).toISOString(),
        show: {
          name: showfile.show.name,
          showfileRevision: showfile.revision,
          overlayExpiryMs: policy.overlayExpiryMinutes * 60_000,
        },
        node: evaluation.node,
        receivers: evaluation.receivers,
        channels: evaluation.channels,
        alerts,
        reports: this.reports.visible(nowMs),
        summary: {
          active: alerts.length,
          outstanding: outstanding.length,
          outstandingCritical: outstanding.filter(
            ({ severity }) => severity === "critical",
          ).length,
        },
      };
      const json = stringifyValidatedJson(validateLiveState, state);
      this.published = { state, json };
      this.emit("state", this.published);
    } catch (error) {
      this.onError(error);
    } finally {
      this.busy = false;
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  private scheduleReportPersist(): void {
    if (this.reportPersistTimer) return;
    this.reportPersistTimer = setTimeout(() => {
      this.reportPersistTimer = undefined;
      void this.persistReports();
    }, PERSIST_DEBOUNCE_MS);
    this.reportPersistTimer.unref?.();
  }

  private async persistReports(): Promise<void> {
    try {
      await this.reportPersistence.save(this.reports.snapshot());
    } catch (error) {
      this.onError(error);
    }
  }

  private scheduleCheckPersist(): void {
    if (this.checkPersistTimer) return;
    this.checkPersistTimer = setTimeout(() => {
      this.checkPersistTimer = undefined;
      void this.persistChecks();
    }, PERSIST_DEBOUNCE_MS);
    this.checkPersistTimer.unref?.();
  }

  private async persistChecks(): Promise<void> {
    try {
      await this.checkPersistence.save(this.checks.snapshot());
    } catch (error) {
      this.onError(error);
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.persistence.save(this.book.snapshot());
    } catch (error) {
      this.onError(error);
    }
  }
}
