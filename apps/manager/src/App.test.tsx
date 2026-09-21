// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const storedShowfile = {
  schemaVersion: "0",
  revision: 2,
  updatedAtUtc: "2026-09-21T00:00:00Z",
  show: { name: "Winter Circus" },
  device: { name: "USB Interface", channelCount: 2 },
  channels: [
    { inputIndex: 0, name: "Alice" },
    { inputIndex: 1, name: "Bob" },
  ],
};

describe("Manager showfile editor", () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/audio/v0/device") {
        return Response.json({
          schemaVersion: 0,
          status: "ready",
          detail: "Capture active.",
          device: {
            name: "USB Interface",
            sampleRateHz: 48000,
            channelCount: 2,
          },
          channels: [
            { index: 0, label: "Input 1" },
            { index: 1, label: "Input 2" },
          ],
        });
      }
      if (path === "/api/v1/showfile" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as typeof storedShowfile;
        return Response.json({
          ...body,
          revision: body.revision + 1,
          updatedAtUtc: "2026-09-21T00:01:00Z",
        });
      }
      return Response.json(storedShowfile);
    },
  );

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads observed inputs, edits a name and saves a new revision", async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = await screen.findByLabelText("Channel 2 name");
    expect((input as HTMLInputElement).value).toBe("Bob");
    await user.clear(input);
    await user.type(input, "Talkback");
    await user.click(screen.getByRole("button", { name: "Save showfile" }));

    expect(await screen.findByText("Revision 3")).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    expect(String(saveCall?.[1]?.body)).toContain('"name":"Talkback"');
  });

  it("persists an explicit dark theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("a2-monitor-theme")).toBe("dark");
  });
});
