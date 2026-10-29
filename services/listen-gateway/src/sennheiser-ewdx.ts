import {
  Agent,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "node:http";
import { isIP, type NetConnectOpts } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import type { Showfile, ShureTelemetry } from "@rvlt/pulse-protocol/http";
import type { ShureCapabilityProfile } from "@rvlt/pulse-protocol/shure-models";
import { SENNHEISER_MODEL_INFO } from "@rvlt/pulse-protocol/sennheiser-models";
import { SseParser } from "@rvlt/pulse-protocol/sse-parser";

// Read-only Sennheiser EW-DX EM 2 Dante adapter over authenticated SSCv2.
//
// Every resource path, unit and range below comes from the EW-DX 3rd-party
// OpenAPI release 1.7 (OpenAPI 3.1.0, HTTPS on port 443, Basic auth as user
// `api`). Only GETs are ever issued: the adapter never changes receiver
// configuration, and the receiver API is telemetry only. Dante audio reaches
// the node independently, so a telemetry outage never touches audio. The
// mapping is `compatible-read-only` and unverified until it passes a
// hardware acceptance test.

type ReceiverState = ShureTelemetry["receivers"][number];
export type EwdxChannelState = ReceiverState["channels"][number];

/** One GET result: an HTTP status with its parsed JSON body, or a transport failure. */
export type EwdxReading =
  | { status: number; body: unknown }
  | {
      error:
        "timeout" | "network" | "malformed" | "aborted" | "identity-changed";
    };

export type EwdxChannelReadings = {
  /** GET /api/channel/{id} */
  channel: EwdxReading;
  /** GET /api/channel/{id}/warnings */
  warnings: EwdxReading;
  /** GET /api/channel/{id}/signalStrengthIndicator (RSSI, dBm, -107..0) */
  rssi: EwdxReading;
  /** GET /api/channel/{id}/signalQualityIndicator (RSQI, percent, 0..100) */
  rsqi: EwdxReading;
  /** GET /api/channel/{id}/level (dBFS, -138.5..0) */
  level: EwdxReading;
  /** GET /api/rf/channels/{id} (frequency in kHz) */
  rf: EwdxReading;
  /** GET /api/transmitters/{id} (422 while no transmitter is linked) */
  transmitter: EwdxReading;
  /** GET /api/transmitters/{id}/battery (gauge percent, lifetime minutes) */
  battery: EwdxReading;
  /** GET /api/transmitters/{id}/warnings */
  transmitterWarnings: EwdxReading;
};

export type EwdxIdentityReadings = {
  /** GET /api/ssc/version (no auth) */
  version: EwdxReading;
  /** GET /api/device/identity (no auth) */
  identity: EwdxReading;
  /** GET /api/firmware/update/state (auth) */
  firmware: EwdxReading;
};

export type EwdxIdentity =
  | {
      ok: true;
      product: string;
      serial: string | null;
      firmware: string;
      protocol: string;
      schema: string;
    }
  | { ok: false; detail: string };

/**
 * What the EW-DX OpenAPI exposes for each Pulse capability. There is no
 * per-antenna diversity label (diversityIndicator is an undocumented 0..2
 * number) and no interference classification, so both stay off rather than
 * being derived.
 */
export const EWDX_CAPABILITIES: ShureCapabilityProfile = {
  antennaDiversity: false,
  linkQuality: true,
  interference: false,
  audioMeter: true,
  batteryHealth: true,
  transmitterDetail: true,
};

const VENDOR = "Sennheiser electronic SE & Co. KG";
const SUPPORTED_FIRMWARE_MAJOR = 4;
const SUPPORTED_SCHEMA_MAJOR = 1;
const MAX_WARNINGS = 8;

const CHANNEL_WARNINGS: Record<string, string> = {
  Aes256Error: "Encryption mismatch detected.",
  LowSignal: "Low RF signal reported by the receiver.",
  NoLink: "No transmitter link reported by the receiver.",
  RfPeak: "RF peak reported by the receiver.",
  AfPeak: "Audio peak reported by the receiver.",
};
const TRANSMITTER_WARNINGS: Record<string, string> = {
  LowBattery: "Transmitter reports a low battery.",
  AfPeak: "Audio peak reported by the transmitter.",
};
const BATTERY_TYPES = new Set(["Battery", "PrimaryCell", "NoBattery"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function okBody(reading: EwdxReading): Record<string, unknown> | null {
  return "status" in reading && reading.status === 200 && isRecord(reading.body)
    ? reading.body
    : null;
}

function okArray(reading: EwdxReading): unknown[] | null {
  return "status" in reading &&
    reading.status === 200 &&
    Array.isArray(reading.body)
    ? reading.body
    : null;
}

function succeeded(reading: EwdxReading): boolean {
  return "status" in reading && reading.status === 200;
}

function unlinked(reading: EwdxReading): boolean {
  return "status" in reading && reading.status === 422;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < minimum || value > maximum) return null;
  return value;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.slice(0, maxLength);
}

function majorOf(version: string): number | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  return match ? Number(match[1]) : null;
}

/** Empty, never-observed channel: every reading unavailable, nothing invented. */
export function emptyEwdxChannel(index: number): EwdxChannelState {
  return {
    index,
    linkStatus: "unavailable",
    batteryBars: null,
    batteryChargePercent: null,
    batteryType: null,
    batteryCycleCount: null,
    batteryRunTimeMinutes: null,
    antennas: [],
    rfLevelDbm: null,
    rfLevelRaw: null,
    linkQualityRaw: null,
    linkQualityPercent: null,
    interference: "unavailable",
    audioLevelDbfs: null,
    audioLevelRaw: null,
    frequencyRaw: null,
    groupChannelRaw: null,
    transmitter: { type: null, name: null, muted: null },
    warnings: [],
    observedAtUtc: null,
    availability: "unavailable",
  };
}

function authFailure(reading: EwdxReading): string | null {
  if (!("status" in reading)) return null;
  if (reading.status === 401)
    return "The receiver's third-party password was rejected. Check the password set for this receiver in Manager.";
  if (reading.status === 403)
    return "The receiver's api user is not allowed to read this resource. Check that third-party access is enabled.";
  return null;
}

/**
 * Checks what the receiver reports without credentials: SSCv2, a reviewed
 * schema, the Sennheiser vendor and the exact product. Returns null when it
 * passes. This runs before the password is sent anywhere.
 */
export function checkEwdxDevice(
  readings: Pick<EwdxIdentityReadings, "version" | "identity">,
): string | null {
  const result = checkEwdxIdentity({
    ...readings,
    firmware: { status: 200, body: { deviceVersion: "4.0.0" } },
  });
  return result.ok ? null : result.detail;
}

/** Checks protocol, schema, vendor, exact product and firmware before any telemetry is trusted. */
export function checkEwdxIdentity(
  readings: EwdxIdentityReadings,
): EwdxIdentity {
  const model = SENNHEISER_MODEL_INFO["EW-DX EM 2 Dante"];
  const version = okBody(readings.version);
  const protocol = boundedText(version?.protocol, 16);
  const schema = boundedText(version?.schema, 16);
  if (!protocol || !schema)
    return {
      ok: false,
      detail: "The receiver did not report an SSC protocol and schema version.",
    };
  if (majorOf(protocol) !== 2)
    return {
      ok: false,
      detail: `The receiver speaks SSC protocol ${protocol}, not SSCv2. Legacy SSCv1 is not enabled.`,
    };
  if (majorOf(schema) !== SUPPORTED_SCHEMA_MAJOR)
    return {
      ok: false,
      detail: `The receiver's API schema ${schema} is not a reviewed version (1.x).`,
    };

  const identity = okBody(readings.identity);
  if (!identity)
    return {
      ok: false,
      detail: "The receiver did not report a device identity.",
    };
  if (identity.vendor !== VENDOR)
    return {
      ok: false,
      detail:
        "The device at this address does not report the Sennheiser vendor.",
    };
  const product = boundedText(identity.product, 32);
  if (product !== model.identityProduct)
    return {
      ok: false,
      detail: `The receiver reports product ${product ?? "unknown"}, not ${model.identityProduct} (the code expected for the EW-DX EM 2 Dante; hardware-unverified).`,
    };

  const auth = authFailure(readings.firmware);
  if (auth) return { ok: false, detail: auth };
  const firmware = boundedText(okBody(readings.firmware)?.deviceVersion, 32);
  const major = firmware === null ? null : majorOf(firmware);
  if (firmware === null || major === null)
    return {
      ok: false,
      detail:
        "The receiver's firmware version is unknown; telemetry is not trusted.",
    };
  if (major < SUPPORTED_FIRMWARE_MAJOR)
    return {
      ok: false,
      detail: `Firmware ${firmware} predates SSCv2 (${model.minimumFirmware}); it speaks only SSCv1, which is not enabled.`,
    };
  if (major > SUPPORTED_FIRMWARE_MAJOR)
    return {
      ok: false,
      detail: `Firmware ${firmware} has not been reviewed for Pulse; only 4.x is supported.`,
    };
  return {
    ok: true,
    product,
    serial: boundedText(identity.serial, 64),
    firmware,
    protocol,
    schema,
  };
}

function mappedWarnings(
  reading: EwdxReading,
  table: Record<string, string>,
): string[] {
  return (okArray(reading) ?? [])
    .filter((value): value is string => typeof value === "string")
    .filter((value) => Object.hasOwn(table, value))
    .map((value) => table[value]!);
}

/**
 * Folds one poll of a channel's resources into its normalized state. A field
 * whose request failed, or whose value is malformed, nonfinite or outside the
 * documented range, is unavailable (null) rather than zero. When every
 * request failed the previous observation is kept and marked stale.
 */
export function normalizeEwdxChannel(
  previous: EwdxChannelState,
  readings: EwdxChannelReadings,
  nowUtc: string,
): EwdxChannelState {
  const unobserved =
    previous.observedAtUtc === null
      ? previous
      : { ...previous, availability: "stale" as const };
  if (
    !Object.values(readings).some(succeeded) &&
    !unlinked(readings.transmitter)
  )
    return unobserved;

  // A link needs a well-formed transmitter body, not just an HTTP 200.
  const linked = boundedText(okBody(readings.transmitter)?.type, 64) !== null;
  const noLink =
    unlinked(readings.transmitter) ||
    (okArray(readings.warnings) ?? []).includes("NoLink");
  const linkStatus: EwdxChannelState["linkStatus"] =
    linked && !noLink ? "active" : noLink ? "no-transmitter" : "unavailable";
  const transmitter = okBody(readings.transmitter);
  const battery = linkStatus === "active" ? okBody(readings.battery) : null;
  const batteryType =
    typeof battery?.type === "string" && BATTERY_TYPES.has(battery.type)
      ? battery.type
      : null;
  // NoBattery means there is no cell to measure, not an empty one.
  const measurable = batteryType !== "NoBattery";
  const gauge = measurable ? boundedNumber(battery?.gauge, 0, 100) : null;
  const lifetime = measurable
    ? boundedNumber(battery?.lifetime, 0, 1_440)
    : null;
  const rssi = boundedNumber(okBody(readings.rssi)?.value, -107, 0);
  const rsqi = boundedNumber(okBody(readings.rsqi)?.value, 0, 100);
  const level = boundedNumber(okBody(readings.level)?.value, -138.5, 0);
  const frequency = okBody(readings.rf)?.frequency;
  const muted =
    linkStatus === "active" && typeof transmitter?.mute === "boolean"
      ? transmitter.mute
      : null;
  const channelBody = okBody(readings.channel);

  const next: EwdxChannelState = {
    ...previous,
    linkStatus,
    batteryBars: null,
    batteryChargePercent: gauge === null ? null : Math.round(gauge),
    batteryType: linkStatus === "active" ? batteryType : null,
    batteryCycleCount: null,
    batteryRunTimeMinutes: lifetime === null ? null : Math.round(lifetime),
    antennas: [],
    rfLevelDbm: rssi === null ? null : Math.round(rssi),
    rfLevelRaw: null,
    linkQualityRaw: null,
    linkQualityPercent: rsqi === null ? null : Math.round(rsqi),
    interference: "unavailable",
    audioLevelDbfs: level === null ? null : Math.round(level),
    audioLevelRaw: null,
    frequencyRaw:
      typeof frequency === "number" &&
      Number.isInteger(frequency) &&
      frequency > 0 &&
      frequency <= 9_999_999
        ? String(frequency)
        : null,
    groupChannelRaw: null,
    transmitter: {
      // The last confirmed type is kept across a dropout, as on Shure; a
      // linked transmitter of a different type replaces it.
      type:
        linkStatus === "active"
          ? (boundedText(transmitter?.type, 64) ?? previous.transmitter.type)
          : previous.transmitter.type,
      name: channelBody
        ? boundedText(channelBody.name, 64)
        : previous.transmitter.name,
      muted,
    },
    observedAtUtc: nowUtc,
    availability: "observed",
  };
  // An answer only counts as an observation when it carried at least one
  // documented, valid value; HTTP 200s with the wrong shape do not.
  const usable =
    linkStatus !== "unavailable" ||
    okArray(readings.warnings) !== null ||
    (channelBody !== null && boundedText(channelBody.name, 64) !== null) ||
    [
      next.rfLevelDbm,
      next.linkQualityPercent,
      next.audioLevelDbfs,
      next.frequencyRaw,
    ].some((value) => value !== null);
  if (!usable) return unobserved;
  const warnings = [
    ...mappedWarnings(readings.warnings, CHANNEL_WARNINGS).filter(
      (warning) => warning !== CHANNEL_WARNINGS.NoLink,
    ),
    ...(linkStatus === "active"
      ? mappedWarnings(readings.transmitterWarnings, TRANSMITTER_WARNINGS)
      : []),
  ];
  if (next.batteryChargePercent !== null && next.batteryChargePercent <= 10)
    warnings.push("Transmitter battery critically low.");
  if (muted === true) warnings.push("Transmitter is muted.");
  return { ...next, warnings: warnings.slice(0, MAX_WARNINGS) };
}

// ---- Transport -------------------------------------------------------------

/** SSCv2 is HTTPS on the receiver's port 443. Only tests override it. */
export const EWDX_HTTPS_PORT = 443;

/**
 * The port to reach a receiver on. Only a loopback address (the development
 * simulator) may use another port; a receiver on the network is always 443.
 */
export function ewdxPortFor(
  host: string,
  override: number | undefined,
): number {
  const loopback = host === "::1" || /^127\./.test(host);
  return loopback && override !== undefined ? override : EWDX_HTTPS_PORT;
}
const MAX_RESPONSE_BYTES = 64 * 1024;
const STALE_AFTER_MS = 15_000;

class UnverifiedConnectionError extends Error {
  constructor() {
    super("unverified-connection");
  }
}

/** The receiver a monitor has identified; every new connection must match it. */
export type EwdxExpectedIdentity = { product: string; serial: string | null };

/**
 * Opens TLS sockets to a receiver. EW-DX receivers present a self-signed
 * certificate that no chain can validate, so chain and name checks are off for
 * these sockets only and the receiver's certificate is trusted as presented;
 * nothing here changes global TLS settings. What stands in for certificate
 * trust is the unauthenticated identity check that must be the first request
 * on every connection, before a single credential is written.
 *
 * The agent also never opens a connection on its own: each new connection
 * needs a one-shot permit, which the transport grants only for that identity
 * check.
 */
class SelfSignedTlsAgent extends Agent {
  private permit = false;

  constructor(private readonly handshakeTimeoutMs: number) {
    super({ keepAlive: true, maxSockets: 1 });
  }

  /** Allows exactly one new connection, for an identity check. */
  allowOneConnection(): void {
    this.permit = true;
  }

  override createConnection(
    options: NetConnectOpts,
    callback?: (error: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    if (!this.permit) {
      callback?.(new UnverifiedConnectionError(), undefined as never);
      return undefined;
    }
    this.permit = false;
    const { host, port } = options as { host?: string; port?: number };
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      callback?.(error, socket);
    };
    const socket = tlsConnect({
      host,
      port,
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    });
    socket.setTimeout(this.handshakeTimeoutMs, () =>
      socket.destroy(new Error("timeout")),
    );
    socket.once("secureConnect", () => settle(null));
    socket.once("error", (error) => settle(error));
    return undefined;
  }
}

type GetOptions = {
  auth: boolean;
  signal: AbortSignal;
  method?: "GET" | "PUT" | "DELETE";
  body?: unknown;
};

/** The SSCv2 subscription collection (SSCv2 2.3, "SSCv2 subscriptions"). */
const SUBSCRIPTIONS_PATH = "/api/ssc/state/subscriptions";
/**
 * A session path this adapter may write to: exactly the collection plus a
 * server-generated id. Pulse builds these paths itself from a validated id
 * and never follows a location the receiver supplies.
 */
const SESSION_PATH = /^\/api\/ssc\/state\/subscriptions\/([A-Za-z0-9-]{8,64})$/;
/**
 * Content-Location of a new subscription. SSCv2 2.3 specifies the session
 * path; the EW-DX OpenAPI 1.7 example shows the bare session id. Either form
 * is accepted only as an id that must equal the `open` event's, and Pulse
 * builds every session path itself from it.
 */
const SESSION_LOCATION =
  /^(?:\/api\/ssc\/state\/subscriptions\/)?([A-Za-z0-9-]{8,64})$/;

export type EwdxStreamOpen = {
  response: IncomingMessage;
  request: ClientRequest;
  sessionUuid: string;
};

class EwdxTransport {
  private readonly agent: SelfSignedTlsAgent;
  private readonly authorization: string;

  constructor(
    private readonly host: string,
    private readonly port: number,
    password: string,
    private readonly timeoutMs: number,
  ) {
    this.agent = new SelfSignedTlsAgent(timeoutMs);
    this.authorization = `Basic ${Buffer.from(`api:${password}`).toString("base64")}`;
  }

  /** The identified receiver; null while (re)identifying. */
  expected: EwdxExpectedIdentity | null = null;

  private hasIdleSocket(): boolean {
    const name = this.agent.getName({ host: this.host, port: this.port });
    return (this.agent.freeSockets[name] ?? []).some(
      (socket) => !socket.destroyed,
    );
  }

  private matches(identity: EwdxReading): boolean {
    if (!this.expected) return true;
    const body =
      "status" in identity && identity.status === 200 && isRecord(identity.body)
        ? identity.body
        : null;
    return (
      body !== null &&
      body.product === this.expected.product &&
      (typeof body.serial === "string" ? body.serial : null) ===
        this.expected.serial
    );
  }

  /**
   * Issues one GET. When no verified connection is idle, a new one is opened
   * for an unauthenticated identity check first, and nothing else is sent on
   * it unless the same receiver answers.
   */
  async get(path: string, options: GetOptions): Promise<EwdxReading> {
    const verified = await this.verifyConnection(options.signal, path);
    if (verified) return verified;
    return this.send(path, options);
  }

  /**
   * Makes sure the next request goes out on a connection already shown to be
   * the identified receiver. Returns a reading to hand back instead of
   * sending (an error, or the identity answer itself), or null to proceed.
   */
  private async verifyConnection(
    signal: AbortSignal,
    path: string,
  ): Promise<EwdxReading | null> {
    if (!this.hasIdleSocket()) {
      this.agent.allowOneConnection();
      const identity = await this.send("/api/device/identity", {
        auth: false,
        signal,
      });
      if ("error" in identity) return identity;
      if (!this.matches(identity)) return { error: "identity-changed" };
      if (path === "/api/device/identity") return identity;
      if (!this.hasIdleSocket()) return { error: "network" };
    }
    return null;
  }

  /**
   * Opens the SSCv2 subscription stream on this transport's own connection:
   * identity first on that socket, then the authenticated subscription GET on
   * the same socket. Nothing else is ever sent on it (SSCv2 2.3 forbids
   * regular requests on the stream connection).
   */
  async openStream(signal: AbortSignal): Promise<EwdxStreamOpen | EwdxReading> {
    const verified = await this.verifyConnection(signal, SUBSCRIPTIONS_PATH);
    if (verified) return verified;
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: EwdxStreamOpen | EwdxReading) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const request = httpRequest(
        {
          agent: this.agent,
          host: this.host,
          port: this.port,
          path: SUBSCRIPTIONS_PATH,
          method: "GET",
          headers: {
            accept: "text/event-stream",
            authorization: this.authorization,
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const type = String(response.headers["content-type"] ?? "");
          const location = response.headers["content-location"];
          const match =
            typeof location === "string"
              ? SESSION_LOCATION.exec(location)
              : null;
          if (status !== 200) {
            request.destroy();
            return finish({ status, body: null });
          }
          if (!/^text\/event-stream\b/i.test(type) || !match) {
            request.destroy();
            return finish({ error: "malformed" });
          }
          // The stream has no request timeout once open; session liveness is
          // checked separately on the control connection.
          response.socket?.setTimeout(0);
          response.socket?.setKeepAlive(true, 5_000);
          finish({ response, request, sessionUuid: match[1]! });
        },
      );
      const timer = setTimeout(() => {
        request.destroy();
        finish({ error: "timeout" });
      }, this.timeoutMs);
      const onAbort = () => {
        request.destroy();
        finish({ error: "aborted" });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      request.on("error", () => finish({ error: "network" }));
      request.end();
    });
  }

  private send(
    path: string,
    { auth, signal, method = "GET", body }: GetOptions,
  ): Promise<EwdxReading> {
    // Read-only adapter: the only writes are to its own SSCv2 subscription
    // session, never device configuration.
    if (method !== "GET" && !SESSION_PATH.test(path))
      return Promise.resolve({ error: "aborted" });
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve) => {
      let done = false;
      const finish = (reading: EwdxReading) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(reading);
      };
      const request = httpRequest(
        {
          agent: this.agent,
          host: this.host,
          port: this.port,
          path,
          method,
          headers: {
            accept: "application/json",
            // Credentials only on resources the OpenAPI marks authenticated.
            ...(auth ? { authorization: this.authorization } : {}),
            ...(payload === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(payload),
                }),
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              request.destroy();
              finish({ error: "malformed" });
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (status !== 200 || chunks.length === 0)
              return finish({
                status,
                body: status === 200 ? null : parseOrNull(chunks),
              });
            try {
              finish({
                status,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              });
            } catch {
              finish({ error: "malformed" });
            }
          });
          response.on("error", () => finish({ error: "network" }));
        },
      );
      const timer = setTimeout(() => {
        request.destroy();
        finish({ error: "timeout" });
      }, this.timeoutMs);
      const onAbort = () => {
        request.destroy();
        finish({ error: "aborted" });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      request.on("error", () => finish({ error: "network" }));
      request.end(payload);
    });
  }

  close(): void {
    this.agent.destroy();
  }
}

function parseOrNull(chunks: Buffer[]): unknown {
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// ---- Receiver monitor ------------------------------------------------------

export type EwdxReceiverConfig = NonNullable<
  Showfile["sennheiserReceivers"]
>[number];

export type EwdxMonitorOptions = {
  /** The third-party password from this node's secret store; never logged or published. */
  password: string | null;
  /** Why the node's secret file could not be used, if it could not (never a secret). */
  secretsError?: string | null;
  port?: number;
  pollMs?: number;
  requestTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** How often an open subscription session is confirmed (default 5 s). */
  livenessMs?: number;
  /** How long without a confirmed session or poll before telemetry is stale (default 15 s). */
  staleAfterMs?: number;
  /** How long to wait before trying a subscription again after a refusal (default 30 s). */
  streamRetryMs?: number;
  /** Called whenever this receiver's published state changes. */
  onChange?: () => void;
};

const CHANNEL_RESOURCES: ReadonlyArray<
  [keyof EwdxChannelReadings, (index: number) => string]
> = [
  ["channel", (index) => `/api/channel/${index}`],
  ["warnings", (index) => `/api/channel/${index}/warnings`],
  ["rssi", (index) => `/api/channel/${index}/signalStrengthIndicator`],
  ["rsqi", (index) => `/api/channel/${index}/signalQualityIndicator`],
  ["level", (index) => `/api/channel/${index}/level`],
  ["rf", (index) => `/api/rf/channels/${index}`],
  ["transmitter", (index) => `/api/transmitters/${index}`],
  ["battery", (index) => `/api/transmitters/${index}/battery`],
  ["transmitterWarnings", (index) => `/api/transmitters/${index}/warnings`],
];

class PollFailure extends Error {
  constructor(
    readonly kind: "transport" | "auth" | "identity" | "reidentify",
    readonly detail: string,
  ) {
    super(kind);
  }
}

function transportDetail(reading: EwdxReading): string {
  if (!("error" in reading))
    return "The receiver returned an unexpected response.";
  switch (reading.error) {
    case "timeout":
      return "The receiver is not answering (request timed out); retained telemetry is stale.";
    case "malformed":
      return "The receiver sent a malformed or oversized response; retained telemetry is stale.";
    default:
      return "The receiver is not answering on HTTPS; retained telemetry is stale.";
  }
}

type ResourceKey = keyof EwdxChannelReadings;
type StreamSession = {
  generation: number;
  transport: EwdxTransport;
  open: EwdxStreamOpen;
  /** Subscribed path -> the channel and reading it feeds. */
  routes: Map<string, { index: number; key: ResourceKey }>;
  /** This generation's latest reading of every subscribed resource. */
  readings: Array<Partial<EwdxChannelReadings>>;
  /** Whether this session has delivered any valid value. */
  delivered: boolean;
};

const NOT_YET: EwdxReading = { error: "aborted" };

function fullReadings(
  partial: Partial<EwdxChannelReadings>,
): EwdxChannelReadings {
  const readings = {} as EwdxChannelReadings;
  for (const [key] of CHANNEL_RESOURCES)
    readings[key] = partial[key] ?? NOT_YET;
  return readings;
}

/**
 * Reads one EW-DX EM 2 Dante. Telemetry arrives over an SSCv2 subscription
 * (SSE) on its own pinned, identity-checked connection; while a subscription
 * cannot be had, a bounded read-only GET sweep every 2 s stands in for it.
 */
export class EwdxReceiverMonitor {
  private current: ReceiverState;
  private readonly abort = new AbortController();
  private transport?: EwdxTransport;
  private timer?: NodeJS.Timeout;
  private closed = false;
  private identified = false;
  private serial: string | null = null;
  private notice = "";
  private backoffMs: number;
  private lastSuccessMs: number | null = null;
  private stream: StreamSession | null = null;
  private generation = 0;
  /** Why the last subscription attempt failed; null while one is live. */
  private fallbackReason: string | null = null;
  private nextStreamAttemptMs = 0;
  private cycling = false;
  private cycleAgain = false;
  /** Sessions in a row that ended before delivering any value. */
  private quickCloses = 0;
  private readonly pollMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly livenessMs: number;
  private readonly staleAfterMs: number;
  private readonly streamRetryMs: number;

  constructor(
    readonly config: EwdxReceiverConfig,
    private readonly options: EwdxMonitorOptions,
  ) {
    this.pollMs = options.pollMs ?? 2_000;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.livenessMs = options.livenessMs ?? 5_000;
    this.staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
    this.streamRetryMs = options.streamRetryMs ?? 30_000;
    this.backoffMs = this.initialBackoffMs;
    this.current = {
      id: config.id,
      vendor: "sennheiser",
      name: config.name,
      host: config.host,
      model: null,
      firmware: null,
      compatibility: "compatible-read-only",
      status: "connecting",
      detail: "Connecting to this Sennheiser receiver over SSCv2.",
      capabilities: EWDX_CAPABILITIES,
      channels: Array.from({ length: config.channelCount }, (_, index) =>
        emptyEwdxChannel(index),
      ),
    };
  }

  private get state(): ReceiverState {
    return this.current;
  }

  private set state(next: ReceiverState) {
    this.current = next;
    this.options.onChange?.();
  }

  start(): void {
    if (this.closed) return;
    const refuse = (detail: string) => {
      this.state = { ...this.state, status: "error", detail };
    };
    if (isIP(this.config.host) === 0)
      return refuse("Receiver host must be an explicit IP address.");
    if (!this.options.password)
      return refuse(
        this.options.secretsError
          ? `No third-party password: ${this.options.secretsError}`.slice(
              0,
              240,
            )
          : "No third-party password is set for this receiver. Set it in Manager.",
      );
    this.transport = this.newTransport();
    this.schedule(0);
  }

  private newTransport(): EwdxTransport {
    return new EwdxTransport(
      this.config.host,
      ewdxPortFor(this.config.host, this.options.port),
      this.options.password!,
      this.options.requestTimeoutMs ?? 3_000,
    );
  }

  getState(): ReceiverState {
    if (
      this.current.status === "ready" &&
      this.lastSuccessMs !== null &&
      Date.now() - this.lastSuccessMs > this.staleAfterMs
    )
      this.markStale(
        `EW-DX telemetry has not been confirmed for ${Math.round(this.staleAfterMs / 1000)} seconds.`,
      );
    return structuredClone(this.current);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    const control = this.transport;
    // End our own session explicitly, then drop every connection.
    void this.endStream(true).finally(() => control?.close());
  }

  private schedule(delayMs: number): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.cycle(), delayMs);
    this.timer.unref();
  }

  private async get(path: string, auth = true): Promise<EwdxReading> {
    if (!this.transport) return { error: "aborted" };
    return this.transport.get(path, { auth, signal: this.abort.signal });
  }

  private markStale(detail: string): void {
    this.state = {
      ...this.current,
      status: this.current.channels.some(({ observedAtUtc }) => observedAtUtc)
        ? "stale"
        : "connecting",
      detail,
      channels: this.current.channels.map((channel) => ({
        ...channel,
        availability: channel.observedAtUtc === null ? "unavailable" : "stale",
      })),
    };
  }

  private async cycle(): Promise<void> {
    // One cycle at a time: a stream event can schedule another while this one
    // is still waiting on the receiver; that one runs after this finishes.
    if (this.cycling) {
      this.cycleAgain = true;
      return;
    }
    this.cycling = true;
    try {
      if (!this.identified) await this.identify();
      if (this.stream) {
        await this.confirmStream();
        if (this.closed) return;
        // A session found gone has already scheduled its own reopen.
        if (this.stream) {
          if (this.stream.delivered) this.backoffMs = this.initialBackoffMs;
          this.schedule(this.livenessMs);
        }
        return;
      }
      if (Date.now() >= this.nextStreamAttemptMs && (await this.openStream())) {
        if (this.closed) return;
        // Back-off is reset only once a session delivers values; a stream
        // that already ended has scheduled its own reconnect.
        if (this.stream) this.schedule(this.livenessMs);
        return;
      }
      await this.poll();
      if (this.closed) return;
      this.backoffMs = this.initialBackoffMs;
      this.schedule(this.pollMs);
    } catch (error) {
      if (this.closed) return;
      const failure =
        error instanceof PollFailure
          ? error
          : new PollFailure("transport", "The receiver could not be read.");
      await this.endStream(false);
      this.identified = false;
      if (failure.kind === "reidentify") {
        // A new connection answered as a different receiver: discard what
        // this attempt read and identify it before anything is published.
        this.markStale(failure.detail);
        this.schedule(0);
        return;
      }
      if (failure.kind === "transport") this.markStale(failure.detail);
      else
        this.state = {
          ...this.current,
          status: "error",
          detail: failure.detail,
        };
      // Credential and identity failures will not fix themselves quickly;
      // retry at the ceiling so a wrong password cannot hammer the receiver.
      const delay =
        failure.kind === "transport" ? this.backoffMs : this.maxBackoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
      this.schedule(delay);
    } finally {
      this.cycling = false;
      if (this.cycleAgain && !this.closed) {
        this.cycleAgain = false;
        this.schedule(0);
      }
    }
  }

  private async required(path: string, auth: boolean): Promise<EwdxReading> {
    const reading = await this.get(path, auth);
    if ("error" in reading) {
      throw new PollFailure("transport", transportDetail(reading));
    }
    return reading;
  }

  private async identify(): Promise<void> {
    if (this.transport) this.transport.expected = null;
    const version = await this.required("/api/ssc/version", false);
    const identity = await this.required("/api/device/identity", false);
    // The password goes only to a device that already passed the
    // unauthenticated checks: never to an EM 4 Dante, an analogue EM 2, an
    // SSCv1 receiver or another vendor, even behind the pinned certificate.
    const refused = checkEwdxDevice({ version, identity });
    if (refused) throw new PollFailure("identity", refused);
    // Fence the rest of identification to this device: a connection opened
    // from here on must report the same product and serial before the
    // password is sent on it.
    const device = okBody(identity);
    if (this.transport && device)
      this.transport.expected = {
        product: String(device.product),
        serial: typeof device.serial === "string" ? device.serial : null,
      };
    const firmware = await this.required("/api/firmware/update/state", true);
    const result = checkEwdxIdentity({ version, identity, firmware });
    if (!result.ok) {
      const auth =
        "status" in firmware &&
        (firmware.status === 401 || firmware.status === 403);
      throw new PollFailure(auth ? "auth" : "identity", result.detail);
    }
    if (this.serial !== null && result.serial !== this.serial) {
      this.notice = ` A different receiver (serial ${result.serial ?? "unknown"}) replaced serial ${this.serial} at this address; earlier telemetry was discarded.`;
      this.state = {
        ...this.current,
        channels: this.current.channels.map(({ index }) =>
          emptyEwdxChannel(index),
        ),
      };
    }
    this.serial = result.serial;
    this.identified = true;
    if (this.transport)
      this.transport.expected = {
        product: result.product,
        serial: result.serial,
      };
    this.state = {
      ...this.current,
      model: result.product,
      firmware: result.firmware,
    };
  }

  // ---- Subscription stream ------------------------------------------------

  private subscriptionDetail(): string {
    return `Read-only SSCv2 subscription is live.${this.notice}`.slice(0, 240);
  }

  private fallBack(reason: string): false {
    this.fallbackReason = reason;
    this.nextStreamAttemptMs = Date.now() + this.streamRetryMs;
    return false;
  }

  /** Opens and subscribes one SSCv2 session; false means use the bounded poll. */
  private async openStream(): Promise<boolean> {
    const expected = this.transport?.expected ?? null;
    if (!expected) return this.fallBack("the receiver is not identified");
    const transport = this.newTransport();
    transport.expected = expected;
    const opened = await transport.openStream(this.abort.signal);
    if (!("response" in opened)) {
      transport.close();
      if ("error" in opened) {
        if (opened.error === "identity-changed")
          throw new PollFailure(
            "reidentify",
            "A reconnect reached a different receiver identity; rechecking it before trusting its telemetry.",
          );
        if (opened.error === "malformed")
          return this.fallBack(
            "the receiver's subscription answer was not a valid SSCv2 stream",
          );
        if (opened.error !== "aborted")
          throw new PollFailure("transport", transportDetail(opened));
        return false;
      }
      if (opened.status === 401 || opened.status === 403)
        return this.fallBack("the receiver refused a subscription session");
      return this.fallBack(
        `the receiver did not grant a subscription session (HTTP ${opened.status})`,
      );
    }
    const generation = ++this.generation;
    const session: StreamSession = {
      generation,
      transport,
      open: opened,
      routes: new Map(),
      readings: this.current.channels.map(() => ({})),
      delivered: false,
    };
    for (let index = 0; index < this.config.channelCount; index += 1)
      for (const [key, path] of CHANNEL_RESOURCES)
        session.routes.set(path(index), { index, key });
    const parser = new SseParser();
    let opening: ((ok: boolean) => void) | null = null;
    const opened$ = new Promise<boolean>((resolve) => (opening = resolve));
    const openTimer = setTimeout(
      () => opening?.(false),
      this.options.requestTimeoutMs ?? 3_000,
    );
    const end = () => {
      opening?.(false);
      if (this.stream?.generation === generation) this.streamEnded();
    };
    opened.response.on("data", (chunk: Buffer) => {
      if (this.stream && this.stream.generation !== generation && !opening)
        return;
      let events;
      try {
        events = parser.push(chunk);
      } catch {
        opened.request.destroy();
        return end();
      }
      for (const event of events) {
        if (opening) {
          // The first event must be `open`, naming exactly this session.
          const data = parseJson(event.data);
          const ok =
            event.event === "open" &&
            isRecord(data) &&
            data.sessionUUID === opened.sessionUuid &&
            data.path === `${SUBSCRIPTIONS_PATH}/${opened.sessionUuid}`;
          const resolve = opening;
          opening = null;
          resolve(ok);
          if (!ok) return;
          continue;
        }
        if (event.event === "close") return end();
        if (event.event === "message")
          this.applyNotification(session, event.data);
      }
    });
    opened.response.on("end", end);
    opened.response.on("error", end);
    opened.request.on("error", end);

    const ok = await opened$;
    clearTimeout(openTimer);
    if (!ok || this.closed) {
      opened.request.destroy();
      transport.close();
      return this.fallBack(
        "the receiver's subscription stream did not open as SSCv2 specifies",
      );
    }
    // Never hold two sessions: end any earlier one before keeping this one.
    if (this.stream) await this.endStream(true);
    this.stream = session;
    const paths = [...session.routes.keys()];
    const put = await this.control(
      `${SUBSCRIPTIONS_PATH}/${opened.sessionUuid}`,
      "PUT",
      paths,
    );
    if (this.stream?.generation !== generation) {
      // The stream ended while the list was being set; its own reconnect is
      // already scheduled. Nothing is claimed live.
      return true;
    }
    if (!("status" in put) || put.status !== 200) {
      await this.endStream(true);
      if (
        "status" in put &&
        (put.status === 400 || put.status === 403 || put.status === 404)
      ) {
        const refused =
          isRecord(put.body) &&
          typeof put.body.path === "string" &&
          session.routes.has(put.body.path)
            ? ` ${put.body.path}`
            : "";
        return this.fallBack(
          `the receiver refused to subscribe a resource${refused}`,
        );
      }
      if ("error" in put)
        throw new PollFailure("transport", transportDetail(put));
      return this.fallBack(
        `the receiver refused the subscription list (HTTP ${put.status})`,
      );
    }
    this.fallbackReason = null;
    this.lastSuccessMs = Date.now();
    this.state = {
      ...this.current,
      status: this.current.channels.some(
        ({ availability }) => availability === "observed",
      )
        ? "ready"
        : this.current.status,
      detail: this.subscriptionDetail(),
    };
    return true;
  }

  private async control(
    path: string,
    method: "GET" | "PUT" | "DELETE",
    body?: unknown,
    signal: AbortSignal = this.abort.signal,
  ): Promise<EwdxReading> {
    if (!this.transport) return { error: "aborted" };
    return this.transport.get(path, { auth: true, signal, method, body });
  }

  /** Applies one URI-keyed SSCv2 notification to this generation's readings. */
  private applyNotification(session: StreamSession, data: string): void {
    if (this.closed || this.stream?.generation !== session.generation) return;
    const parsed = parseJson(data);
    if (!isRecord(parsed)) return;
    const delivered = new Map<number, Partial<EwdxChannelReadings>>();
    for (const [path, value] of Object.entries(parsed)) {
      const route = session.routes.get(path);
      if (!route) continue;
      // A notification equals a GET of that resource (SSCv2 2.3).
      const reading: EwdxReading = { status: 200, body: value };
      session.readings[route.index]![route.key] = reading;
      const fresh = delivered.get(route.index) ?? {};
      fresh[route.key] = reading;
      delivered.set(route.index, fresh);
    }
    if (!delivered.size) return;
    const nowUtc = new Date().toISOString();
    const channels = [...this.current.channels];
    let observed = false;
    for (const [index, fresh] of delivered) {
      const previous = channels[index] ?? emptyEwdxChannel(index);
      const next = normalizeEwdxChannel(
        previous,
        fullReadings(session.readings[index]!),
        nowUtc,
      );
      // Only a notification that itself carries a valid value is a new
      // observation. Invalid values still clear their field, but they never
      // re-date the channel from cached readings.
      const carriesValue =
        normalizeEwdxChannel(
          emptyEwdxChannel(index),
          fullReadings(fresh),
          nowUtc,
        ).availability === "observed";
      if (carriesValue) observed = true;
      channels[index] = carriesValue
        ? next
        : {
            ...next,
            observedAtUtc: previous.observedAtUtc,
            availability: previous.availability,
          };
    }
    if (observed) {
      this.lastSuccessMs = Date.now();
      if (!session.delivered) {
        session.delivered = true;
        this.quickCloses = 0;
        this.backoffMs = this.initialBackoffMs;
      }
    }
    this.state = {
      ...this.current,
      status: channels.some(({ availability }) => availability === "observed")
        ? "ready"
        : this.current.status,
      detail: this.subscriptionDetail(),
      channels,
    };
  }

  /** Confirms the session still exists: transport liveness, not fresh values. */
  private async confirmStream(): Promise<void> {
    const session = this.stream!;
    const status = await this.control(
      `${SUBSCRIPTIONS_PATH}/${session.open.sessionUuid}`,
      "GET",
    );
    if (this.stream?.generation !== session.generation) return;
    if ("error" in status) {
      if (status.error === "identity-changed")
        throw new PollFailure(
          "reidentify",
          "A reconnect reached a different receiver identity; rechecking it before trusting its telemetry.",
        );
      throw new PollFailure("transport", transportDetail(status));
    }
    if (status.status === 401 || status.status === 403)
      throw new PollFailure(
        "auth",
        authFailure(status) ?? "The receiver refused the request.",
      );
    if (status.status !== 200) {
      // The session is gone (e.g. 422): its values are stale from now on and
      // a new session is opened, as when the stream itself ends.
      this.streamEnded();
      return;
    }
    this.lastSuccessMs = Date.now();
    // Liveness keeps a live session current; it never makes retained values
    // from an earlier session current again. Only this session's own
    // notifications do that.
    if (this.current.status !== "ready" && this.anyObservedNow())
      this.state = {
        ...this.current,
        status: "ready",
        detail: this.subscriptionDetail(),
      };
  }

  private anyObservedNow(): boolean {
    return this.current.channels.some(
      ({ availability }) => availability === "observed",
    );
  }

  /** The stream ended under us: values become stale until a new session is up. */
  private streamEnded(): void {
    const session = this.stream;
    this.stream = null;
    if (session) {
      session.open.request.destroy();
      session.transport.close();
    }
    if (this.closed) return;
    if (session && !session.delivered) {
      this.quickCloses += 1;
      // A receiver that accepts and then drops every session gets the
      // bounded poll for a while instead of a reconnect storm.
      if (this.quickCloses >= 3) {
        this.quickCloses = 0;
        this.fallBack("the receiver keeps closing new subscription sessions");
      }
    }
    this.markStale(
      "The SSCv2 subscription stream ended; reconnecting. Retained telemetry is stale.",
    );
    this.schedule(Math.min(this.backoffMs, this.maxBackoffMs));
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }

  /** Ends our session (DELETE when asked, bounded) and drops its connection. */
  private async endStream(deleteSession: boolean): Promise<void> {
    const session = this.stream;
    if (!session) return;
    this.stream = null;
    if (deleteSession && this.transport)
      await this.transport.get(
        `${SUBSCRIPTIONS_PATH}/${session.open.sessionUuid}`,
        {
          auth: true,
          method: "DELETE",
          signal: AbortSignal.timeout(1_000),
        },
      );
    session.open.request.destroy();
    session.transport.close();
  }

  // ---- Bounded fallback ---------------------------------------------------

  private async poll(): Promise<void> {
    const channels = [...this.current.channels];
    for (let index = 0; index < this.config.channelCount; index += 1) {
      const readings = {} as EwdxChannelReadings;
      for (const [key, path] of CHANNEL_RESOURCES) {
        const reading = await this.get(path(index));
        if ("error" in reading && reading.error === "identity-changed")
          throw new PollFailure(
            "reidentify",
            "A reconnect reached a different receiver identity; rechecking it before trusting its telemetry.",
          );
        if ("error" in reading) {
          throw new PollFailure("transport", transportDetail(reading));
        }
        if (reading.status === 401 || reading.status === 403) {
          throw new PollFailure(
            "auth",
            authFailure(reading) ?? "The receiver refused the request.",
          );
        }
        readings[key] = reading;
      }
      channels[index] = normalizeEwdxChannel(
        channels[index] ?? emptyEwdxChannel(index),
        readings,
        new Date().toISOString(),
      );
    }
    if (this.closed) return;
    if (!channels.some(({ availability }) => availability === "observed"))
      throw new PollFailure(
        "transport",
        "The receiver answered but reported no usable telemetry; retained telemetry is stale.",
      );
    this.lastSuccessMs = Date.now();
    this.state = {
      ...this.current,
      status: "ready",
      detail: (this.fallbackReason
        ? `Read-only SSCv2 telemetry is current by polling, ${Math.round(this.pollMs / 1000)} s between sweeps (degraded: ${this.fallbackReason}).${this.notice}`
        : `Read-only SSCv2 telemetry is current.${this.notice}`
      ).slice(0, 240),
      channels,
    };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---- Fleet -----------------------------------------------------------------

export type SennheiserFleetOptions = Omit<
  EwdxMonitorOptions,
  "password" | "secretsError"
> & {
  /** Looks up a receiver's third-party password in this node's secret store. */
  password: (receiverId: string) => string | null;
  /** Why the secret store could not be read, if it could not. */
  secretsError?: () => string | null;
};

/** Keeps one monitor per configured EW-DX receiver, as the Shure fleet does. */
export class SennheiserFleetMonitor {
  private readonly monitors = new Map<string, EwdxReceiverMonitor>();
  /** The secret each monitor was started with, so a changed secret restarts it. */
  private readonly secrets = new Map<string, string | null>();
  private readonly storeErrors = new Map<string, string | null>();
  private readonly listeners = new Set<(receiverId: string) => void>();
  private closed = false;

  constructor(private readonly options: SennheiserFleetOptions) {}

  /** Calls back with a receiver's id whenever its normalized state changes. */
  addChangeListener(listener: (receiverId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One receiver's normalized state, or undefined when it is not configured. */
  getState(id: string): ReceiverState | undefined {
    return this.monitors.get(id)?.getState();
  }

  reconcile(configs: readonly EwdxReceiverConfig[]): void {
    if (this.closed) return;
    const desired = new Set(configs.map(({ id }) => id));
    for (const [id, monitor] of this.monitors) {
      if (!desired.has(id)) {
        monitor.close();
        this.monitors.delete(id);
        this.secrets.delete(id);
        this.storeErrors.delete(id);
      }
    }
    const { password, secretsError, ...rest } = this.options;
    const storeError = secretsError?.() ?? null;
    for (const config of configs) {
      const current = this.monitors.get(config.id);
      const secret = password(config.id);
      if (
        current &&
        JSON.stringify(current.config) === JSON.stringify(config) &&
        this.secrets.get(config.id) === secret &&
        this.storeErrors.get(config.id) === storeError
      )
        continue;
      current?.close();
      const monitor = new EwdxReceiverMonitor(config, {
        ...rest,
        password: secret,
        secretsError: storeError,
        onChange: () => {
          rest.onChange?.();
          for (const listener of this.listeners) listener(config.id);
        },
      });
      this.monitors.set(config.id, monitor);
      this.secrets.set(config.id, secret);
      this.storeErrors.set(config.id, storeError);
      monitor.start();
    }
  }

  getStates(): ReceiverState[] {
    return [...this.monitors.values()].map((monitor) => monitor.getState());
  }

  close(): void {
    this.closed = true;
    for (const monitor of this.monitors.values()) monitor.close();
    this.monitors.clear();
    this.secrets.clear();
    this.storeErrors.clear();
  }
}

/**
 * Publishes EW-DX receivers in the same normalized fleet telemetry as Shure.
 * With no EW-DX receiver configured the Shure document is returned as is.
 */
export function mergeFleetTelemetry(
  shure: ShureTelemetry,
  sennheiser: readonly ReceiverState[],
): ShureTelemetry {
  if (sennheiser.length === 0) return shure;
  const receivers = [...shure.receivers, ...sennheiser].slice(0, 64);
  const statuses = receivers.map(({ status }) => status);
  const allReady = statuses.every((status) => status === "ready");
  const allSame = statuses.every((status) => status === statuses[0]);
  return {
    schemaVersion: "0",
    status: allReady ? "ready" : allSame ? statuses[0]! : "degraded",
    detail: allReady
      ? "All configured receivers are reporting."
      : "One or more configured receivers are not current.",
    receivers,
  };
}
