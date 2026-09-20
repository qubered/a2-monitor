import {
  createHttpContractClient,
  parseLiveSnapshot as parseProtocolLiveSnapshot,
  ProtocolContractError,
  ProtocolHttpError,
  type LiveSnapshot,
} from "@a2-monitor/protocol/http";

export interface SnapshotSource {
  load(signal: AbortSignal): Promise<LiveSnapshot>;
}

export class SnapshotOfflineError extends Error {
  constructor() {
    super("The backend could not be reached.");
    this.name = "SnapshotOfflineError";
  }
}

export class SnapshotContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotContractError";
  }
}

export function parseLiveSnapshot(value: unknown): LiveSnapshot {
  try {
    return parseProtocolLiveSnapshot(value);
  } catch (error) {
    if (!(error instanceof ProtocolContractError)) throw error;
    throw new SnapshotContractError(
      "The backend returned a snapshot that does not match schema version 0.",
    );
  }
}

export function createHttpSnapshotSource(
  fetchSnapshot: typeof fetch = fetch,
): SnapshotSource {
  const client = createHttpContractClient(fetchSnapshot);
  return {
    async load(signal) {
      try {
        return await client.getLiveSnapshot(signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (error instanceof ProtocolContractError) {
          throw new SnapshotContractError(
            "The backend returned a snapshot that does not match schema version 0.",
          );
        }
        if (error instanceof ProtocolHttpError) {
          throw new Error(
            `Snapshot request failed with HTTP ${error.status}.`,
            {
              cause: error,
            },
          );
        }
        throw new SnapshotOfflineError();
      }
    },
  };
}

export function createStaticSnapshotSource(
  snapshot: LiveSnapshot,
): SnapshotSource {
  return {
    async load() {
      return snapshot;
    },
  };
}

export const httpSnapshotSource = createHttpSnapshotSource();
