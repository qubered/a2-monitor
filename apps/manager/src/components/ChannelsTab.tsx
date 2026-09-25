import { useRef, useState } from "react";
import {
  Antenna,
  AudioLines,
  Battery,
  ImageOff,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Showfile } from "@rvlt/pulse-protocol/http";
import type { ObservedDevice } from "../showfile";
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

const NONE = "none";
const MIN_TRIM_DB = -24;
const MAX_TRIM_DB = 24;

const MIC_TYPES = [
  { value: "lavalier", label: "Lavalier" },
  { value: "headset", label: "Headset" },
  { value: "handheld", label: "Handheld" },
  { value: "beltpack", label: "Beltpack" },
  { value: "boundary", label: "Boundary" },
  { value: "instrument", label: "Instrument" },
  { value: "other", label: "Other" },
] as const;

/** A handheld transmitter's capsule-and-body silhouette, matching the 2px-stroke Lucide set (§7). */
function HandheldMicIcon(props: { className?: string }) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M12 13v4M8 21h8" />
    </svg>
  );
}

/** A beltpack transmitter's body-and-antenna silhouette, matching the 2px-stroke Lucide set (§7). */
function BeltpackMicIcon(props: { className?: string }) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="8" width="14" height="13" rx="2" />
      <path d="M15 8V6a1 1 0 0 0-1-1h-1V3" />
    </svg>
  );
}

/** The type-derived glyph standing in for a missing photo, or null when the mic type gives no icon. */
function MicTypeIcon({
  micType,
  className,
}: {
  micType: string | null | undefined;
  className?: string;
}) {
  if (micType === "handheld") return <HandheldMicIcon className={className} />;
  if (micType === "beltpack") return <BeltpackMicIcon className={className} />;
  return null;
}

type Channel = Showfile["channels"][number];
type Monitor = NonNullable<Channel["monitor"]>;
type RoomMembership = NonNullable<Channel["rooms"]>[number];

const DEFAULT_MONITOR: Monitor = { battery: true, rf: true, audio: true };

/** One select value for a room membership: "room" or "room/category". */
function membershipValue(membership: RoomMembership): string {
  return membership.categoryId
    ? `${membership.roomId}/${membership.categoryId}`
    : membership.roomId;
}

function membershipOf(value: string): RoomMembership {
  const [roomId, categoryId] = value.split("/");
  return { roomId: roomId!, categoryId: categoryId ?? null };
}

const MAX_IMAGE_DATA_URL_LENGTH = 300000;

const MONITOR_DIMENSIONS = [
  { key: "battery", label: "Battery", icon: Battery },
  { key: "rf", label: "RF", icon: Antenna },
  { key: "audio", label: "Audio", icon: AudioLines },
] as const;

function MonitorToggle({
  position,
  monitor,
  onChange,
}: {
  position: number;
  monitor: Monitor | undefined;
  onChange: (monitor: Monitor) => void;
}) {
  const current = monitor ?? DEFAULT_MONITOR;
  return (
    <div className="flex items-center gap-2">
      {MONITOR_DIMENSIONS.map(({ key, label, icon: Icon }) => {
        const active = current[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            aria-label={`Channel ${position + 1} ${label.toLowerCase()} monitoring`}
            title={`${label} monitoring ${active ? "on" : "off"}`}
            onClick={() => onChange({ ...current, [key]: !active })}
            className={
              "flex size-11 items-center justify-center rounded-full border-2 transition-transform duration-[120ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring active:translate-y-0.5 " +
              (active
                ? "border-ok bg-ok-soft text-ok"
                : "border-line-2 bg-card text-muted-foreground")
            }
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function ChannelImage({
  position,
  imageUrl,
  micType,
  onChange,
}: {
  position: number;
  imageUrl: string | null | undefined;
  micType: string | null | undefined;
  onChange: (imageUrl: string | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile() {
    setError(null);
    fileInput.current?.click();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        setError("Photo is too large. Choose an image under 200 KB.");
        return;
      }
      onChange(dataUrl);
    };
    reader.onerror = () => setError("The photo could not be read.");
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="size-11 shrink-0 rounded-full border-2 border-line-2 object-cover"
          />
        ) : (
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-2 text-muted-foreground"
            title={
              micType === "handheld" || micType === "beltpack"
                ? `No photo · mic type is ${micType}`
                : "No photo"
            }
          >
            {micType === "handheld" || micType === "beltpack" ? (
              <MicTypeIcon micType={micType} className="size-4" />
            ) : (
              <ImageOff className="size-4" aria-hidden="true" />
            )}
          </span>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label={`Channel ${position + 1} photo upload`}
          className="sr-only"
          onChange={handleFileChange}
        />
        <Button type="button" variant="outline" size="sm" onClick={pickFile}>
          <Upload aria-hidden="true" />
          {imageUrl ? "Replace" : "Upload"}
        </Button>
        {imageUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Channel ${position + 1} remove photo`}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {error ? (
        <span role="alert" className="text-badge text-out">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ChannelsTab({
  showfile,
  device,
  onChange,
}: {
  showfile: Showfile;
  device: ObservedDevice | null;
  onChange: (next: Showfile) => void;
}) {
  /** Saves a channel's monitor trim in 0.5 dB steps; empty or 0 means no trim. */
  function commitTrim(position: number, text: string) {
    const parsed = Number(text);
    const trimDb =
      text.trim() === "" || !Number.isFinite(parsed)
        ? 0
        : Math.min(
            MAX_TRIM_DB,
            Math.max(MIN_TRIM_DB, Math.round(parsed * 2) / 2),
          );
    const channels = [...showfile.channels];
    const next = { ...channels[position]! };
    if (trimDb === 0) delete next.trimDb;
    else next.trimDb = trimDb;
    channels[position] = next;
    onChange({ ...showfile, channels });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Channel patch</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Show channels
          </h2>
          <p className="mt-1 font-mono text-caption text-muted-foreground">
            {device
              ? `${device.name} · ${device.channelCount} inputs · ${device.sampleRateHz / 1000} kHz`
              : "Audio input state unknown"}
            {showfile.shureReceivers.length
              ? ` · ${showfile.shureReceivers.length} Shure receiver unit${showfile.shureReceivers.length === 1 ? "" : "s"}`
              : " · Shure receivers not configured"}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            onChange({
              ...showfile,
              channels: [
                ...showfile.channels,
                {
                  inputIndex: null,
                  name: `Channel ${showfile.channels.length + 1}`,
                  shureReceiverId: null,
                  shureChannelIndex: null,
                  micType: null,
                  imageUrl: null,
                  monitor: DEFAULT_MONITOR,
                },
              ],
            })
          }
        >
          Add channel
        </Button>
      </div>

      {showfile.channels.length === 0 ? (
        <EmptyState
          title="No show channels."
          detail="Add a channel, then patch it to an input."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>Photo</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Performer</TableHead>
              {showfile.rooms?.length ? (
                <TableHead>Room · category</TableHead>
              ) : null}
              <TableHead>Mic type</TableHead>
              <TableHead>Audio input</TableHead>
              <TableHead className="min-w-24">Trim (dB)</TableHead>
              <TableHead>Shure channel</TableHead>
              <TableHead>Monitor</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showfile.channels.map((channel, position) => (
              <TableRow key={channel.id ?? `position-${position}`}>
                <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                  {position + 1}
                </TableCell>
                <TableCell className="min-w-44">
                  <ChannelImage
                    position={position}
                    imageUrl={channel.imageUrl}
                    micType={channel.micType}
                    onChange={(imageUrl) => {
                      const channels = [...showfile.channels];
                      channels[position] = { ...channel, imageUrl };
                      onChange({ ...showfile, channels });
                    }}
                  />
                </TableCell>
                <TableCell className="min-w-40">
                  <Input
                    aria-label={`Channel ${position + 1} name`}
                    value={channel.name}
                    maxLength={120}
                    onChange={(event) => {
                      const channels = [...showfile.channels];
                      channels[position] = {
                        ...channel,
                        name: event.target.value,
                      };
                      onChange({ ...showfile, channels });
                    }}
                  />
                </TableCell>
                <TableCell className="min-w-40">
                  <Input
                    aria-label={`Channel ${position + 1} performer`}
                    value={channel.performer ?? ""}
                    placeholder="Not recorded"
                    maxLength={120}
                    onChange={(event) => {
                      const channels = [...showfile.channels];
                      channels[position] = {
                        ...channel,
                        performer: event.target.value || null,
                      };
                      onChange({ ...showfile, channels });
                    }}
                  />
                </TableCell>
                {showfile.rooms?.length ? (
                  <TableCell className="min-w-48">
                    <div className="flex flex-col gap-1">
                      {(channel.rooms ?? []).map(
                        (membership, membershipIndex) => (
                          <div
                            key={membershipIndex}
                            className="flex items-center gap-1"
                          >
                            <Select
                              value={membershipValue(membership)}
                              onValueChange={(value) => {
                                const channels = [...showfile.channels];
                                const rooms = [...(channel.rooms ?? [])];
                                rooms[membershipIndex] = membershipOf(value);
                                channels[position] = { ...channel, rooms };
                                onChange({ ...showfile, channels });
                              }}
                            >
                              <SelectTrigger
                                aria-label={`Channel ${position + 1} room and category ${membershipIndex + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(showfile.rooms ?? []).flatMap((room) =>
                                  room.id
                                    ? [
                                        <SelectItem
                                          key={room.id}
                                          value={room.id}
                                        >
                                          {room.name}
                                        </SelectItem>,
                                        ...room.categories.flatMap(
                                          (category) =>
                                            category.id
                                              ? [
                                                  <SelectItem
                                                    key={`${room.id}/${category.id}`}
                                                    value={`${room.id}/${category.id}`}
                                                  >
                                                    {room.name} ·{" "}
                                                    {category.name}
                                                  </SelectItem>,
                                                ]
                                              : [],
                                        ),
                                      ]
                                    : [],
                                )}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Channel ${position + 1} remove room ${membershipIndex + 1}`}
                              onClick={() => {
                                const channels = [...showfile.channels];
                                const rooms = (channel.rooms ?? []).filter(
                                  (_, index) => index !== membershipIndex,
                                );
                                channels[position] = { ...channel, rooms };
                                onChange({ ...showfile, channels });
                              }}
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </div>
                        ),
                      )}
                      {(() => {
                        const used = new Set(
                          (channel.rooms ?? []).map(({ roomId }) => roomId),
                        );
                        const nextRoom = (showfile.rooms ?? []).find(
                          (room) => room.id && !used.has(room.id),
                        );
                        return (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Channel ${position + 1} add room`}
                            disabled={!nextRoom}
                            onClick={() => {
                              if (!nextRoom?.id) return;
                              const channels = [...showfile.channels];
                              const rooms = [
                                ...(channel.rooms ?? []),
                                { roomId: nextRoom.id, categoryId: null },
                              ];
                              channels[position] = { ...channel, rooms };
                              onChange({ ...showfile, channels });
                            }}
                          >
                            <Plus aria-hidden="true" />
                            Add room
                          </Button>
                        );
                      })()}
                    </div>
                  </TableCell>
                ) : null}
                <TableCell className="min-w-36">
                  <Select
                    value={channel.micType ?? NONE}
                    onValueChange={(value) => {
                      const channels = [...showfile.channels];
                      channels[position] = {
                        ...channel,
                        micType:
                          value === NONE
                            ? null
                            : (value as NonNullable<Channel["micType"]>),
                      };
                      onChange({ ...showfile, channels });
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Channel ${position + 1} mic type`}
                    >
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {MIC_TYPES.map((micType) => (
                        <SelectItem key={micType.value} value={micType.value}>
                          {micType.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="min-w-44">
                  <Select
                    value={
                      channel.inputIndex === null
                        ? NONE
                        : String(channel.inputIndex)
                    }
                    onValueChange={(value) => {
                      const channels = [...showfile.channels];
                      channels[position] = {
                        ...channel,
                        inputIndex: value === NONE ? null : Number(value),
                      };
                      onChange({ ...showfile, channels });
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Channel ${position + 1} audio input`}
                    >
                      <SelectValue placeholder="Not patched" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not patched</SelectItem>
                      {!device && channel.inputIndex !== null ? (
                        <SelectItem value={String(channel.inputIndex)}>
                          Input {channel.inputIndex + 1} · device not running
                        </SelectItem>
                      ) : null}
                      {device?.channels.map((input) => (
                        <SelectItem
                          key={input.index}
                          value={String(input.index)}
                          disabled={showfile.channels.some(
                            (other, index) =>
                              index !== position &&
                              other.inputIndex === input.index,
                          )}
                        >
                          Input {input.index + 1} · {input.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="min-w-24">
                  <Input
                    className="min-w-20"
                    key={`${channel.id ?? position}:${channel.trimDb ?? ""}`}
                    aria-label={`Channel ${position + 1} monitor trim in dB`}
                    type="number"
                    inputMode="decimal"
                    min={MIN_TRIM_DB}
                    max={MAX_TRIM_DB}
                    step={0.5}
                    placeholder="0"
                    defaultValue={channel.trimDb ?? ""}
                    onBlur={(event) => commitTrim(position, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </TableCell>
                <TableCell className="min-w-44">
                  <Select
                    value={
                      channel.shureReceiverId != null &&
                      channel.shureChannelIndex != null
                        ? `${channel.shureReceiverId}:${channel.shureChannelIndex}`
                        : NONE
                    }
                    onValueChange={(value) => {
                      const channels = [...showfile.channels];
                      if (value === NONE) {
                        channels[position] = {
                          ...channel,
                          shureReceiverId: null,
                          shureChannelIndex: null,
                        };
                      } else {
                        const separator = value.lastIndexOf(":");
                        channels[position] = {
                          ...channel,
                          shureReceiverId: value.slice(0, separator),
                          shureChannelIndex: Number(value.slice(separator + 1)),
                        };
                      }
                      onChange({ ...showfile, channels });
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Channel ${position + 1} Shure channel`}
                    >
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {showfile.shureReceivers.flatMap((receiver) =>
                        Array.from(
                          { length: receiver.channelCount },
                          (_, receiverChannelIndex) => (
                            <SelectItem
                              key={`${receiver.id}:${receiverChannelIndex}`}
                              value={`${receiver.id}:${receiverChannelIndex}`}
                              disabled={showfile.channels.some(
                                (other, index) =>
                                  index !== position &&
                                  other.shureReceiverId === receiver.id &&
                                  other.shureChannelIndex ===
                                    receiverChannelIndex,
                              )}
                            >
                              {receiver.name} · channel{" "}
                              {receiverChannelIndex + 1}
                            </SelectItem>
                          ),
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <MonitorToggle
                    position={position}
                    monitor={channel.monitor}
                    onChange={(monitor) => {
                      const channels = [...showfile.channels];
                      channels[position] = { ...channel, monitor };
                      onChange({ ...showfile, channels });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label={`Remove channel ${position + 1}`}
                    onClick={() =>
                      onChange({
                        ...showfile,
                        channels: showfile.channels.filter(
                          (_, index) => index !== position,
                        ),
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
