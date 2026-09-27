import { describe, expect, it } from "vitest";
import type { LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { groupChannels } from "./rooms";
import type { Room } from "./sessions";

const channel = (id: string, roomId: string, categoryId: string) =>
  ({ id, rooms: [{ roomId, categoryId }] }) as unknown as LiveStateChannel;

const house: Room = {
  id: "house",
  name: "House",
  categories: [
    { id: "principals", name: "Principals" },
    { id: "band", name: "Band" },
  ],
} as Room;

describe("groupChannels", () => {
  it("leaves the room's name off the headings when the show has one room", () => {
    const groups = groupChannels(
      [channel("a", "house", "principals"), channel("b", "house", "band")],
      [house],
      "all",
    );
    expect(groups.map(({ title }) => title)).toEqual(["Principals", "Band"]);
  });

  it("names the room in every heading when several are shown", () => {
    const annex: Room = { ...house, id: "annex", name: "Annex" } as Room;
    const groups = groupChannels(
      [channel("a", "house", "principals"), channel("b", "annex", "band")],
      [house, annex],
      "all",
    );
    expect(groups.map(({ title }) => title)).toEqual([
      "House · Principals",
      "Annex · Band",
    ]);
  });
});
