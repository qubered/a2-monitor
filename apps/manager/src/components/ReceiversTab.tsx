import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { Showfile, ShureTelemetry } from "@rvlt/pulse-protocol/http";
import {
  SHURE_MODEL_INFO,
  SHURE_RECEIVER_MODELS,
  type ShureReceiverModel,
} from "@rvlt/pulse-protocol/shure-models";
import { SENNHEISER_MODEL_INFO } from "@rvlt/pulse-protocol/sennheiser-models";
import {
  clearReceiverPassword,
  loadReceiverPasswords,
  setReceiverPassword,
} from "../showfile";
import { EmptyState } from "./EmptyState";
import { Badge, type BadgeProps } from "./ui/badge";
import { Button } from "./ui/button";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
/** Shure and EW-DX receivers together; the fleet telemetry carries at most 64. */
const MAX_RECEIVERS = 64;
const EWDX = SENNHEISER_MODEL_INFO["EW-DX EM 2 Dante"];
/** How often the status column re-reads the node while this tab is open. */
const STATUS_REFRESH_MS = 5_000;

type ShureReceiver = Showfile["shureReceivers"][number];
type SennheiserReceiver = NonNullable<Showfile["sennheiserReceivers"]>[number];
type Row =
  | { vendor: "shure"; receiver: ShureReceiver }
  | { vendor: "sennheiser"; receiver: SennheiserReceiver };

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

/** A channel binding that no longer fits the receiver's channel count is dropped. */
function unbindBeyond(
  channels: Showfile["channels"],
  id: string,
  channelCount: number,
): Showfile["channels"] {
  return channels.map((channel) =>
    channel.shureReceiverId === id &&
    channel.shureChannelIndex != null &&
    channel.shureChannelIndex >= channelCount
      ? { ...channel, shureReceiverId: null, shureChannelIndex: null }
      : channel,
  );
}

export function ReceiversTab({
  showfile,
  shure,
  onChange,
  onRefreshStatus,
}: {
  showfile: Showfile;
  shure: ShureTelemetry | null;
  onChange: (next: Showfile) => void;
  /** Re-reads receiver status from the node; called while this tab is open. */
  onRefreshStatus?: () => void;
}) {
  const sennheiserReceivers = showfile.sennheiserReceivers ?? [];
  const rows: Row[] = [
    ...showfile.shureReceivers.map((receiver): Row => ({
      vendor: "shure",
      receiver,
    })),
    ...sennheiserReceivers.map((receiver): Row => ({
      vendor: "sennheiser",
      receiver,
    })),
  ];
  const atLimit = rows.length >= MAX_RECEIVERS;
  const hasEwdx = sennheiserReceivers.length > 0;

  // Which receivers have a password. Null until known; the passwords
  // themselves are never sent back to the browser.
  const [configured, setConfigured] = useState<ReadonlySet<string> | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    loadReceiverPasswords(controller.signal)
      .then((ids) => setConfigured(new Set(ids)))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const refreshStatus = useRef(onRefreshStatus);
  useEffect(() => {
    refreshStatus.current = onRefreshStatus;
  });
  useEffect(() => {
    const timer = setInterval(
      () => refreshStatus.current?.(),
      STATUS_REFRESH_MS,
    );
    return () => clearInterval(timer);
  }, []);

  /**
   * Replaces a receiver with `next`, or removes it when `next` is null. A
   * receiver that keeps its vendor keeps its place; one that changes vendor
   * moves to the end of its new group. Its id never changes, so channel
   * bindings follow it.
   */
  function replace(row: Row, next: Row | null, channels = showfile.channels) {
    const id = row.receiver.id;
    const swap = <T extends { id: string }>(
      list: readonly T[],
      replacement: T | null,
    ): T[] =>
      replacement
        ? list.map((item) => (item.id === id ? replacement : item))
        : list.filter((item) => item.id !== id);
    const shureReceivers =
      next?.vendor === "shure" && row.vendor === "shure"
        ? swap(showfile.shureReceivers, next.receiver)
        : next?.vendor === "shure"
          ? [...showfile.shureReceivers, next.receiver]
          : swap(showfile.shureReceivers, null);
    const sennheiser =
      next?.vendor === "sennheiser" && row.vendor === "sennheiser"
        ? swap(sennheiserReceivers, next.receiver)
        : next?.vendor === "sennheiser"
          ? [...sennheiserReceivers, next.receiver]
          : swap(sennheiserReceivers, null);
    onChange({
      ...showfile,
      shureReceivers,
      sennheiserReceivers: sennheiser,
      channels,
    });
  }

  function change(row: Row, patch: { name?: string; host?: string }) {
    replace(row, {
      ...row,
      receiver: { ...row.receiver, ...patch },
    } as Row);
  }

  function setModel(row: Row, model: string) {
    const id = row.receiver.id;
    const { name, host } = row.receiver;
    if (model === EWDX.model) {
      const next: Row = {
        vendor: "sennheiser",
        receiver: { id, name, host, model: EWDX.model, channelCount: 2 },
      };
      replace(
        row,
        next,
        unbindBeyond(showfile.channels, id, EWDX.channelCount),
      );
      return;
    }
    const shureModel = model as ShureReceiverModel;
    const info = SHURE_MODEL_INFO[shureModel];
    const previous =
      row.vendor === "shure"
        ? row.receiver.channelCount
        : info.defaultChannelCount;
    const channelCount = info.dynamicChannelCount
      ? Math.min(Math.max(previous, 1), info.maxChannelCount)
      : info.defaultChannelCount;
    replace(
      row,
      {
        vendor: "shure",
        receiver: { id, name, host, model: shureModel, channelCount },
      },
      unbindBeyond(showfile.channels, id, channelCount),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Wireless inventory</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Receivers
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Add every receiver unit here, Shure or Sennheiser. Use an explicit
            control-network IP address.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={atLimit}
          onClick={() =>
            onChange({
              ...showfile,
              shureReceivers: [
                ...showfile.shureReceivers,
                {
                  id: receiverId(),
                  name: `Receiver ${rows.length + 1}`,
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

      {rows.length === 0 ? (
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
              <TableHead>Connection</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const position = index + 1;
              const { receiver } = row;
              const observed = shure?.receivers.find(
                ({ id }) => id === receiver.id,
              );
              const shureInfo =
                row.vendor === "shure"
                  ? SHURE_MODEL_INFO[row.receiver.model as ShureReceiverModel]
                  : undefined;
              return (
                <TableRow key={receiver.id}>
                  <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                    {position}
                  </TableCell>
                  <TableCell className="min-w-40">
                    <Input
                      aria-label={`Receiver ${position} name`}
                      value={receiver.name}
                      maxLength={120}
                      onChange={(event) =>
                        change(row, { name: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell className="min-w-48">
                    <Select
                      value={receiver.model}
                      onValueChange={(model) => setModel(row, model)}
                    >
                      <SelectTrigger aria-label={`Receiver ${position} model`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Shure</SelectLabel>
                          {SHURE_RECEIVER_MODELS.map((model) => (
                            <SelectItem key={model} value={model}>
                              {SHURE_MODEL_INFO[model].label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Sennheiser</SelectLabel>
                          <SelectItem value={EWDX.model}>
                            {EWDX.label}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="min-w-36">
                    <Input
                      aria-label={`Receiver ${position} control IP`}
                      value={receiver.host}
                      maxLength={45}
                      onChange={(event) =>
                        change(row, { host: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {shureInfo?.dynamicChannelCount &&
                    row.vendor === "shure" ? (
                      <Input
                        aria-label={`Receiver ${position} channel count`}
                        type="number"
                        min={1}
                        max={shureInfo.maxChannelCount}
                        value={row.receiver.channelCount}
                        onChange={(event) => {
                          const channelCount = Math.max(
                            1,
                            Math.min(
                              shureInfo.maxChannelCount,
                              Number(event.target.value),
                            ),
                          );
                          replace(
                            row,
                            {
                              vendor: "shure",
                              receiver: { ...row.receiver, channelCount },
                            },
                            unbindBeyond(
                              showfile.channels,
                              receiver.id,
                              channelCount,
                            ),
                          );
                        }}
                      />
                    ) : (
                      <span className="font-mono text-table tabular-nums text-muted-foreground">
                        {receiver.channelCount} channel
                        {receiver.channelCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-56 max-w-72">
                    <div className="flex flex-col items-start gap-2">
                      <Badge
                        variant={
                          observed ? statusVariant(observed.status) : "neutral"
                        }
                      >
                        {observed
                          ? `${observed.status} · ${observed.model ?? "model unknown"}`
                          : "Save to connect"}
                      </Badge>
                      {row.vendor === "sennheiser" &&
                      observed &&
                      observed.status !== "ready" ? (
                        <p className="text-caption text-muted-foreground">
                          {observed.detail}
                        </p>
                      ) : null}
                      {row.vendor === "sennheiser" ? (
                        <PasswordControl
                          position={position}
                          receiverId={receiver.id}
                          isSet={
                            configured ? configured.has(receiver.id) : null
                          }
                          onChanged={(isSet) => {
                            setConfigured((current) => {
                              const next = new Set(current ?? []);
                              if (isSet) next.add(receiver.id);
                              else next.delete(receiver.id);
                              return next;
                            });
                            // The node re-reads passwords every couple of
                            // seconds; look again once it has had the chance.
                            setTimeout(() => refreshStatus.current?.(), 2_500);
                          }}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="icon"
                      aria-label={`Remove receiver ${position}`}
                      onClick={() =>
                        replace(
                          row,
                          null,
                          showfile.channels.map((channel) =>
                            channel.shureReceiverId === receiver.id
                              ? {
                                  ...channel,
                                  shureReceiverId: null,
                                  shureChannelIndex: null,
                                }
                              : channel,
                          ),
                        )
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
      {hasEwdx ? (
        <p className="max-w-xl text-caption text-muted-foreground">
          EW-DX receivers are read-only over SSCv2 (firmware 4.0 or later). In
          Sennheiser Control Cockpit, turn on 3rd party access and set a
          password, then enter that password on the receiver&apos;s row. It is
          stored on this Mac and never shown again.
        </p>
      ) : null}
      {atLimit ? (
        <p className="text-caption text-muted-foreground">
          {MAX_RECEIVERS} receivers is the most one show can hold.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One receiver's third-party password: a plain field that saves when you press
 * Enter or leave it. The password goes straight to the backend and is never
 * held after saving; the field can't show what is stored, so its placeholder
 * says only whether one exists.
 */
function PasswordControl({
  position,
  receiverId: id,
  isSet,
  onChanged,
}: {
  position: number;
  receiverId: string;
  isSet: boolean | null;
  onChanged: (isSet: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    failed: boolean;
  } | null>(null);

  async function run(
    work: () => Promise<void>,
    isSetAfter: boolean,
    done: string,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setValue("");
      setVisible(false);
      onChanged(isSetAfter);
      setMessage({ text: done, failed: false });
    } catch (failure) {
      setMessage({
        text: failure instanceof Error ? failure.message : "The change failed.",
        failed: true,
      });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (value.length > 0 && !busy)
      void run(() => setReceiverPassword(id, value), true, "Password saved.");
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Receiver ${position} password`}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={256}
          disabled={busy}
          placeholder={isSet ? "Password set" : "3rd party password"}
          value={value}
          aria-invalid={message?.failed ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
          }}
          onBlur={(event) => {
            // Moving to the show/hide toggle is not leaving the field.
            if (
              !event.currentTarget.parentElement?.contains(event.relatedTarget)
            )
              save();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          // Keep focus in the field so toggling never counts as leaving it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-2 text-caption">
        <span
          role={message?.failed ? "alert" : "status"}
          className={message?.failed ? "text-out" : "text-muted-foreground"}
        >
          {busy
            ? "Saving…"
            : (message?.text ??
              (isSet === false ? "No password yet. Press Enter to save." : ""))}
        </span>
        {isSet && value.length === 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Remove receiver ${position} password`}
            onClick={() =>
              void run(
                () => clearReceiverPassword(id),
                false,
                "Password removed.",
              )
            }
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
