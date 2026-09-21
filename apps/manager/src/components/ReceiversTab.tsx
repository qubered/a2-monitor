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
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardOverline,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] gap-4">
          {showfile.shureReceivers.map((receiver, position) => {
            const observed = shure?.receivers.find(
              ({ id }) => id === receiver.id,
            );
            return (
              <Card key={receiver.id}>
                <CardHeader>
                  <div className="flex flex-col gap-1">
                    <CardOverline>Receiver {position + 1}</CardOverline>
                    <CardTitle>{receiver.name || "Unnamed receiver"}</CardTitle>
                  </div>
                  <Badge
                    variant={
                      observed ? statusVariant(observed.status) : "neutral"
                    }
                  >
                    {observed
                      ? `${observed.status} · ${observed.model ?? "model unknown"}`
                      : "Save to connect"}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 flex flex-col gap-2">
                      <Label htmlFor={`receiver-${receiver.id}-name`}>
                        Unit name
                      </Label>
                      <Input
                        id={`receiver-${receiver.id}-name`}
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
                    </div>
                    <div className="col-span-2 flex flex-col gap-2">
                      <Label htmlFor={`receiver-${receiver.id}-model`}>
                        Model
                      </Label>
                      <Select
                        value={receiver.model}
                        onValueChange={(value) => {
                          const model = value as ShureReceiverModel;
                          const info = SHURE_MODEL_INFO[model];
                          const shureReceivers = [...showfile.shureReceivers];
                          shureReceivers[position] = {
                            ...receiver,
                            model,
                            channelCount: info.dynamicChannelCount
                              ? Math.min(
                                  Math.max(receiver.channelCount, 1),
                                  info.maxChannelCount,
                                )
                              : info.defaultChannelCount,
                          };
                          onChange({ ...showfile, shureReceivers });
                        }}
                      >
                        <SelectTrigger
                          id={`receiver-${receiver.id}-model`}
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
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`receiver-${receiver.id}-host`}>
                        Control IP
                      </Label>
                      <Input
                        id={`receiver-${receiver.id}-host`}
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
                    </div>
                    {SHURE_MODEL_INFO[receiver.model as ShureReceiverModel]
                      ?.dynamicChannelCount ? (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`receiver-${receiver.id}-count`}>
                          Channels
                        </Label>
                        <Input
                          id={`receiver-${receiver.id}-count`}
                          aria-label={`Receiver ${position + 1} channel count`}
                          type="number"
                          min={1}
                          max={
                            SHURE_MODEL_INFO[
                              receiver.model as ShureReceiverModel
                            ].maxChannelCount
                          }
                          value={receiver.channelCount}
                          onChange={(event) => {
                            const info =
                              SHURE_MODEL_INFO[
                                receiver.model as ShureReceiverModel
                              ];
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
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Label>Channels</Label>
                        <span className="min-h-11 content-center font-mono text-caption text-muted-foreground">
                          {receiver.channelCount} channel
                          {receiver.channelCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
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
                    Remove
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
