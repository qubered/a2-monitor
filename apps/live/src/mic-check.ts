import {
  parseMicChecks,
  type MicCheckDimensionId,
  type MicChecks,
} from "@rvlt/pulse-protocol/http";

export type MicCheckVerdict = "pass" | "fail" | "waiting";

export type MicCheckRecord = {
  verdict: MicCheckVerdict;
  by: string;
  atUtc: string;
};

export type MicCheckProgress = Record<string, MicCheckRecord>;

export const micCheckDimensions = [
  {
    id: "physical-identity",
    label: "Physical identity and label",
    prompt: "Confirm the performer, microphone, pack and physical label agree.",
    owner: "A2",
  },
  {
    id: "rf-link",
    label: "RF and link in the zone",
    prompt: "Walk the working zone and confirm RF level and link quality.",
    owner: "A2",
  },
  {
    id: "captured-audio",
    label: "Captured audio heard",
    prompt:
      "The A1 confirms the expected source reaches the console through PFL.",
    owner: "A1",
  },
  {
    id: "mute-control",
    label: "Transmitter mute and control",
    prompt: "Confirm mute state and the available transmitter controls.",
    owner: "A2",
  },
  {
    id: "primary-spare",
    label: "Primary and spare pack",
    prompt:
      "Confirm the primary pack and its prepared spare are correctly assigned.",
    owner: "A2",
  },
  {
    id: "battery-window",
    label: "Battery for the show window",
    prompt:
      "Confirm the battery is approved for the remaining performance window.",
    owner: "A2",
  },
  {
    id: "placement-costume",
    label: "Placement and costume note",
    prompt: "Confirm placement and acknowledge the current costume note.",
    owner: "A2",
  },
  {
    id: "operator-signoff",
    label: "Operator sign-off",
    prompt:
      "Confirm the check is attached to the correct performer and source.",
    owner: "A2",
  },
] as const;

/** Loads every shared check; the backend marks a check stale when its subject changed. */
export async function loadChecks(
  fetchResponse: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MicChecks> {
  const response = await fetchResponse("/api/v1/checks", { signal });
  if (!response.ok) {
    throw new Error(`Checks could not be loaded (HTTP ${response.status}).`);
  }
  return parseMicChecks(await response.json());
}

/** Records one verdict for every Pulse device and returns the updated checks. */
export async function recordCheck(
  channelId: string,
  dimensionId: MicCheckDimensionId,
  verdict: MicCheckVerdict,
  by: string,
  reason: string | null = null,
  fetchResponse: typeof fetch = fetch,
): Promise<MicChecks> {
  const response = await fetchResponse(
    `/api/v1/checks/${encodeURIComponent(channelId)}/dimensions/${dimensionId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, by, reason }),
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "This channel is no longer in the show."
        : `The verdict was not recorded (HTTP ${response.status}).`,
    );
  }
  return parseMicChecks(await response.json());
}

/** One channel's shared progress, keyed by dimension. */
export function progressFor(
  checks: MicChecks,
  channelId: string,
): { progress: MicCheckProgress; stale: boolean } {
  const check = checks.checks.find((item) => item.channelId === channelId);
  if (!check) return { progress: {}, stale: false };
  return {
    stale: check.stale,
    progress: check.stale
      ? {}
      : Object.fromEntries(
          check.dimensions.map(({ id, verdict, by, atUtc }) => [
            id,
            { verdict, by, atUtc },
          ]),
        ),
  };
}
