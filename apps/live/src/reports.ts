import {
  parseLiveState,
  type FaultReport,
  type LiveState,
  type ReportedFault,
} from "@rvlt/pulse-protocol/http";

/** The A1's words for what they hear (design system §11.2), in sheet order. */
export const FAULT_LABELS: ReadonlyArray<[ReportedFault, string]> = [
  ["dropping-out", "Dropping out"],
  ["crackling", "Crackling"],
  ["distorted", "Distorted"],
  ["too-quiet", "Too quiet"],
  ["clothing-noise", "Clothing noise"],
  ["popping", "Popping"],
  ["hum-buzz", "Hum or buzz"],
  ["nothing-at-all", "Nothing at all"],
  ["other", "Something else"],
];

const LABEL_BY_FAULT = new Map(FAULT_LABELS);

export function faultSummary(report: FaultReport): string {
  const words = report.faults.map(
    (fault) => LABEL_BY_FAULT.get(fault)?.toLowerCase() ?? fault,
  );
  const listed =
    words.length > 1
      ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
      : (words[0] ?? "");
  const sentence = `${listed.charAt(0).toUpperCase()}${listed.slice(1)}`;
  return report.note ? `${sentence}. “${report.note}”` : sentence;
}

export type ReportAction =
  | "undo"
  | "urgent"
  | "claim"
  | "resolve"
  | "confirm-fixed"
  | "reopen"
  | "dismiss";

export function isActiveReport(report: FaultReport): boolean {
  return (
    report.status === "open" ||
    report.status === "claimed" ||
    report.status === "awaiting-confirmation"
  );
}

/** One plain status line in the order an A1 would ask "did anyone pick that up?". */
export function reportStatusLine(report: FaultReport): string {
  switch (report.status) {
    case "open":
      return "Not claimed yet";
    case "claimed":
      return `Being worked by ${report.claimedBy ?? "an A2"}`;
    case "awaiting-confirmation":
      return `Fixed by ${report.resolvedBy ?? "an A2"}, waiting for the A1 to confirm`;
    case "closed":
      return report.resolvedBy ? `Closed by ${report.resolvedBy}` : "Closed";
    case "cancelled":
      return "Taken back";
  }
}

async function expectState(response: Response): Promise<LiveState> {
  if (response.status === 409) {
    throw new Error("That report has already moved on.");
  }
  if (response.status === 404) {
    throw new Error("That report or channel no longer exists.");
  }
  if (!response.ok) {
    throw new Error(`The report was not recorded (HTTP ${response.status}).`);
  }
  return parseLiveState(await response.json());
}

export async function fileReport(
  channelId: string,
  faults: readonly ReportedFault[],
  note: string | null,
  requestedBy: string,
  fetchResponse: typeof fetch = fetch,
): Promise<LiveState> {
  return expectState(
    await fetchResponse("/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, faults, note, requestedBy }),
    }),
  );
}

export async function actOnReport(
  reportId: string,
  action: ReportAction,
  by: string,
  fetchResponse: typeof fetch = fetch,
): Promise<LiveState> {
  return expectState(
    await fetchResponse(
      `/api/v1/reports/${encodeURIComponent(reportId)}/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, by }),
      },
    ),
  );
}
