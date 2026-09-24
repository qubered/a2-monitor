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

  it("turns one saved host output channel list into one session", () => {
    const migrated = migrateShowfile({
      ...base,
      hostOutput: { outputChannels: [12] },
    });
    expect(migrated).toMatchObject({
      hostOutput: {
        sessions: [
          { id: "default", name: "Host output", outputChannels: [12] },
        ],
      },
    });
    expect(validateShowfile(migrated)).toBe(true);
  });

  it("leaves sessions and showfiles without host output as they are", () => {
    const sessions = {
      sessions: [{ id: "hs-a", name: "Comms A", outputChannels: [1] }],
    };
    expect(migrateShowfile({ ...base, hostOutput: sessions })).toMatchObject({
      hostOutput: sessions,
    });
    expect(migrateShowfile(base)).not.toHaveProperty("hostOutput");
  });
});
