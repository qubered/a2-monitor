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

  let deviceReady = true;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";

      if (path === "/audio/v0/device" && !deviceReady) {
        return Response.json({
          schemaVersion: 0,
          status: "configuration-required",
          detail: "Set A2_AUDIO_DEVICE to an explicit capture device.",
        });
      }
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
      if (path === "/audio/v0/output") {
        return Response.json({
          schemaVersion: "0",
          output: {
            status: "ready",
            detail:
              "Dante Virtual Soundcard is open: 1 feed on 1 of 16 outputs.",
            deviceName: "Dante Virtual Soundcard",
            channelCount: 16,
            simulated: false,
            underruns: 0,
            droppedFrames: 0,
          },
          feeds: [
            {
              id: "default",
              name: "Host output",
              outputChannels: [1],
              revision: 0,
              monitor: {
                channelId: null,
                input: null,
                muted: false,
                dimmed: false,
                gainDb: 0,
                changedBy: null,
                changedAtUtc: null,
              },
            },
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
      const byIdMatch = /^\/api\/v1\/productions\/([^/]+)$/.exec(path);
      if (byIdMatch && method === "GET") {
        const found = showfiles[byIdMatch[1]!];
        if (!found) return new Response(null, { status: 404 });
        return Response.json(found);
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
    showfiles = { p1: { ...storedShowfile, shureReceivers: [] } };
    deviceReady = true;
    activeId = "p1";
    nextId = 2;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
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

  it("sets a channel's mic type, uploads a photo, and turns off RF monitoring", async () => {
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

    const photoFile = new File(["hello"], "alice.png", {
      type: "image/png",
    });
    await user.upload(
      screen.getByLabelText("Channel 1 photo upload"),
      photoFile,
    );
    await screen.findByRole("button", { name: "Channel 1 remove photo" });

    await user.click(screen.getByRole("button", { name: "Save showfile" }));

    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    const body = String(saveCall?.[1]?.body);
    expect(body).toContain('"micType":"headset"');
    expect(body).toContain('"imageUrl":"data:image/png;base64,aGVsbG8="');
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

  it("imports an uploaded showfile as a new production", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /productions/i }));
    await screen.findAllByText("Q3 All-Hands");

    const uploaded = {
      schemaVersion: "0",
      revision: 9,
      updatedAtUtc: "2020-01-01T00:00:00Z",
      show: { name: "Imported Gala" },
      device: { name: "Some Other Interface", channelCount: 8 },
      shureReceivers: [],
      channels: [{ inputIndex: 3, name: "Guest mic" }],
    };
    const file = new File([JSON.stringify(uploaded)], "gala.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("Import showfile"), file);

    await screen.findAllByText("Imported Gala");
    expect(await screen.findByText("Revision 1")).toBeTruthy();

    const putCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    const body = JSON.parse(String(putCall?.[1]?.body));
    expect(body.show.name).toBe("Imported Gala");
    expect(body.revision).toBe(0);
    // The uploaded device doesn't match this Mac's observed device, so the
    // patch is dropped rather than silently pointing at the wrong input.
    expect(body.channels[0].inputIndex).toBeNull();
  });

  it("downloads the active production's showfile as JSON", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /productions/i }));
    await user.click(
      await screen.findByRole("button", { name: "Download Q3 All-Hands" }),
    );

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const mockCreateObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const blob = mockCreateObjectURL.mock.calls[0]?.[0] as Blob;
    const downloaded = JSON.parse(await blob.text());
    expect(downloaded.show.name).toBe("Q3 All-Hands");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("edits the show without a running audio device and keeps saved patches", async () => {
    deviceReady = false;
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByText(
        "Showfile loaded. The audio device is not running, so input patches are shown as saved and cannot be checked.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /channels/i }));
    const performer = await screen.findByLabelText("Channel 1 performer");
    await user.type(performer, "Eleanor Vance");
    await user.click(screen.getByRole("button", { name: "Save showfile" }));

    expect(await screen.findByText("Revision 3")).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    const saved = JSON.parse(String(saveCall?.[1]?.body)) as StoredShowfile;
    expect(saved.device).toEqual({ name: "USB Interface", channelCount: 2 });
    expect(saved.channels[0]).toMatchObject({
      inputIndex: 0,
      performer: "Eleanor Vance",
    });
  });

  it("sets a custom alert policy, refuses incoherent limits, and resets to defaults", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /alerts/i }));
    expect(screen.getByText("Using defaults")).toBeTruthy();
    const [batteryCaution] = screen.getAllByLabelText(
      "Caution at or below (%)",
    );
    await user.clear(batteryCaution!);
    await user.type(batteryCaution!, "30");
    expect(screen.getByText("Custom policy")).toBeTruthy();

    const [batteryCritical] = screen.getAllByLabelText(
      "Critical at or below (%)",
    );
    await user.clear(batteryCritical!);
    await user.type(batteryCritical!, "40");
    expect(screen.getByRole("alert").textContent).toContain(
      "Each critical limit must be beyond its caution limit.",
    );
    await user.clear(batteryCritical!);
    await user.type(batteryCritical!, "12");
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save showfile" }));
    expect(await screen.findByText("Revision 3")).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    expect(JSON.parse(String(saveCall?.[1]?.body)).alertPolicy).toMatchObject({
      batteryCautionPercent: 30,
      batteryCriticalPercent: 12,
      rfCautionDbm: -80,
    });

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByText("Using defaults")).toBeTruthy();
  });

  it("builds a run of show: sessions, start times, channels and presenters", async () => {
    const user = userEvent.setup();
    showfiles.p1 = {
      ...storedShowfile,
      shureReceivers: [],
      channels: [
        { id: "ch-alice", inputIndex: 0, name: "Alice", performer: "Alice Ng" },
        { id: "ch-bob", inputIndex: 1, name: "Bob" },
      ],
    };
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /sessions/i }));
    expect(screen.getByText("No sessions.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add session" }));
    const name = screen.getByLabelText("Session 1 name");
    await user.clear(name);
    await user.type(name, "Keynote");
    await user.type(screen.getByLabelText("Session 1 start time"), "09:30");
    await user.click(screen.getByLabelText("Use Alice in Keynote"));
    expect(
      (screen.getByLabelText("Bob presenter in Keynote") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    await user.type(
      screen.getByLabelText("Alice presenter in Keynote"),
      "Dana Lee",
    );

    // A new session starts from the previous one's channels.
    await user.click(screen.getByRole("button", { name: "Add session" }));
    await user.click(screen.getByLabelText("Use Bob in Session 2"));
    await user.click(
      screen.getByRole("button", { name: "Move session 2 earlier" }),
    );

    await user.click(screen.getByRole("button", { name: "Save showfile" }));
    expect(await screen.findByText("Revision 3")).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    expect(JSON.parse(String(saveCall?.[1]?.body)).sessions).toEqual([
      {
        name: "Session 2",
        startMinute: null,
        channels: [
          { channelId: "ch-alice", presenter: "Dana Lee" },
          { channelId: "ch-bob", presenter: null },
        ],
      },
      {
        name: "Keynote",
        startMinute: 570,
        channels: [{ channelId: "ch-alice", presenter: "Dana Lee" }],
      },
    ]);
  });

  it("organises channels into rooms and categories", async () => {
    const user = userEvent.setup();
    showfiles.p1 = {
      ...storedShowfile,
      shureReceivers: [],
      channels: [
        { id: "ch-alice", inputIndex: 0, name: "Alice" },
        { id: "ch-bob", inputIndex: 1, name: "Bob" },
      ],
    };
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /rooms/i }));
    expect(screen.getByText("No rooms.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add room" }));
    const name = screen.getByLabelText("Room 1 name");
    await user.clear(name);
    await user.type(name, "Ballroom");
    await user.click(
      screen.getByRole("button", { name: "Add category to Ballroom" }),
    );
    const category = screen.getByLabelText("Ballroom category 1 name");
    await user.clear(category);
    await user.type(category, "Stage");

    await user.click(screen.getByRole("tab", { name: /channels/i }));
    await user.click(
      screen.getByRole("combobox", { name: "Channel 1 room and category" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Ballroom · Stage" }),
    );

    await user.click(screen.getByRole("button", { name: "Save showfile" }));
    expect(await screen.findByText("Revision 3")).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    const saved = JSON.parse(String(saveCall?.[1]?.body)) as {
      rooms: Array<{
        id: string;
        name: string;
        categories: Array<{ id: string; name: string }>;
      }>;
      channels: Array<{ roomId?: string | null; categoryId?: string | null }>;
    };
    expect(saved.rooms).toEqual([
      {
        id: expect.stringMatching(/^room-/),
        name: "Ballroom",
        categories: [{ id: expect.stringMatching(/^cat-/), name: "Stage" }],
      },
    ]);
    expect(saved.channels[0]).toMatchObject({
      roomId: saved.rooms[0]!.id,
      categoryId: saved.rooms[0]!.categories[0]!.id,
    });
    expect(saved.channels[1]!.roomId ?? null).toBeNull();
  });

  it("saves host output feeds with their outputs picked from the device", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: /host output/i }));
    expect(
      await screen.findByText(/one feed, Host output, on output 1/),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add feed" }));
    await user.click(screen.getByRole("button", { name: "Add feed" }));
    const second = screen.getByLabelText("Feed 2 name");
    await user.clear(second);
    await user.type(second, "Comms B");
    expect(screen.getByText("Output 1")).toBeTruthy();
    expect(screen.getByText("Output 2")).toBeTruthy();

    // Add output 12 to Comms B from the device's free outputs.
    await user.click(
      screen.getByRole("combobox", { name: "Add an output to Comms B" }),
    );
    expect(screen.queryByRole("option", { name: "Output 1" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(14);
    await user.click(screen.getByRole("option", { name: "Output 12" }));

    // Removing Feed 1's only output is flagged before saving.
    await user.click(
      screen.getByRole("button", { name: "Remove output 1 from Feed 1" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Feed 1 needs an output.",
    );
    // Keyboard operation: focus the dropdown and open it with Enter.
    screen.getByRole("combobox", { name: "Add an output to Feed 1" }).focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("option", { name: "Output 3" }));
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save showfile" }));
    expect(await screen.findByText("Revision 3")).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/v1/showfile" && init?.method === "PUT",
    );
    expect(
      JSON.parse(String(saveCall?.[1]?.body)).hostOutput.feeds.map(
        ({
          name,
          outputChannels,
        }: {
          name: string;
          outputChannels: number[];
        }) => [name, outputChannels],
      ),
    ).toEqual([
      ["Feed 1", [3]],
      ["Comms B", [2, 12]],
    ]);

    // Removing every feed returns the production to the node's default.
    await user.click(screen.getByRole("button", { name: "Remove feed 2" }));
    await user.click(screen.getByRole("button", { name: "Remove feed 1" }));
    await user.click(screen.getByRole("button", { name: "Save showfile" }));
    expect(await screen.findByText("Revision 4")).toBeTruthy();
    const lastSave = fetchMock.mock.calls
      .filter(
        ([path, init]) =>
          String(path) === "/api/v1/showfile" && init?.method === "PUT",
      )
      .at(-1);
    expect(JSON.parse(String(lastSave?.[1]?.body))).not.toHaveProperty(
      "hostOutput",
    );
  });
});
