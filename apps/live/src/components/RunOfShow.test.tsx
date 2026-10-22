// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunOfShow } from "./RunOfShow";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("RunOfShow", () => {
  it("opens by default, hides the rows on toggle and remembers the choice", () => {
    const view = (
      <RunOfShow summary="2 channels to prepare" needsAttention>
        <p>Ballroom row</p>
      </RunOfShow>
    );
    const { unmount } = render(view);
    const toggle = screen.getByRole("button", { name: /Run of show/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Ballroom row").closest("[hidden]")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Ballroom row").closest("[hidden]")).not.toBeNull();
    expect(screen.getByText("2 channels to prepare")).toBeTruthy();

    unmount();
    render(view);
    expect(
      screen
        .getByRole("button", { name: /Run of show/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
