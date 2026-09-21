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

function storageKey(showName: string, channelId: string) {
  return `pulse-mic-check:${showName}:${channelId}`;
}

export function loadMicCheck(
  showName: string,
  channelId: string,
): MicCheckProgress {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(storageKey(showName, channelId)) ?? "{}",
    ) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(([, record]) => {
        if (record === null || typeof record !== "object") return false;
        const candidate = record as Partial<MicCheckRecord>;
        return (
          (candidate.verdict === "pass" ||
            candidate.verdict === "fail" ||
            candidate.verdict === "waiting") &&
          typeof candidate.by === "string" &&
          typeof candidate.atUtc === "string"
        );
      }),
    );
  } catch {
    return {};
  }
}

export function saveMicCheck(
  showName: string,
  channelId: string,
  progress: MicCheckProgress,
) {
  window.localStorage.setItem(
    storageKey(showName, channelId),
    JSON.stringify(progress),
  );
}
