import { useEffect, useState } from "react";
import type { HostOutput, Showfile } from "@rvlt/pulse-protocol/http";
import { loadHostOutput, parseOutputChannelsText } from "../showfile";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

const HOST_OUTPUT_REFRESH_MS = 2_000;

/** What the node is doing with its host output right now, in one line. */
function hostOutputStatus(state: HostOutput | null | "unavailable"): string {
  if (state === null) return "Reading the node's host output.";
  if (state === "unavailable")
    return "The node's host output state is unknown.";
  if (!state.output) {
    return "This node has no host output device. Choose one in the Pulse app window.";
  }
  return `${state.output.deviceName}${state.output.simulated ? " (simulated)" : ""}: ${state.output.detail}`;
}

export function ShowTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  // What the operator is typing; null shows the saved value.
  const [channelsDraft, setChannelsDraft] = useState<string | null>(null);
  const [hostOutput, setHostOutput] = useState<
    HostOutput | null | "unavailable"
  >(null);
  const savedChannels = showfile.hostOutput?.outputChannels.join(", ") ?? "";
  const channelsText = channelsDraft ?? savedChannels;
  const parsedChannels = parseOutputChannelsText(channelsText);

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

  function changeChannels(text: string) {
    setChannelsDraft(text);
    const parsed = parseOutputChannelsText(text);
    if ("error" in parsed) return;
    const next: Showfile = { ...showfile };
    if (parsed.channels) {
      next.hostOutput = { outputChannels: parsed.channels };
    } else {
      delete next.hostOutput;
    }
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <CardOverline>Identity</CardOverline>
        <h2 className="mt-1 font-display text-section leading-tight text-foreground">
          Show
        </h2>
        <p className="mt-1 max-w-xl text-caption text-muted-foreground">
          The name saved with this production's showfile.
        </p>
      </div>
      <Table className="max-w-xl">
        <TableBody>
          <TableRow>
            <TableCell className="w-40 font-semibold text-foreground">
              Show name
            </TableCell>
            <TableCell>
              <Input
                id="show-name"
                aria-label="Show name"
                value={showfile.show.name}
                maxLength={120}
                onChange={(event) =>
                  onChange({
                    ...showfile,
                    show: { name: event.target.value },
                  })
                }
              />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="align-top font-semibold text-foreground">
              Host output channels
            </TableCell>
            <TableCell>
              <Input
                id="host-output-channels"
                aria-label="Host output channels"
                aria-describedby="host-output-channels-help"
                aria-invalid={"error" in parsedChannels}
                inputMode="numeric"
                placeholder="Node default"
                value={channelsText}
                maxLength={40}
                onChange={(event) => changeChannels(event.target.value)}
                onBlur={() => {
                  if (!("error" in parsedChannels)) setChannelsDraft(null);
                }}
              />
              {"error" in parsedChannels ? (
                <p role="alert" className="mt-1 text-caption text-out">
                  {parsedChannels.error} Not saved until fixed.
                </p>
              ) : null}
              <p
                id="host-output-channels-help"
                className="mt-1 text-caption text-muted-foreground"
              >
                Where the shared monitor feed plays on the host output device,
                e.g. 12 for DVS output 12. Saved with this production; empty
                uses the node's default. {hostOutputStatus(hostOutput)}
              </p>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Revision
            </TableCell>
            <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
              {showfile.revision}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Channels
            </TableCell>
            <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
              {showfile.channels.length}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Shure receivers
            </TableCell>
            <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
              {showfile.shureReceivers.length}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
