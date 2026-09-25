import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Showfile } from "@rvlt/pulse-protocol/http";
import { minuteToTime, timeToMinute } from "../lib/session-time";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/button";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

type Session = NonNullable<Showfile["sessions"]>[number];

const NO_ROOM = "no-room";

export function SessionsTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  const sessions = showfile.sessions ?? [];
  const [chosen, setChosen] = useState(0);
  const selected = Math.min(chosen, Math.max(sessions.length - 1, 0));
  const session = sessions[selected] ?? null;
  const rooms = showfile.rooms ?? [];
  // A session only uses channels in its own room (or, without a room, the
  // channels in no room).
  const sessionRoom = session?.roomId ?? null;
  const roomChannels = showfile.channels.filter((channel) => {
    const memberships = (channel.rooms ?? []).map(({ roomId }) => roomId);
    return sessionRoom === null
      ? memberships.length === 0
      : memberships.includes(sessionRoom);
  });
  const savedChannels = roomChannels.filter(
    (channel): channel is typeof channel & { id: string } =>
      channel.id !== undefined,
  );
  const unsavedChannels = roomChannels.length - savedChannels.length;

  function setSessions(next: Session[]) {
    onChange({ ...showfile, sessions: next });
  }

  function updateSession(position: number, patch: Partial<Session>) {
    setSessions(
      sessions.map((entry, index) =>
        index === position ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function move(position: number, offset: -1 | 1) {
    const target = position + offset;
    if (target < 0 || target >= sessions.length) return;
    const next = [...sessions];
    [next[position], next[target]] = [next[target]!, next[position]!];
    setSessions(next);
    if (selected === position) setChosen(target);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Run of show</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Sessions
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Each session lists the channels it uses and who presents on them.
            Live starts sessions in order. Channels the running session does not
            list stop alerting for silence, mute and transmitter loss, so
            switched-off handhelds stay quiet between their sessions.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const previous = sessions.at(-1);
            setSessions([
              ...sessions,
              {
                name: `Session ${sessions.length + 1}`,
                ...(previous?.roomId ? { roomId: previous.roomId } : {}),
                startMinute: null,
                // A new session starts from the last one's channels: most
                // turnovers change a presenter or two, not the whole patch.
                channels: previous
                  ? previous.channels.map((c) => ({ ...c }))
                  : [],
              },
            ]);
            setChosen(sessions.length);
          }}
        >
          Add session
        </Button>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions."
          detail="Without sessions Live monitors every channel all the time. Add one per agenda item to run the show by session."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Starts</TableHead>
                <TableHead>Name</TableHead>
                {rooms.length ? <TableHead>Room</TableHead> : null}
                <TableHead className="w-28">Channels</TableHead>
                <TableHead className="w-48">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((entry, position) => (
                <TableRow
                  key={entry.id ?? `new-${position}`}
                  data-state={position === selected ? "selected" : undefined}
                >
                  <TableCell>
                    <Input
                      type="time"
                      aria-label={`Session ${position + 1} start time`}
                      value={minuteToTime(entry.startMinute)}
                      onChange={(event) =>
                        updateSession(position, {
                          startMinute: timeToMinute(event.target.value),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="min-w-48">
                    <Input
                      aria-label={`Session ${position + 1} name`}
                      value={entry.name}
                      maxLength={120}
                      onChange={(event) =>
                        updateSession(position, { name: event.target.value })
                      }
                    />
                  </TableCell>
                  {rooms.length ? (
                    <TableCell className="min-w-40">
                      <Select
                        value={entry.roomId ?? NO_ROOM}
                        onValueChange={(value) =>
                          updateSession(position, {
                            roomId: value === NO_ROOM ? null : value,
                            // Channels belong to one room; a moved session
                            // starts its channel list again.
                            channels: [],
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`Session ${position + 1} room`}
                        >
                          <SelectValue placeholder="No room" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ROOM}>No room</SelectItem>
                          {rooms.flatMap(({ id, name }) =>
                            id ? (
                              <SelectItem key={id} value={id}>
                                {name}
                              </SelectItem>
                            ) : (
                              []
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  ) : null}
                  <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                    {entry.channels.length}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-pressed={position === selected}
                        className="aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper"
                        onClick={() => setChosen(position)}
                      >
                        {position === selected ? "Editing" : "Channels"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move session ${position + 1} earlier`}
                        disabled={position === 0}
                        onClick={() => move(position, -1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move session ${position + 1} later`}
                        disabled={position === sessions.length - 1}
                        onClick={() => move(position, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label={`Remove session ${position + 1}`}
                        onClick={() =>
                          setSessions(
                            sessions.filter((_, index) => index !== position),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {session ? (
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="font-display text-cardhead text-foreground">
                  Channels in {session.name || `session ${selected + 1}`}
                </h3>
                <p className="text-caption text-muted-foreground">
                  A presenter left blank uses the channel&apos;s performer.
                  {unsavedChannels
                    ? ` Save the showfile to use ${unsavedChannels} new channel${unsavedChannels === 1 ? "" : "s"} in sessions.`
                    : ""}
                </p>
              </div>
              {savedChannels.length === 0 ? (
                <EmptyState
                  title="No saved channels."
                  detail={
                    rooms.length
                      ? "Add channels to this session's room in Channels and save the showfile first."
                      : "Add channels and save the showfile first."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">In use</TableHead>
                      <TableHead className="w-14">#</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Presenter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedChannels.map((channel) => {
                      const number = showfile.channels.indexOf(channel) + 1;
                      const entry = session.channels.find(
                        ({ channelId }) => channelId === channel.id,
                      );
                      return (
                        <TableRow key={channel.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="size-5 accent-ok"
                              aria-label={`Use ${channel.name} in ${session.name}`}
                              checked={entry !== undefined}
                              onChange={(event) =>
                                updateSession(selected, {
                                  channels: event.target.checked
                                    ? [
                                        ...session.channels,
                                        {
                                          channelId: channel.id,
                                          presenter: null,
                                        },
                                      ]
                                    : session.channels.filter(
                                        ({ channelId }) =>
                                          channelId !== channel.id,
                                      ),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                            {number}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {channel.name}
                          </TableCell>
                          <TableCell className="min-w-48">
                            <Input
                              aria-label={`${channel.name} presenter in ${session.name}`}
                              value={entry?.presenter ?? ""}
                              placeholder={
                                entry
                                  ? (channel.performer ?? "Not recorded")
                                  : "Not in this session"
                              }
                              maxLength={120}
                              disabled={entry === undefined}
                              onChange={(event) =>
                                updateSession(selected, {
                                  channels: session.channels.map((item) =>
                                    item.channelId === channel.id
                                      ? {
                                          ...item,
                                          presenter: event.target.value || null,
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
