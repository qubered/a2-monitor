import { Trash2 } from "lucide-react";
import type { Showfile, ShureTelemetry } from "@rvlt/pulse-protocol/http";
import {
  SHURE_MODEL_INFO,
  SHURE_RECEIVER_MODELS,
  type ShureReceiverModel,
} from "@rvlt/pulse-protocol/shure-models";
import { EmptyState } from "./EmptyState";
import { Badge, type BadgeProps } from "./ui/badge";
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

function receiverId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `receiver-${Date.now()}`;
}

const DEFAULT_MODEL: ShureReceiverModel = "ULXD4D";

function statusVariant(status: string | undefined): BadgeProps["variant"] {
  switch (status) {
    case "ready":
      return "ok";
    case "connecting":
    case "degraded":
    case "stale":
      return "warn";
    case "error":
      return "out";
    default:
      return "neutral";
  }
}

export function ReceiversTab({
  showfile,
  shure,
  onChange,
}: {
  showfile: Showfile;
  shure: ShureTelemetry | null;
  onChange: (next: Showfile) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Wireless inventory</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Shure receivers
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Add every receiver unit here. Use an explicit control-network IP
            address.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            onChange({
              ...showfile,
              shureReceivers: [
                ...showfile.shureReceivers,
                {
                  id: receiverId(),
                  name: `Receiver ${showfile.shureReceivers.length + 1}`,
                  host: "192.168.1.100",
                  model: DEFAULT_MODEL,
                  channelCount:
                    SHURE_MODEL_INFO[DEFAULT_MODEL].defaultChannelCount,
                },
              ],
            })
          }
        >
          Add receiver
        </Button>
      </div>

      {showfile.shureReceivers.length === 0 ? (
        <EmptyState
          title="No wireless receivers."
          detail="Add a unit to patch its channels."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Unit name</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Control IP</TableHead>
              <TableHead className="w-32">Channels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showfile.shureReceivers.map((receiver, position) => {
              const observed = shure?.receivers.find(
                ({ id }) => id === receiver.id,
              );
              const info =
                SHURE_MODEL_INFO[receiver.model as ShureReceiverModel];
              return (
                <TableRow key={receiver.id}>
                  <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                    {position + 1}
                  </TableCell>
                  <TableCell className="min-w-40">
                    <Input
                      aria-label={`Receiver ${position + 1} name`}
                      value={receiver.name}
                      maxLength={120}
                      onChange={(event) => {
                        const shureReceivers = [...showfile.shureReceivers];
                        shureReceivers[position] = {
                          ...receiver,
                          name: event.target.value,
                        };
                        onChange({ ...showfile, shureReceivers });
                      }}
                    />
                  </TableCell>
                  <TableCell className="min-w-48">
                    <Select
                      value={receiver.model}
                      onValueChange={(value) => {
                        const model = value as ShureReceiverModel;
                        const modelInfo = SHURE_MODEL_INFO[model];
                        const shureReceivers = [...showfile.shureReceivers];
                        shureReceivers[position] = {
                          ...receiver,
                          model,
                          channelCount: modelInfo.dynamicChannelCount
                            ? Math.min(
                                Math.max(receiver.channelCount, 1),
                                modelInfo.maxChannelCount,
                              )
                            : modelInfo.defaultChannelCount,
                        };
                        onChange({ ...showfile, shureReceivers });
                      }}
                    >
                      <SelectTrigger
                        aria-label={`Receiver ${position + 1} model`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHURE_RECEIVER_MODELS.map((model) => (
                          <SelectItem key={model} value={model}>
                            {SHURE_MODEL_INFO[model].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="min-w-36">
                    <Input
                      aria-label={`Receiver ${position + 1} control IP`}
                      value={receiver.host}
                      maxLength={45}
                      onChange={(event) => {
                        const shureReceivers = [...showfile.shureReceivers];
                        shureReceivers[position] = {
                          ...receiver,
                          host: event.target.value,
                        };
                        onChange({ ...showfile, shureReceivers });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {info?.dynamicChannelCount ? (
                      <Input
                        aria-label={`Receiver ${position + 1} channel count`}
                        type="number"
                        min={1}
                        max={info.maxChannelCount}
                        value={receiver.channelCount}
                        onChange={(event) => {
                          const shureReceivers = [...showfile.shureReceivers];
                          shureReceivers[position] = {
                            ...receiver,
                            channelCount: Math.max(
                              1,
                              Math.min(
                                info.maxChannelCount,
                                Number(event.target.value),
                              ),
                            ),
                          };
                          onChange({ ...showfile, shureReceivers });
                        }}
                      />
                    ) : (
                      <span className="font-mono text-table tabular-nums text-muted-foreground">
                        {receiver.channelCount} channel
                        {receiver.channelCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        observed ? statusVariant(observed.status) : "neutral"
                      }
                    >
                      {observed
                        ? `${observed.status} · ${observed.model ?? "model unknown"}`
                        : "Save to connect"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="icon"
                      aria-label={`Remove receiver ${position + 1}`}
                      onClick={() =>
                        onChange({
                          ...showfile,
                          shureReceivers: showfile.shureReceivers.filter(
                            ({ id }) => id !== receiver.id,
                          ),
                          channels: showfile.channels.map((channel) =>
                            channel.shureReceiverId === receiver.id
                              ? {
                                  ...channel,
                                  shureReceiverId: null,
                                  shureChannelIndex: null,
                                }
                              : channel,
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
