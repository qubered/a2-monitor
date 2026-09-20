// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("Live channel grid", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(cleanup);

  it("starts muted and selecting a healthy channel does not unmute", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText("Listening is muted")).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Listen to Vera Castellan, channel 33",
      }),
    );

    expect(
      screen.getByText("Vera Castellan", { selector: ".player-source strong" }),
    ).toBeTruthy();
    expect(screen.getByText("Listening is muted")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mute" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("acknowledges an alert without changing the selected source", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", {
        name: "Listen to Vera Castellan, channel 33",
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
        name: "Listen to Marguerite Hale, channel 27",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "2 to acknowledge" }),
    ).toBeTruthy();
  });

  it("filters the grid without hiding independent status dimensions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Wired 1/ }));

    const card = screen.getByRole("article");
    expect(
      within(card).getByRole("button", {
        name: "Listen to Bandleader · keys vox, channel 8",
      }),
    ).toBeTruthy();
    expect(within(card).getByText("RF link: not applicable")).toBeTruthy();
    expect(within(card).getByText("Audio: good")).toBeTruthy();
  });

  it("persists an explicit dark theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("a2-monitor-theme")).toBe("dark");
  });
});
