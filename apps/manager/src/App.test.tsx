// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// jsdom has no pointer-capture/scroll implementation; Radix's Select uses
// both while handling pointer events. Polyfill only what's missing so the
// combobox interaction tests below can actually open and select.
for (const method of [
  "hasPointerCapture",
  "setPointerCapture",
  "releasePointerCapture",
]) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, {
      value: () => false,
      configurable: true,
    });
  }
}
if (!("scrollIntoView" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => undefined,
    configurable: true,
  });
}

const storedShowfile = {
  schemaVersion: "0",
  revision: 2,
  updatedAtUtc: "2026-09-21T00:00:00Z",
  show: { name: "Q3 All-Hands" },
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

    await user.click(await screen.findByRole("tab", { name: /channels/i }));
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

  it("adds a Shure receiver, selects its model, and derives its channel count", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /receivers/i }));
    await user.click(screen.getByRole("button", { name: "Add receiver" }));

    const modelSelect = await screen.findByRole("combobox", {
      name: "Receiver 1 model",
    });
    expect(modelSelect.textContent).toContain("ULX-D ULXD4D");
    expect(screen.getByText("2 channels")).toBeTruthy();

    await user.click(modelSelect);
    await user.click(
      await screen.findByRole("option", { name: "QLX-D QLXD4" }),
    );
    expect(screen.getByText("1 channel")).toBeTruthy();

    await user.click(modelSelect);
    await user.click(
      await screen.findByRole("option", {
        name: "Axient Digital / ULX-D ANX4",
      }),
    );
    expect(screen.getByLabelText("Receiver 1 channel count")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save showfile" }));
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    expect(String(saveCall?.[1]?.body)).toContain('"model":"ANX4"');
  });
});
