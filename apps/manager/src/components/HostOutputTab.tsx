import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { HostOutput, Showfile } from "@rvlt/pulse-protocol/http";
import { loadHostOutput } from "../showfile";
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

type Feed = NonNullable<Showfile["hostOutput"]>["feeds"][number];

const HOST_OUTPUT_REFRESH_MS = 2_000;
const MAX_FEEDS = 8;
const MAX_CHANNELS_PER_FEED = 8;
/** Offered when the device has not reported how many outputs it has. */
const FALLBACK_CHANNEL_COUNT = 64;

function feedId(): string {
  return `feed-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now()}`;
}

function statusVariant(
  state: HostOutput | null | "unavailable",
): BadgeProps["variant"] {
  if (state === null || state === "unavailable" || !state.output) {
    return "neutral";
  }
  return state.output.status === "ready"
    ? "ok"
    : state.output.status === "error"
      ? "out"
      : "warn";
}

function statusText(state: HostOutput | null | "unavailable"): string {
  if (state === null) return "Reading the node's host output.";
  if (state === "unavailable")
    return "The node's host output state is unknown.";
  if (!state.output) {
    return "This node has no host output device. Choose one in the Pulse app window.";
  }
  return `${state.output.deviceName}${state.output.simulated ? " (simulated)" : ""}: ${state.output.detail}`;
}

/** What would make the backend refuse these feeds, in operator terms. */
function problems(feeds: readonly Feed[]): string[] {
  const found: string[] = [];
  const names = feeds.map(({ name }) => name.trim().toLowerCase());
  if (names.some((name) => name.length === 0)) {
    found.push("Every feed needs a name.");
  }
  if (new Set(names).size !== names.length) {
    found.push("Each feed needs a different name.");
  }
  for (const feed of feeds) {
    if (feed.outputChannels.length === 0) {
      found.push(`${feed.name.trim() || "A feed"} needs an output.`);
    }
  }
  return found;
}

/**
 * Host output feeds for this production (ADR 0031): each is one shared mix
 * that Live operators join by name, played on its own outputs of the node's
 * host output device (for example DVS outputs routed to comms channels).
 */
export function HostOutputTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  const [hostOutput, setHostOutput] = useState<
    HostOutput | null | "unavailable"
  >(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      loadHostOutput(controller.signal).then(setHostOutput, () => {
        if (!controller.signal.aborted) setHostOutput("unavailable");
      });
    void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      HOST_OUTPUT_REFRESH_MS,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const feeds = showfile.hostOutput?.feeds ?? [];
  const reported =
    hostOutput !== null && hostOutput !== "unavailable"
      ? (hostOutput.output?.channelCount ?? null)
      : null;
  const channelCount = reported ?? FALLBACK_CHANNEL_COUNT;
  const used = new Set(feeds.flatMap(({ outputChannels }) => outputChannels));
  const free = Array.from(
    { length: channelCount },
    (_, index) => index + 1,
  ).filter((channel) => !used.has(channel));
  const found = problems(feeds);
  const nodeDefault =
    hostOutput !== null &&
    hostOutput !== "unavailable" &&
    hostOutput.output &&
    feeds.length === 0
      ? hostOutput.feeds[0]
      : undefined;

  function save(next: Feed[]) {
    const updated: Showfile = { ...showfile };
    if (next.length) updated.hostOutput = { feeds: next };
    else delete updated.hostOutput;
    onChange(updated);
  }

  function update(position: number, change: Partial<Feed>) {
    save(
      feeds.map((feed, index) =>
        index === position ? { ...feed, ...change } : feed,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Monitor output</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Host output feeds
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Each feed is one shared mix. Operators join a feed by name in Live
            and hear it on its outputs, for example DVS output 1 routed to comms
            A. Everyone in a feed shares its channel, mute and level.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(hostOutput)}>
              {hostOutput !== null &&
              hostOutput !== "unavailable" &&
              hostOutput.output
                ? hostOutput.output.status
                : "unknown"}
            </Badge>
            <span className="text-caption text-muted-foreground">
              {statusText(hostOutput)}
              {reported === null
                ? ` Output numbers up to ${FALLBACK_CHANNEL_COUNT} are offered until the device reports its outputs.`
                : ""}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          disabled={feeds.length >= MAX_FEEDS || free.length === 0}
          onClick={() =>
            save([
              ...feeds,
              {
                id: feedId(),
                name: `Feed ${feeds.length + 1}`,
                outputChannels: free.slice(0, 1),
              },
            ])
          }
        >
          Add feed
        </Button>
      </div>

      {found.length ? (
        <div
          role="alert"
          className="max-w-xl rounded-md border border-out bg-out-soft px-4 py-3 text-ui text-out"
        >
          {found.join(" ")} Not saved until fixed.
        </div>
      ) : null}

      {feeds.length === 0 ? (
        <EmptyState
          title="No feeds for this production."
          detail={
            nodeDefault
              ? `The node's default is used: one feed, ${nodeDefault.name}, on output ${nodeDefault.outputChannels.join(" + ")}. Add a feed to choose outputs here.`
              : "The node's default single feed is used. Add a feed to choose outputs here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Feed name</TableHead>
              <TableHead>Outputs</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feeds.map((feed, position) => (
              <TableRow key={feed.id}>
                <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                  {position + 1}
                </TableCell>
                <TableCell className="min-w-40">
                  <Input
                    aria-label={`Feed ${position + 1} name`}
                    value={feed.name}
                    maxLength={60}
                    onChange={(event) =>
                      update(position, { name: event.target.value })
                    }
                  />
                </TableCell>
                <TableCell className="min-w-56">
                  <div className="flex flex-wrap items-center gap-2">
                    {feed.outputChannels.map((channel) => (
                      <span
                        key={channel}
                        className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-card py-1 pl-3 pr-1 font-mono text-table tabular-nums text-foreground"
                      >
                        Output {channel}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove output ${channel} from ${feed.name || `feed ${position + 1}`}`}
                          onClick={() =>
                            update(position, {
                              outputChannels: feed.outputChannels.filter(
                                (value) => value !== channel,
                              ),
                            })
                          }
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </span>
                    ))}
                    {feed.outputChannels.length < MAX_CHANNELS_PER_FEED &&
                    free.length > 0 ? (
                      <Select
                        value=""
                        onValueChange={(value) =>
                          update(position, {
                            outputChannels: [
                              ...feed.outputChannels,
                              Number(value),
                            ],
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-40"
                          aria-label={`Add an output to ${feed.name || `feed ${position + 1}`}`}
                        >
                          <SelectValue placeholder="Add output" />
                        </SelectTrigger>
                        <SelectContent>
                          {free.map((channel) => (
                            <SelectItem key={channel} value={String(channel)}>
                              Output {channel}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label={`Remove feed ${position + 1}`}
                    onClick={() =>
                      save(feeds.filter(({ id }) => id !== feed.id))
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
