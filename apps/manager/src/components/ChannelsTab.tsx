import { Trash2 } from "lucide-react";
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

export function ChannelsTab({
  showfile,
  device,
  onChange,
}: {
  showfile: Showfile;
  device: ObservedDevice | null;
  onChange: (next: Showfile) => void;
}) {
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
              <TableHead>Name</TableHead>
              <TableHead>Audio input</TableHead>
              <TableHead>Shure channel</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showfile.channels.map((channel, position) => (
              <TableRow key={position}>
                <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                  {position + 1}
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
