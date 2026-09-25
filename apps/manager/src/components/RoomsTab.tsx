import { Plus, Trash2 } from "lucide-react";
import type { Showfile } from "@rvlt/pulse-protocol/http";
import { newGroupId } from "../lib/group-id";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/button";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";

type Room = NonNullable<Showfile["rooms"]>[number];

export function RoomsTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  const rooms = showfile.rooms ?? [];

  function setRooms(next: Room[], patch: Partial<Showfile> = {}) {
    onChange({ ...showfile, ...patch, rooms: next });
  }

  function updateRoom(position: number, room: Room) {
    setRooms(rooms.map((entry, index) => (index === position ? room : entry)));
  }

  function removeRoom(position: number) {
    const removed = rooms[position]!.id;
    // Channels and sessions in the room stay; they just leave it.
    setRooms(
      rooms.filter((_, index) => index !== position),
      {
        channels: showfile.channels.map((channel) => ({
          ...channel,
          rooms: (channel.rooms ?? []).filter(
            ({ roomId }) => roomId !== removed,
          ),
        })),
        ...(showfile.sessions
          ? {
              sessions: showfile.sessions.map((session) =>
                session.roomId === removed
                  ? { ...session, roomId: null, channels: [] }
                  : session,
              ),
            }
          : {}),
      },
    );
  }

  function removeCategory(position: number, categoryPosition: number) {
    const room = rooms[position]!;
    const removed = room.categories[categoryPosition]!.id;
    setRooms(
      rooms.map((entry, index) =>
        index === position
          ? {
              ...entry,
              categories: entry.categories.filter(
                (_, categoryIndex) => categoryIndex !== categoryPosition,
              ),
            }
          : entry,
      ),
      {
        channels: showfile.channels.map((channel) => ({
          ...channel,
          rooms: (channel.rooms ?? []).map((entry) =>
            entry.categoryId === removed
              ? { ...entry, categoryId: null }
              : entry,
          ),
        })),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Organisation</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Rooms
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Group channels by the room they are used in, and by category inside
            a room — stage, audience, lectern, band. Each room runs its own
            sessions, and each Live device can show one room. Assign channels in
            the Channels section.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            setRooms([
              ...rooms,
              {
                id: newGroupId("room"),
                name: `Room ${rooms.length + 1}`,
                categories: [],
              },
            ])
          }
        >
          Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <EmptyState
          title="No rooms."
          detail="Without rooms every channel is in one grid and one run of show. Add rooms for multi-room events."
        />
      ) : (
        rooms.map((room, position) => {
          const channelCount = showfile.channels.filter((channel) =>
            (channel.rooms ?? []).some(({ roomId }) => roomId === room.id),
          ).length;
          return (
            <section
              key={room.id ?? `new-${position}`}
              aria-label={`Room ${position + 1}`}
              className="flex flex-col gap-3 rounded-lg border border-card-outline bg-card p-5 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  className="max-w-sm flex-1"
                  aria-label={`Room ${position + 1} name`}
                  value={room.name}
                  maxLength={120}
                  onChange={(event) =>
                    updateRoom(position, { ...room, name: event.target.value })
                  }
                />
                <span className="font-mono text-caption tabular-nums text-muted-foreground">
                  {channelCount} channel{channelCount === 1 ? "" : "s"}
                </span>
                <Button
                  variant="destructive"
                  size="icon"
                  className="ml-auto"
                  aria-label={`Remove room ${room.name || position + 1}`}
                  onClick={() => removeRoom(position)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-caption font-semibold text-muted-foreground">
                  Categories
                </span>
                {room.categories.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    No categories. Channels in this room show under the room
                    name.
                  </p>
                ) : null}
                {room.categories.map((category, categoryPosition) => (
                  <div
                    key={category.id ?? `new-${categoryPosition}`}
                    className="flex items-center gap-2"
                  >
                    <Input
                      className="max-w-sm"
                      aria-label={`${room.name} category ${categoryPosition + 1} name`}
                      value={category.name}
                      maxLength={120}
                      onChange={(event) =>
                        updateRoom(position, {
                          ...room,
                          categories: room.categories.map((entry, index) =>
                            index === categoryPosition
                              ? { ...entry, name: event.target.value }
                              : entry,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove category ${category.name || categoryPosition + 1} from ${room.name}`}
                      onClick={() => removeCategory(position, categoryPosition)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    updateRoom(position, {
                      ...room,
                      categories: [
                        ...room.categories,
                        {
                          id: newGroupId("cat"),
                          name: `Category ${room.categories.length + 1}`,
                        },
                      ],
                    })
                  }
                >
                  <Plus aria-hidden="true" />
                  Add category to {room.name || "this room"}
                </Button>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
