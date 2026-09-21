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

type StoredShowfile = {
  schemaVersion: string;
  revision: number;
  updatedAtUtc: string | null;
  show: { name: string };
  device: { name: string; channelCount: number } | null;
  channels: Array<Record<string, unknown>>;
  shureReceivers?: unknown[];
};

const storedShowfile: StoredShowfile = {
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

function summarizeProduction(id: string, showfile: StoredShowfile) {
  return {
    id,
    name: showfile.show.name,
    revision: showfile.revision,
    updatedAtUtc: showfile.updatedAtUtc,
    channelCount: showfile.channels.length,
    receiverCount: showfile.shureReceivers?.length ?? 0,
  };
}

describe("Manager showfile editor", () => {
  let showfiles: Record<string, StoredShowfile>;
  let activeId: string;
  let nextId: number;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";

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
      if (path === "/api/v1/showfile" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as StoredShowfile;
        const saved: StoredShowfile = {
          ...body,
          revision: body.revision + 1,
          updatedAtUtc: "2026-09-21T00:01:00Z",
        };
        showfiles[activeId] = saved;
        return Response.json(saved);
      }
      if (path === "/api/v1/showfile") {
        return Response.json(showfiles[activeId]);
      }
      if (path === "/api/v1/productions" && method === "POST") {
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        const id = `p${nextId++}`;
        showfiles[id] = {
          schemaVersion: "0",
          revision: 0,
          updatedAtUtc: null,
          show: { name },
          device: null,
          shureReceivers: [],
          channels: [],
        };
        activeId = id;
        return new Response(
          JSON.stringify({
            schemaVersion: "0",
            activeId,
            productions: Object.entries(showfiles).map(([entryId, sf]) =>
              summarizeProduction(entryId, sf),
            ),
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      const activateMatch = /^\/api\/v1\/productions\/([^/]+)\/activate$/.exec(
        path,
      );
      if (activateMatch && method === "POST") {
        activeId = activateMatch[1]!;
        return Response.json({
          schemaVersion: "0",
          activeId,
          productions: Object.entries(showfiles).map(([entryId, sf]) =>
            summarizeProduction(entryId, sf),
          ),
        });
      }
      if (path === "/api/v1/productions") {
        return Response.json({
          schemaVersion: "0",
          activeId,
          productions: Object.entries(showfiles).map(([entryId, sf]) =>
            summarizeProduction(entryId, sf),
          ),
        });
      }
      return Response.json(showfiles[activeId]);
    },
  );

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    showfiles = { p1: { ...storedShowfile, shureReceivers: [] } };
    activeId = "p1";
    nextId = 2;
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

  it("persists an explicit dark theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("a2-monitor-theme")).toBe("dark");
  });

  it("sets a channel's mic type, image URL, and turns off RF monitoring", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /channels/i }));

    const micTypeSelect = await screen.findByRole("combobox", {
      name: "Channel 1 mic type",
    });
    await user.click(micTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Headset" }));

    const rfToggle = screen.getByRole("button", {
      name: "Channel 1 rf monitoring",
    });
    expect(rfToggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(rfToggle);
    expect(rfToggle.getAttribute("aria-pressed")).toBe("false");

    const imageInput = screen.getByLabelText("Channel 1 image URL");
    await user.type(imageInput, "https://example.com/alice.jpg");

    await user.click(screen.getByRole("button", { name: "Save showfile" }));

    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    const body = String(saveCall?.[1]?.body);
    expect(body).toContain('"micType":"headset"');
    expect(body).toContain('"imageUrl":"https://example.com/alice.jpg"');
    expect(body).toContain(
      '"monitor":{"battery":true,"rf":false,"audio":true}',
    );
  });

  it("creates a production and switches the active showfile to it", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /productions/i }));
    await screen.findAllByText("Q3 All-Hands");

    await user.type(screen.getByLabelText("New production"), "Spring Gala");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findAllByText("Spring Gala");
    const rows = await screen.findAllByRole("row");
    const springRow = rows.find((row) =>
      row.textContent?.includes("Spring Gala"),
    );
    expect(springRow?.textContent).toContain("Active");

    expect(await screen.findByText("Revision 0")).toBeTruthy();
  });
});
