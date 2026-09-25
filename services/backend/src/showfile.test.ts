import { describe, expect, it } from "vitest";
import { migrateShowfile, validateShowfile } from "./showfile.js";

describe("showfile migration", () => {
  const base = {
    schemaVersion: "0",
    revision: 3,
    updatedAtUtc: null,
    show: { name: "Show" },
    device: null,
    shureReceivers: [],
    channels: [],
  };

  it("turns one saved host output channel list into one feed", () => {
    const migrated = migrateShowfile({
      ...base,
      hostOutput: { outputChannels: [12] },
    });
    expect(migrated).toMatchObject({
      hostOutput: {
        feeds: [{ id: "default", name: "Host output", outputChannels: [12] }],
      },
    });
    expect(validateShowfile(migrated)).toBe(true);
  });

  it("renames saved host output sessions to feeds", () => {
    const feeds = [{ id: "hs-a", name: "Comms A", outputChannels: [1] }];
    const migrated = migrateShowfile({
      ...base,
      hostOutput: { sessions: feeds },
    });
    expect(migrated).toMatchObject({ hostOutput: { feeds } });
    expect(validateShowfile(migrated)).toBe(true);
  });

  it("leaves feeds and showfiles without host output as they are", () => {
    const hostOutput = {
      feeds: [{ id: "feed-a", name: "Comms A", outputChannels: [1] }],
    };
    expect(migrateShowfile({ ...base, hostOutput })).toMatchObject({
      hostOutput,
    });
    expect(migrateShowfile(base)).not.toHaveProperty("hostOutput");
  });
});

describe("channel room migration (ADR 0035)", () => {
  const base = {
    schemaVersion: "0",
    revision: 3,
    updatedAtUtc: null,
    show: { name: "Show" },
    device: null,
    shureReceivers: [],
  };

  it("turns one saved roomId/categoryId into a single-entry rooms array", () => {
    const migrated = migrateShowfile({
      ...base,
      channels: [
        {
          id: "ch-a",
          inputIndex: 0,
          name: "Lead",
          roomId: "room-a",
          categoryId: "cat-a",
        },
        {
          id: "ch-b",
          inputIndex: 1,
          name: "Second",
          roomId: null,
          categoryId: null,
        },
      ],
    });
    expect(migrated).toMatchObject({
      channels: [
        { id: "ch-a", rooms: [{ roomId: "room-a", categoryId: "cat-a" }] },
        { id: "ch-b", rooms: [] },
      ],
    });
    // The old fields are gone, not just superseded.
    expect(migrated).not.toHaveProperty(["channels", 0, "roomId"]);
    expect(migrated).not.toHaveProperty(["channels", 0, "categoryId"]);
  });

  it("leaves a channel that already has rooms as it is", () => {
    const channels = [
      {
        id: "ch-a",
        inputIndex: 0,
        name: "Lead",
        rooms: [{ roomId: "room-a", categoryId: null }],
      },
    ];
    expect(migrateShowfile({ ...base, channels })).toMatchObject({ channels });
  });
});

describe("channel monitor trim", () => {
  const showfile = (trimDb: unknown) => ({
    schemaVersion: "0",
    revision: 1,
    updatedAtUtc: null,
    show: { name: "Show" },
    device: null,
    shureReceivers: [],
    channels: [{ inputIndex: 0, name: "Lead", trimDb }],
  });

  it("accepts trims from -24 to +24 dB and refuses more or non-numbers", () => {
    expect(validateShowfile(showfile(-24))).toBe(true);
    expect(validateShowfile(showfile(24))).toBe(true);
    expect(validateShowfile(showfile(3.5))).toBe(true);
    expect(validateShowfile(showfile(24.5))).toBe(false);
    expect(validateShowfile(showfile(-30))).toBe(false);
    expect(validateShowfile(showfile("3"))).toBe(false);
  });
});
