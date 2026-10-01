// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

describe("SelectionBar", () => {
  it("resets every selected channel, and offers it only when the backend is reachable", () => {
    const onReset = vi.fn();
    const props = {
      count: 3,
      touchSelecting: false,
      onDone: vi.fn(),
      onClear: vi.fn(),
    };
    const { rerender } = render(<SelectionBar {...props} onReset={onReset} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear alerts and reset every selected channel",
      }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);

    rerender(<SelectionBar {...props} />);
    expect(screen.queryByText("Clear alerts and reset")).toBeNull();
  });
});
