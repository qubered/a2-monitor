// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  FaultReport,
  HostOutput,
  LiveAlert,
  LiveState,
  LiveStateChannel,
} from "@rvlt/pulse-protocol/http";
import { App } from "./App";
import type { AudioDeviceSource } from "./audio-device";
import type { PlaybackFactory } from "./audio-playback";
import { createManualHostOutput } from "./host-output";
import { createManualLiveState } from "./live-state";
import { MeterStore } from "./meters";

function channel(overrides: Partial<LiveStateChannel> = {}): LiveStateChannel {
  return {
    id: "ch-marguerite",
    number: 1,
    name: "Marguerite",
    performer: "Eleanor Vance",
    kind: "wireless",
    micType: "headset",
    hasImage: false,
    input: { index: 0, label: "USB Interface · input 1" },
    receiver: {
      id: "rack-a",
      name: "Stage left",
      model: "AD4Q",
      channelIndex: 0,
      status: "ready",
      frequencyRaw: "0578125",
      groupChannelRaw: "1,4",
    },
    monitor: { battery: true, rf: true, audio: true },
    statuses: { rf: "good", audio: "good", battery: "good", check: "unknown" },
    audio: {
      availability: "observed",
      peakDbfs: -12,
      rmsDbfs: -30,
      silentForMs: 0,
      clipping: false,
    },
    rf: {
      availability: "observed",
      levelDbm: -58,
      linkQualityPercent: 100,
      activeAntenna: "A",
      interference: "none",
      transmitterPresent: true,
    },
    battery: {
      availability: "observed",
      percent: 90,
      bars: 5,
      runtimeMinutes: 270,
      type: "LION",
    },
    transmitter: {
      type: "AD2",
      name: "MARGUERITE",
      muted: false,
      observedAtUtc: "2026-09-23T01:00:00Z",
    },
    check: null,
    ...overrides,
  };
}

const talkback = channel({
  id: "ch-talkback",
  number: 2,
  name: "Talkback",
  performer: null,
  kind: "wired",
  micType: null,
  input: { index: 1, label: "USB Interface · input 2" },
  receiver: null,
  statuses: {
    rf: "not-applicable",
    audio: "good",
    battery: "not-applicable",
    check: "unknown",
  },
  rf: {
    availability: "unknown",
    levelDbm: null,
    linkQualityPercent: null,
    activeAntenna: null,
    interference: "unavailable",
    transmitterPresent: null,
  },
  battery: {
    availability: "unknown",
    percent: null,
    bars: null,
    runtimeMinutes: null,
    type: null,
  },
  transmitter: { type: null, name: null, muted: null, observedAtUtc: null },
});

const unpatched = channel({
  id: "ch-spare",
  number: 3,
  name: "Spare",
  performer: null,
  kind: "wired",
  input: { index: null, label: "Audio input not patched" },
  receiver: null,
  statuses: {
    rf: "not-applicable",
    audio: "unknown",
    battery: "not-applicable",
    check: "unknown",
  },
});

function alert(overrides: Partial<LiveAlert> = {}): LiveAlert {
  return {
    id: "alert-000001",
    kind: "battery-critical",
    dimension: "Battery",
    severity: "critical",
    label: "Battery critical",
    detail: "Battery 8 % on Stage left channel 1. Critical at 10 %.",
    channelId: "ch-marguerite",
    channelNumber: 1,
    channelName: "Marguerite",
    receiverId: "rack-a",
    raisedAtUtc: new Date(Date.now() - 60_000).toISOString(),
    acknowledgedAtUtc: null,
    acknowledgedBy: null,
    clearedAtUtc: null,
    overlayExpiresAtUtc: null,
    ...overrides,
  };
}

function report(overrides: Partial<FaultReport> = {}): FaultReport {
  return {
    id: "report-000001",
    channelId: "ch-marguerite",
    channelNumber: 1,
    channelName: "Marguerite",
    performer: "Eleanor Vance",
    faults: ["crackling", "clothing-noise"],
    note: null,
    urgent: false,
    incident: false,
    incidentReason: null,
    status: "open",
    requestedBy: "Morgan (A1)",
    requestedAtUtc: new Date().toISOString(),
    undoUntilUtc: new Date(Date.now() + 10_000).toISOString(),
    claimedBy: null,
    claimedAtUtc: null,
    resolvedBy: null,
    resolvedAtUtc: null,
    closedAtUtc: null,
    ...overrides,
  };
}

function stateWith(overrides: Partial<LiveState> = {}): LiveState {
  const alerts = overrides.alerts ?? [];
  const outstanding = alerts.filter(
    ({ acknowledgedAtUtc }) => acknowledgedAtUtc === null,
  );
  return {
    schemaVersion: "0",
    revision: 10,
    generatedAtUtc: new Date().toISOString(),
    show: {
      name: "The Winter Circus",
      showfileRevision: 3,
      overlayExpiryMs: 300_000,
    },
    node: {
      status: "ready",
      detail: "Capture is ready.",
      device: {
        name: "USB Interface",
        sampleRateHz: 48_000,
        channelCount: 2,
        simulated: false,
      },
      observedAtUtc: new Date().toISOString(),
    },
    receivers: {
      status: "ready",
      detail: "All configured Shure receivers are reporting.",
      units: [
        {
          id: "rack-a",
          name: "Stage left",
          model: "AD4Q",
          status: "ready",
          detail: "Read-only Shure telemetry is current.",
        },
      ],
    },
    channels: [channel(), talkback, unpatched],
    alerts,
    reports: [],
    summary: {
      active: alerts.length,
      outstanding: outstanding.length,
      outstandingCritical: outstanding.filter(
        ({ severity }) => severity === "critical",
      ).length,
    },
    ...overrides,
  };
}

const readyDevice: AudioDeviceSource = {
  load: async () => ({
    schemaVersion: 0,
    status: "ready",
    detail: "Capture active.",
    device: { name: "USB Interface", sampleRateHz: 48000, channelCount: 2 },
    channels: [
      { index: 0, label: "Channel 1" },
      { index: 1, label: "Channel 2" },
    ],
  }),
};

const noDevice: AudioDeviceSource = {
  load: () => new Promise(() => undefined),
};

function liveMeters(): MeterStore {
  const store = new MeterStore(null);
  store.connection = "live";
  return store;
}

type HostFeed = HostOutput["feeds"][number];

function hostFeed(
  id: string,
  name: string,
  outputChannels: number[],
  monitor: Partial<HostFeed["monitor"]> = {},
): HostFeed {
  return {
    id,
    name,
    outputChannels,
    revision: 0,
    monitor: {
      channelId: null,
      input: null,
      muted: false,
      dimmed: false,
      gainDb: 0,
      changedBy: null,
      changedAtUtc: null,
      ...monitor,
    },
  };
}

function hostDocument(
  output: HostOutput["output"] = null,
  feeds: HostFeed[] = output
    ? [hostFeed("feed-a", "Comms A", [1]), hostFeed("feed-b", "Comms B", [2])]
    : [],
): HostOutput {
  return { schemaVersion: "0", output, feeds };
}

const dvsOutput: NonNullable<HostOutput["output"]> = {
  status: "ready",
  detail: "Dante Virtual Soundcard is open: 2 feeds on 2 of 64 outputs.",
  deviceName: "Dante Virtual Soundcard",
  channelCount: 64,
  simulated: false,
  underruns: 0,
  droppedFrames: 0,
};

function renderApp(
  state: LiveState | null,
  options: {
    audioDeviceSource?: AudioDeviceSource;
    playbackFactory?: PlaybackFactory;
    fetchAlertLog?: typeof fetch;
    /** The node's host output document; by default it has no host output. */
    hostOutput?: HostOutput;
  } = {},
) {
  const source = createManualLiveState();
  if (state) source.push(state);
  const hostOutput = createManualHostOutput();
  hostOutput.push(options.hostOutput ?? hostDocument());
  const view = render(
    <App
      liveStateSource={source}
      audioDeviceSource={options.audioDeviceSource ?? noDevice}
      playbackFactory={options.playbackFactory}
      hostOutputSource={hostOutput}
      meterStore={liveMeters()}
      fetchAlertLog={options.fetchAlertLog}
    />,
  );
  return { source, hostOutput, view };
}

beforeAll(() => {
  // jsdom has no canvas; traces draw nothing rather than logging an error.
  HTMLCanvasElement.prototype.getContext = () => null;
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Live channel grid", () => {
  it("shows RF, Audio and Battery on the card, with no Check cell", async () => {
    renderApp(
      stateWith({
        channels: [
          channel({
            statuses: {
              rf: "good",
              audio: "good",
              battery: "good",
              check: "fault",
            },
          }),
        ],
      }),
    );
    const card = (
      await screen.findByText("Marguerite", { selector: "h2" })
    ).closest("article")!;
    const strip = within(card).getByRole("group", {
      name: "Status by dimension",
    });
    expect(strip.querySelectorAll(".status-cell")).toHaveLength(3);
    expect(within(strip).queryByText(/Mic check/)).toBeNull();
    // A failed check alone is not a card-level problem.
    expect(
      screen.getByRole("button", { name: /Needs someone/ }).textContent,
    ).toContain("0");
  });

  it("starts unmuted and selecting a channel keeps the output state", async () => {
    const user = userEvent.setup();
    renderApp(stateWith());

    expect(await screen.findByText("Monitor output is unmuted")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Select Talkback, channel 2" }),
    );

    const card = screen
      .getByRole("button", { name: "Select Talkback, channel 2" })
      .closest("article")!;
    expect(card.classList.contains("is-selected")).toBe(true);
    expect(card.classList.contains("is-listening")).toBe(false);
    expect(
      screen.getByText("Talkback", { selector: ".player-source strong" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mute" }).getAttribute("aria-pressed"),
    ).toBe("false");
    // Without a host output there is nothing to choose.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks a card with the backend alert and acknowledges it as the named operator", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pulse-operator-name", "Sam");
    const raised = stateWith({ alerts: [alert()] });
    const acknowledged = stateWith({
      revision: 11,
      alerts: [
        alert({
          acknowledgedAtUtc: new Date().toISOString(),
          acknowledgedBy: "Sam (A2)",
        }),
      ],
    });
    const post = vi.fn(
      async () =>
        new Response(JSON.stringify(acknowledged), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", post);
    renderApp(raised);

    expect(
      screen.getByRole("button", { name: "1 to acknowledge · 1 critical" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Battery critical on Marguerite, channel 1. Press to acknowledge.",
      }),
    );

    expect(post).toHaveBeenCalledWith(
      "/api/v1/alerts/alert-000001/acknowledge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operator: "Sam (A2)" }),
      }),
    );
    expect(
      await screen.findByRole("button", { name: "1 active · all seen" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Press to acknowledge/ }),
    ).toBeNull();
    // Acknowledging is not fixing: the fault stays on the status strip.
    const card = screen
      .getByRole("button", { name: "Select Marguerite, channel 1" })
      .closest("article")!;
    expect(card.classList.contains("is-selected")).toBe(false);
  });

  it("lets a caution overlay expire while it still counts as outstanding", () => {
    renderApp(
      stateWith({
        alerts: [
          alert({
            kind: "battery-low",
            severity: "caution",
            label: "Low battery",
            overlayExpiresAtUtc: new Date(Date.now() - 1_000).toISOString(),
          }),
        ],
      }),
    );
    expect(
      screen.queryByRole("button", { name: /Press to acknowledge/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "1 to acknowledge" }),
    ).toBeTruthy();
  });

  it("keeps showfile order when a channel raises a critical alert", () => {
    renderApp(
      stateWith({
        alerts: [
          alert({
            id: "alert-000002",
            kind: "no-audio",
            dimension: "Audio",
            label: "No audio",
            channelId: "ch-spare",
            channelNumber: 3,
            channelName: "Spare",
            receiverId: null,
          }),
        ],
      }),
    );

    expect(
      screen
        .getAllByRole("article")
        .map((card) => card.getAttribute("data-channel-id")),
    ).toEqual(["ch-marguerite", "ch-talkback", "ch-spare"]);
  });

  it("shows a critical channel outside the filter in its own place", async () => {
    const user = userEvent.setup();
    renderApp(
      stateWith({
        alerts: [
          alert({
            acknowledgedAtUtc: new Date().toISOString(),
            acknowledgedBy: "Sam (A2)",
          }),
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: /^Wired/ }));
    const cards = screen.getAllByRole("article");
    expect(cards.map((card) => card.getAttribute("data-channel-id"))).toEqual([
      "ch-marguerite",
      "ch-talkback",
      "ch-spare",
    ]);
    expect(within(cards[1]!).getByText("RF link: not applicable")).toBeTruthy();
    expect(within(cards[1]!).getByText("Audio: good")).toBeTruthy();
  });

  it("names what it is waiting for without inventing channels", () => {
    renderApp(null);
    expect(screen.getByText("Waiting for the backend.")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(
      screen.getByText("Unknown", { selector: ".node-state strong" }),
    ).toBeTruthy();
  });

  it("keeps last-known identity but withdraws every judgement when the backend goes offline", () => {
    const { source } = renderApp(stateWith({ alerts: [alert()] }), {
      audioDeviceSource: readyDevice,
    });
    act(() => source.setConnection("offline"));

    expect(screen.getByText("Backend unavailable.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Alerts unavailable" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Press to acknowledge/ }),
    ).toBeNull();
    const card = screen
      .getByRole("button", { name: "Select Marguerite, channel 1" })
      .closest("article")!;
    expect(within(card).getByText("RF link: unknown")).toBeTruthy();
    expect(within(card).getByText("Battery: unknown")).toBeTruthy();
  });

  it("keeps audio-node loss distinct from backend availability", () => {
    renderApp(
      stateWith({
        node: {
          status: "unreachable",
          detail: "The audio node has not answered for 12 s.",
          device: null,
          observedAtUtc: null,
        },
      }),
    );
    expect(screen.getByText("Audio node not answering.")).toBeTruthy();
    expect(
      screen.getByText("Offline", { selector: ".node-state strong" }),
    ).toBeTruthy();
  });

  it("labels a simulated test signal as simulated", () => {
    const base = stateWith();
    renderApp({
      ...base,
      node: {
        ...base.node,
        device: {
          ...base.node.device!,
          name: "Pulse test signal",
          simulated: true,
        },
      },
    });
    expect(screen.getByText("Simulated test signal")).toBeTruthy();
  });

  it("says which receivers are not current", () => {
    const base = stateWith();
    renderApp({
      ...base,
      receivers: {
        status: "stale",
        detail: "One or more configured Shure receivers are not current.",
        units: [{ ...base.receivers.units[0]!, status: "stale" }],
      },
    });
    expect(screen.getByText("Receiver telemetry is not current.")).toBeTruthy();
    expect(screen.getByText(/Stage left: stale/)).toBeTruthy();
  });

  it("lists show-wide exceptions and what cleared recently", async () => {
    const user = userEvent.setup();
    const cleared = alert({
      id: "alert-000000",
      kind: "rf-low",
      dimension: "RF",
      severity: "caution",
      label: "Low RF",
      detail: "RF −84 dBm on Stage left channel 1. Caution at −80 dBm.",
      clearedAtUtc: new Date().toISOString(),
    });
    const fetchAlertLog = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: "0",
            generatedAtUtc: new Date().toISOString(),
            active: [alert()],
            history: [cleared],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    renderApp(stateWith({ alerts: [alert()] }), { fetchAlertLog });

    await user.click(
      screen.getByRole("button", { name: "1 to acknowledge · 1 critical" }),
    );
    const sheet = screen.getByRole("dialog", { name: "Exceptions" });
    expect(
      within(sheet).getByText(
        "Battery 8 % on Stage left channel 1. Critical at 10 %.",
      ),
    ).toBeTruthy();
    expect(
      await within(sheet).findByText(/Low RF · 1 · Marguerite/),
    ).toBeTruthy();
    expect(within(sheet).getByText("Never acknowledged")).toBeTruthy();
  });

  it("announces a newly raised critical alert once", () => {
    const { source } = renderApp(stateWith());
    act(() =>
      source.push(
        stateWith({
          revision: 11,
          alerts: [
            alert({
              id: "alert-000009",
              kind: "no-audio",
              dimension: "Audio",
              label: "No audio",
              channelId: "ch-talkback",
              channelNumber: 2,
              channelName: "Talkback",
            }),
          ],
        }),
      ),
    );
    expect(
      screen.getByText("Critical: No audio, 2 · Talkback.", {
        selector: "[aria-live='assertive']",
      }),
    ).toBeTruthy();
  });

  it("runs and resumes a named eight-dimension mic check shared through the backend", async () => {
    const user = userEvent.setup();
    const records: Array<Record<string, unknown>> = [];
    const checksBody = () => ({
      schemaVersion: "0",
      generatedAtUtc: new Date().toISOString(),
      checks: records.length
        ? [
            {
              channelId: "ch-marguerite",
              subject: {
                inputIndex: 0,
                receiverId: "rack-a",
                receiverChannelIndex: 0,
                performer: "Eleanor Vance",
              },
              startedAtUtc: "2026-09-23T01:00:00Z",
              updatedAtUtc: "2026-09-23T01:00:00Z",
              dimensions: records,
              stale: false,
            },
          ]
        : [],
    });
    const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "PUT") {
        const id = path.split("/").at(-1)!;
        const body = JSON.parse(String(init.body)) as {
          verdict: string;
          by: string;
        };
        records.push({
          id,
          verdict: body.verdict,
          by: body.by,
          atUtc: "2026-09-23T01:00:00Z",
          reason: null,
        });
      }
      return Response.json(checksBody());
    });
    vi.stubGlobal("fetch", api);
    renderApp(stateWith());

    await user.click(
      screen.getByRole("button", { name: "Open details for Marguerite" }),
    );
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    await user.type(screen.getByLabelText("A2 operator"), "Jamie");
    await user.type(screen.getByLabelText("A1 at console"), "Morgan");
    await user.click(
      await screen.findByRole("button", { name: "Continue check" }),
    );

    expect(screen.getByText("Step 1 · A2 verdict")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pass" }));
    expect(await screen.findByText("1 / 8 passed")).toBeTruthy();
    expect(api).toHaveBeenCalledWith(
      "/api/v1/checks/ch-marguerite/dimensions/physical-identity",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          verdict: "pass",
          by: "Jamie (A2)",
          reason: null,
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Save and close" }));
    await user.click(
      screen.getByRole("button", { name: "Open details for Marguerite" }),
    );
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    await user.click(
      await screen.findByRole("button", { name: "Continue check" }),
    );

    expect(screen.getByText("Step 2 · A2 verdict")).toBeTruthy();
    expect(screen.getByText("1 / 8 passed")).toBeTruthy();
    expect(window.localStorage.getItem("pulse-operator-name")).toBe("Jamie");
  });

  it("starts the first listen audible and keeps output state across channel changes", async () => {
    const user = userEvent.setup();
    const setMuted = vi.fn(async () => undefined);
    const setChannel = vi.fn();
    const close = vi.fn();
    const playbackFactory = vi.fn<PlaybackFactory>((options) => {
      options.onUpdate({
        status: "listening",
        detail: `Receiving input ${options.channel + 1}.`,
      });
      return {
        setChannel,
        setMuted,
        setDimmed: vi.fn(),
        setGainDb: vi.fn(),
        close,
      };
    });
    renderApp(stateWith(), { audioDeviceSource: readyDevice, playbackFactory });

    expect(
      (
        screen.getByRole("slider", {
          name: "Monitor volume",
        }) as HTMLInputElement
      ).value,
    ).toBe("-18");
    await screen.findByRole("button", { name: "Mute", pressed: false });
    await user.click(
      screen.getByRole("button", { name: "Select Talkback, channel 2" }),
    );
    await vi.waitFor(() =>
      expect(playbackFactory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 1 }),
      ),
    );
    expect(setMuted).toHaveBeenCalledWith(false);
    expect(screen.getByText("Monitor output is unmuted")).toBeTruthy();
    const card = screen
      .getByRole("button", { name: "Select Talkback, channel 2" })
      .closest("article")!;
    expect(card.classList.contains("is-listening")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(setMuted).toHaveBeenLastCalledWith(true);
    expect(card.classList.contains("is-listening")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(setMuted).toHaveBeenLastCalledWith(false);

    await user.click(
      screen.getByRole("button", { name: "Select Marguerite, channel 1" }),
    );
    // Switching input keeps the one WebRTC session and its unmuted output state.
    expect(setChannel).toHaveBeenLastCalledWith(0);
    expect(playbackFactory).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText("Monitor output is unmuted")).toBeTruthy();
  });

  it("refuses to listen to a channel that is not patched to an input", async () => {
    const user = userEvent.setup();
    const playbackFactory = vi.fn<PlaybackFactory>();
    renderApp(stateWith(), { audioDeviceSource: readyDevice, playbackFactory });
    await screen.findByRole("button", { name: "Mute", pressed: false });

    await user.click(
      screen.getByRole("button", { name: "Select Spare, channel 3" }),
    );
    expect(
      screen.getByText(
        "Audio input not patched. There is nothing to listen to.",
      ),
    ).toBeTruthy();
    expect(playbackFactory).not.toHaveBeenCalled();
  });

  it("lets an A1 report a fault in two presses without any listen control", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pulse-operator-name", "Morgan");
    window.localStorage.setItem("pulse-operator-role", "A1");
    const filed = report({ status: "open" });
    const post = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      Response.json(
        String(input) === "/api/v1/reports"
          ? stateWith({ revision: 11, reports: [filed] })
          : stateWith({
              revision: 12,
              reports: [
                {
                  ...filed,
                  urgent: true,
                  incident: true,
                  incidentReason: "urgent",
                },
              ],
            }),
        {
          status:
            String(input) === "/api/v1/reports" && init?.method === "POST"
              ? 201
              : 200,
        },
      ),
    );
    vi.stubGlobal("fetch", post);
    renderApp(stateWith());

    expect(
      screen.getByRole("heading", { name: "Mix confidence" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    await user.click(
      screen.getByRole("button", {
        name: "Report a fault on Marguerite, channel 1",
      }),
    );
    const sheet = screen.getByRole("dialog", { name: "Marguerite" });
    await user.click(within(sheet).getByRole("button", { name: "Crackling" }));
    await user.click(
      within(sheet).getByRole("button", { name: "Clothing noise" }),
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send 2 issues" }),
    );

    expect(post).toHaveBeenCalledWith(
      "/api/v1/reports",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          channelId: "ch-marguerite",
          faults: ["crackling", "clothing-noise"],
          note: null,
          requestedBy: "Morgan (A1)",
        }),
      }),
    );
    expect(await within(sheet).findByText("Sent to the A2s.")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Undo" })).toBeTruthy();
    await user.click(
      within(sheet).getByRole("button", {
        name: "Mark urgent — it is on air now",
      }),
    );
    expect(
      await within(sheet).findByText(/incident, marked urgent/),
    ).toBeTruthy();
  });

  it("shows an incoming report to the A2 as a banner and a pulsing card until claimed", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pulse-operator-name", "Sam");
    const open = report({ status: "open" });
    const claimed = {
      ...open,
      status: "claimed" as const,
      claimedBy: "Sam (A2)",
      claimedAtUtc: new Date().toISOString(),
    };
    const post = vi.fn(async () =>
      Response.json(stateWith({ revision: 11, reports: [claimed] })),
    );
    vi.stubGlobal("fetch", post);
    renderApp(stateWith({ reports: [open] }));

    const banner = screen.getByRole("region", {
      name: "Fault reports from the A1",
    });
    expect(
      within(banner).getByText("Crackling and clothing noise"),
    ).toBeTruthy();
    const card = screen
      .getByRole("button", { name: "Select Marguerite, channel 1" })
      .closest("article")!;
    expect(card.classList.contains("is-reported")).toBe(true);
    expect(within(card).getByText("Reported")).toBeTruthy();

    await user.click(within(banner).getByRole("button", { name: "Claim" }));
    expect(post).toHaveBeenCalledWith(
      `/api/v1/reports/${open.id}/actions`,
      expect.objectContaining({
        body: JSON.stringify({ action: "claim", by: "Sam (A2)" }),
      }),
    );
    expect(
      screen.queryByRole("region", { name: "Fault reports from the A1" }),
    ).toBeNull();
    expect(card.classList.contains("is-reported")).toBe(false);
    expect(within(card).getByText("Being worked · Sam (A2)")).toBeTruthy();
  });

  it("asks which feed to join and shares that feed's selection", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pulse-operator-name", "Sam");
    const playbackFactory = vi.fn<PlaybackFactory>();
    const { hostOutput } = renderApp(stateWith(), {
      audioDeviceSource: readyDevice,
      playbackFactory,
      hostOutput: hostDocument(dvsOutput, [
        hostFeed("feed-a", "Comms A", [1]),
        hostFeed("feed-b", "Comms B", [2], {
          channelId: "ch-talkback",
          input: 1,
          muted: true,
        }),
      ]),
    });

    const prompt = await screen.findByRole("dialog", {
      name: "Where should audio play?",
    });
    // The opening prompt needs an answer; it has no Cancel.
    expect(within(prompt).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      within(prompt)
        .getAllByRole("button")
        .map((button) => button.querySelector("strong")?.textContent),
    ).toEqual(["This device", "Comms A", "Comms B"]);
    expect(
      within(prompt).getByRole("button", { name: /^Comms B/ }).textContent,
    ).toContain(
      "Output 2 of Dante Virtual Soundcard. Shared with everyone in Comms B. Now: Talkback, muted.",
    );
    await user.click(within(prompt).getByRole("button", { name: /^Comms A/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Audio: Comms A" })).toBeTruthy();
    expect(screen.getByText("Comms A idle")).toBeTruthy();
    // Comms B's selection is not shown in Comms A.
    const talkback = screen
      .getByRole("button", { name: "Select Talkback, channel 2" })
      .closest("article")!;
    expect(talkback.classList.contains("is-selected")).toBe(false);

    await user.click(
      screen.getByRole("button", { name: "Select Talkback, channel 2" }),
    );
    expect(hostOutput.changes.at(-1)).toEqual({
      feedId: "feed-a",
      channelId: "ch-talkback",
      input: 1,
      changedBy: "Sam (A2)",
    });
    await vi.waitFor(() =>
      expect(talkback.classList.contains("is-listening")).toBe(true),
    );
    expect(screen.getByText("Playing on Comms A")).toBeTruthy();
    expect(
      screen.getByText(
        "Comms A: input 2 on output 1 of Dante Virtual Soundcard.",
      ),
    ).toBeTruthy();
    // The iPad itself never opens a listen feed in host mode.
    expect(playbackFactory).not.toHaveBeenCalled();

    // Another operator in Comms A selects a different channel: this device follows.
    act(() =>
      hostOutput.push(
        hostDocument(dvsOutput, [
          hostFeed("feed-a", "Comms A", [1], {
            channelId: "ch-marguerite",
            input: 0,
            muted: true,
            changedBy: "Alex (A2)",
            changedAtUtc: new Date().toISOString(),
          }),
          hostFeed("feed-b", "Comms B", [2]),
        ]),
      ),
    );
    const marguerite = screen
      .getByRole("button", { name: "Select Marguerite, channel 1" })
      .closest("article")!;
    expect(marguerite.classList.contains("is-selected")).toBe(true);
    expect(talkback.classList.contains("is-selected")).toBe(false);
    expect(screen.getByText("Comms A is muted")).toBeTruthy();
    expect(
      screen.getByText("Shared with everyone in Comms A.", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText(/Last change: Alex \(A2\)/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(hostOutput.changes.at(-1)).toEqual({
      feedId: "feed-a",
      muted: false,
      changedBy: "Sam (A2)",
    });

    // The production drops Comms A: this device is asked again.
    act(() =>
      hostOutput.push(
        hostDocument(dvsOutput, [hostFeed("feed-b", "Comms B", [2])]),
      ),
    );
    const again = screen.getByRole("dialog", {
      name: "Where should audio play?",
    });
    expect(
      within(again)
        .getAllByRole("button")
        .map((button) => button.querySelector("strong")?.textContent),
    ).toEqual(["This device", "Comms B"]);
  });

  it("remembers the choice on this device and only asks again when the feed is gone", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pulse-operator-name", "Sam");
    const feeds = [
      hostFeed("feed-a", "Comms A", [1]),
      hostFeed("feed-b", "Comms B", [2]),
    ];
    const first = renderApp(stateWith(), {
      audioDeviceSource: readyDevice,
      hostOutput: hostDocument(dvsOutput, feeds),
    });
    const prompt = await screen.findByRole("dialog", {
      name: "Where should audio play?",
    });
    await user.click(within(prompt).getByRole("button", { name: /^Comms B/ }));
    first.view.unmount();

    // Opening Live again joins Comms B without asking.
    renderApp(stateWith(), {
      audioDeviceSource: readyDevice,
      hostOutput: hostDocument(dvsOutput, feeds),
    });
    expect(
      await screen.findByRole("button", { name: "Audio: Comms B" }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    // A remembered feed the production no longer has asks again.
    renderApp(stateWith(), {
      audioDeviceSource: readyDevice,
      hostOutput: hostDocument(dvsOutput, [feeds[0]]),
    });
    expect(
      await screen.findByRole("dialog", { name: "Where should audio play?" }),
    ).toBeTruthy();
  });

  it("plays on this device when chosen, without touching the host output", async () => {
    const user = userEvent.setup();
    const playbackFactory = vi.fn<PlaybackFactory>(() => ({
      setChannel: vi.fn(),
      setMuted: vi.fn(async () => undefined),
      setDimmed: vi.fn(),
      setGainDb: vi.fn(),
      close: vi.fn(),
    }));
    window.localStorage.setItem("pulse-selected-channel", "ch-talkback");
    const { hostOutput } = renderApp(stateWith(), {
      audioDeviceSource: readyDevice,
      playbackFactory,
      hostOutput: hostDocument(dvsOutput, [
        hostFeed("feed-a", "Comms A", [1], {
          channelId: "ch-marguerite",
          input: 0,
        }),
      ]),
    });

    const prompt = await screen.findByRole("dialog", {
      name: "Where should audio play?",
    });
    // Nothing plays until the choice is made, even with a remembered channel.
    expect(playbackFactory).not.toHaveBeenCalled();
    await user.click(
      within(prompt).getByRole("button", { name: /^This device/ }),
    );
    await vi.waitFor(() =>
      expect(playbackFactory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 1 }),
      ),
    );
    expect(hostOutput.changes).toEqual([]);

    // The choice can be changed from the header.
    await user.click(
      screen.getByRole("button", { name: "Audio: this device" }),
    );
    const sheet = screen.getByRole("dialog", {
      name: "Where should audio play?",
    });
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Run of show", () => {
  const session: NonNullable<LiveState["runs"]>[number] = {
    roomId: null,
    activeId: null,
    nextId: "ses-keynote",
    startedAtUtc: null,
    startedBy: null,
    sessions: [
      {
        id: "ses-keynote",
        name: "Keynote",
        startMinute: 540,
        channelCount: 1,
      },
      { id: "ses-panel", name: "Panel", startMinute: 615, channelCount: 2 },
    ],
  };

  it("hides the run of show when the showfile has no sessions", async () => {
    renderApp(stateWith());
    await screen.findByText("Marguerite");
    expect(screen.queryByRole("region", { name: "Run of show" })).toBeNull();
  });

  it("starts the next session from the turnover sheet and filters to it", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pulse-operator-name", "Sam");
    const before = stateWith({
      runs: [session],
      channels: [
        channel({
          session: {
            inUse: null,
            nextInUse: true,
            nextPresenter: "Dana Lee",
          },
        }),
        {
          ...talkback,
          session: { inUse: null, nextInUse: false, nextPresenter: null },
        },
      ],
    });
    const after = stateWith({
      revision: 11,
      runs: [
        {
          ...session,
          activeId: "ses-keynote",
          nextId: "ses-panel",
          startedAtUtc: new Date().toISOString(),
          startedBy: "Sam (A2)",
        },
      ],
      channels: [
        channel({
          performer: "Dana Lee",
          session: { inUse: true, nextInUse: true, nextPresenter: null },
        }),
        {
          ...talkback,
          session: { inUse: false, nextInUse: true, nextPresenter: null },
        },
      ],
    });
    const put = vi.fn(
      async () =>
        new Response(JSON.stringify(after), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", put);
    renderApp(before);

    const bar = await screen.findByRole("region", { name: "Run of show" });
    expect(within(bar).getByText("No session running")).toBeTruthy();
    expect(within(bar).getByText("1 channel ready")).toBeTruthy();

    await user.click(within(bar).getByRole("button", { name: "Turnover" }));
    const sheet = screen.getByRole("dialog", { name: "Turnover to Keynote" });
    expect(
      within(sheet).getByRole("button", {
        name: /Marguerite, channel 1\. Ready: Battery 90 %/,
      }),
    ).toBeTruthy();
    await user.click(
      within(sheet).getByRole("button", { name: "Start Keynote" }),
    );

    expect(put).toHaveBeenCalledWith(
      "/api/v1/live/session",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          sessionId: "ses-keynote",
          roomId: null,
          operator: "Sam (A2)",
        }),
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(bar).getByText("Keynote")).toBeTruthy();

    const idleCard = screen
      .getByRole("button", { name: "Select Talkback, channel 2" })
      .closest("article")!;
    expect(idleCard.classList.contains("is-idle")).toBe(true);
    expect(within(idleCard).getByText(/Not in this session/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /This session/ }));
    expect(
      screen.queryByRole("button", { name: "Select Talkback, channel 2" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Select Marguerite, channel 1" }),
    ).toBeTruthy();
  });
});

describe("Rooms", () => {
  const rooms: NonNullable<LiveState["rooms"]> = [
    {
      id: "room-ballroom",
      name: "Ballroom",
      categories: [{ id: "cat-stage", name: "Stage" }],
    },
    {
      id: "room-breakout",
      name: "Breakout B",
      categories: [{ id: "cat-lectern", name: "Lectern" }],
    },
  ];
  const run = (
    roomId: string,
    name: string,
  ): NonNullable<LiveState["runs"]>[number] => ({
    roomId,
    activeId: null,
    nextId: `ses-${roomId}`,
    startedAtUtc: null,
    startedBy: null,
    sessions: [
      { id: `ses-${roomId}`, name, startMinute: 540, channelCount: 1 },
    ],
  });
  const roomed = () =>
    stateWith({
      rooms,
      runs: [run("room-ballroom", "Keynote"), run("room-breakout", "Workshop")],
      channels: [
        channel({ roomId: "room-ballroom", categoryId: "cat-stage" }),
        { ...talkback, roomId: "room-breakout", categoryId: "cat-lectern" },
        { ...unpatched, roomId: null, categoryId: null },
      ],
    });

  it("groups every room's channels under room and category headings", async () => {
    renderApp(roomed());
    expect(
      await screen.findByRole("region", { name: "Ballroom · Stage" }),
    ).toBeTruthy();
    const lectern = screen.getByRole("region", {
      name: "Breakout B · Lectern",
    });
    expect(
      within(lectern).getByText("Talkback", { selector: "h2" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "No room" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Run of show: Ballroom" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Run of show: Breakout B" }),
    ).toBeTruthy();
  });

  it("shows one room per device and remembers it", async () => {
    const user = userEvent.setup();
    renderApp(roomed());
    const picker = await screen.findByRole("navigation", { name: "Rooms" });
    await user.click(
      within(picker).getByRole("button", { name: /Breakout B/ }),
    );

    expect(window.localStorage.getItem("pulse-room")).toBe("room-breakout");
    expect(screen.getByRole("region", { name: "Lectern" })).toBeTruthy();
    expect(screen.queryByText("Marguerite", { selector: "h2" })).toBeNull();
    expect(screen.getByRole("region", { name: "Run of show" })).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: /Run of show: Ballroom/ }),
    ).toBeNull();
  });

  it("falls back to every room when the remembered room is gone", async () => {
    window.localStorage.setItem("pulse-room", "room-demolished");
    renderApp(roomed());
    expect(
      await screen.findByText("Marguerite", { selector: "h2" }),
    ).toBeTruthy();
    expect(screen.getByText("Talkback", { selector: "h2" })).toBeTruthy();
  });
});
