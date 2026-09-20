// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("Manager shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(cleanup);

  it("labels fabricated state and never reports unknown setup as empty totals", () => {
    render(<App />);

    expect(screen.getByText("Fabricated local setup")).toBeTruthy();
    expect(screen.getByText("Management backend unavailable.")).toBeTruthy();
    expect(screen.getAllByText("– Unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 people|0 microphones|0 paths/i)).toBeNull();
  });

  it("opens a setup area through a semantic button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Open people and roles" }),
    );

    expect(
      screen.getByRole("heading", { name: "People and roles", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Waiting for the management API before people or roles can be shown.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "People and roles" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("reports readiness as unavailable instead of inventing a validation result", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Check readiness" }));

    expect(screen.getByRole("status").textContent).toContain(
      "Readiness could not be checked.",
    );
    expect(screen.queryByText(/ready to activate/i)).toBeNull();
  });

  it("persists an explicit dark theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("a2-monitor-theme")).toBe("dark");
  });
});
