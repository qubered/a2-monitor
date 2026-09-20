// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveSnapshot } from "@a2-monitor/protocol/http";
import { App } from "./App";
import { initialChannels } from "./dev-data/channels";
import {
  createStaticSnapshotSource,
  SnapshotContractError,
  SnapshotOfflineError,
  type SnapshotSource,
} from "./snapshot";

const snapshot: LiveSnapshot = {
  schemaVersion: "0",
  generatedAtUtc: "2026-09-20T00:00:00Z",
  source: { kind: "fabricated", label: "Fabricated test data" },
  show: {
    name: "The Winter Circus",
    venue: "Northgate Playhouse",
    performanceLabel: "Preview 3",
  },
  node: { status: "ready", channelCount: 10, sampleRateHz: 48000 },
  channels: initialChannels,
};

const snapshotSource = createStaticSnapshotSource(snapshot);

describe("Live channel grid", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(cleanup);

  it("starts muted and selecting a healthy channel does not unmute", async () => {
    const user = userEvent.setup();
    render(<App snapshotSource={snapshotSource} />);

    expect(await screen.findByText("Monitor output is muted")).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Select Vera Castellan, channel 33",
      }),
    );

    const selectedCard = screen
      .getByRole("button", { name: "Select Vera Castellan, channel 33" })
      .closest("article");
    expect(selectedCard?.classList.contains("is-selected")).toBe(true);
    expect(selectedCard?.classList.contains("is-listening")).toBe(false);
    expect(
      within(selectedCard as HTMLElement).getByText("Selected"),
    ).toBeTruthy();
    expect(
      within(selectedCard as HTMLElement).queryByText("Listening"),
    ).toBeNull();
    expect(
      screen.getByText("Selected", { selector: ".source-selected-badge" }),
    ).toBeTruthy();
    expect(document.querySelector(".live-badge")).toBeNull();
    expect(
      screen.getByText("Vera Castellan", { selector: ".player-source strong" }),
    ).toBeTruthy();
    expect(screen.getByText("Monitor output is muted")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mute" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("acknowledges an alert without changing the selected source", async () => {
    const user = userEvent.setup();
    render(<App snapshotSource={snapshotSource} />);

    await screen.findByRole("button", {
      name: "Select Vera Castellan, channel 33",
    });

    await user.click(
      screen.getByRole("button", {
        name: "Select Vera Castellan, channel 33",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Low RF on Marguerite Hale, channel 27. Press to acknowledge.",
      }),
    );

    expect(
      screen.getByText("Vera Castellan", { selector: ".player-source strong" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Select Marguerite Hale, channel 27",
      }),
    ).toBeTruthy();
    const acknowledgedCard = screen
      .getByRole("button", {
        name: "Select Marguerite Hale, channel 27",
      })
      .closest("article");
    expect(
      within(acknowledgedCard as HTMLElement).queryByText("Selected"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "2 to acknowledge" }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: "Select Marguerite Hale, channel 27",
      }),
    );
    expect(
      within(acknowledgedCard as HTMLElement).getByText("Selected"),
    ).toBeTruthy();
  });

  it("filters the grid without hiding independent status dimensions", async () => {
    const user = userEvent.setup();
    render(<App snapshotSource={snapshotSource} />);

    await screen.findByRole("button", { name: /Wired 1/ });

    await user.click(screen.getByRole("button", { name: /Wired 1/ }));

    const card = screen.getByRole("article");
    expect(
      within(card).getByRole("button", {
        name: "Select Bandleader · keys vox, channel 8",
      }),
    ).toBeTruthy();
    expect(within(card).getByText("RF link: not applicable")).toBeTruthy();
    expect(within(card).getByText("Audio: good")).toBeTruthy();
  });

  it("persists an explicit dark theme", async () => {
    const user = userEvent.setup();
    render(<App snapshotSource={snapshotSource} />);

    await screen.findByLabelText("Theme");

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("a2-monitor-theme")).toBe("dark");
  });

  it("names what it is waiting for without showing invented channel counts", () => {
    const pendingSource: SnapshotSource = {
      load: () => new Promise(() => undefined),
    };

    render(<App snapshotSource={pendingSource} />);

    expect(screen.getByText("Waiting for the backend snapshot.")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("0 sources")).toBeNull();
  });

  it("shows an explicit offline state and reconnects without implying success", async () => {
    const user = userEvent.setup();
    let calls = 0;
    let finishReconnect: ((value: LiveSnapshot) => void) | undefined;
    const reconnectSource: SnapshotSource = {
      load: async () => {
        calls += 1;
        if (calls === 1) throw new SnapshotOfflineError();
        return new Promise<LiveSnapshot>((resolve) => {
          finishReconnect = resolve;
        });
      },
    };

    render(<App snapshotSource={reconnectSource} />);

    expect(await screen.findByText("Backend unavailable.")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Reconnecting to the backend."),
    ).toBeTruthy();
    finishReconnect?.(snapshot);
    expect(
      await screen.findByRole("button", {
        name: "Select Vera Castellan, channel 33",
      }),
    ).toBeTruthy();
  });

  it("rejects an unusable snapshot as an error instead of rendering it", async () => {
    const invalidSource: SnapshotSource = {
      load: async () => {
        throw new SnapshotContractError(
          "Snapshot schema version is unsupported.",
        );
      },
    };

    render(<App snapshotSource={invalidSource} />);

    expect(await screen.findByText("Snapshot could not be used.")).toBeTruthy();
    expect(
      screen.getByText("Invalid or failed data was not shown."),
    ).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("keeps audio-node loss distinct from backend availability", async () => {
    const nodeOfflineSource = createStaticSnapshotSource({
      ...snapshot,
      node: { status: "offline", channelCount: null, sampleRateHz: null },
    });

    render(<App snapshotSource={nodeOfflineSource} />);

    expect(await screen.findByText("Audio node offline.")).toBeTruthy();
    expect(
      screen.getByText(
        "Monitor output is unavailable. Snapshot values are not current.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Offline", { selector: ".node-state strong" }),
    ).toBeTruthy();
  });
});
