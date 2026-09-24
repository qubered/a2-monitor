import type { HostOutput } from "@rvlt/pulse-protocol/http";
import {
  describeOutputChannels,
  hostDestination,
  type OutputDestination,
} from "../host-output";

type OutputSheetProps = {
  output: NonNullable<HostOutput["output"]>;
  feeds: HostOutput["feeds"];
  /** What each feed is playing now, by feed id. */
  nowPlaying: Record<string, string>;
  current: OutputDestination | null;
  /** Offered first when it is still available: the last choice on this device. */
  suggested: OutputDestination | null;
  onChoose: (destination: OutputDestination) => void;
  /** Absent on the opening prompt: a choice is required before listening. */
  onClose?: () => void;
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Where this device's monitor audio plays: here, or joined to one of the host
 * output feeds (ADR 0031). Everyone in a feed shares its mix.
 */
export function OutputSheet({
  output,
  feeds,
  nowPlaying,
  current,
  suggested,
  onChoose,
  onClose,
}: OutputSheetProps) {
  const device = `${output.deviceName}${output.simulated ? " (simulated)" : ""}`;
  const options: Array<{
    destination: OutputDestination;
    title: string;
    detail: string;
  }> = [
    {
      destination: "device",
      title: "This device",
      detail:
        "Only you hear it, on this device's headphones or speaker. Your channel, mute and level are yours.",
    },
    ...feeds.map((feed) => ({
      destination: hostDestination(feed.id),
      title: feed.name,
      detail: `${capitalize(describeOutputChannels(feed.outputChannels))} of ${device}. Shared with everyone in ${feed.name}. ${nowPlaying[feed.id] ?? "Nothing selected."}${
        output.status === "ready" ? "" : ` ${output.detail}`
      }`,
    })),
  ];
  const suggestedIndex = options.findIndex(
    ({ destination }) => destination === suggested,
  );
  if (suggestedIndex > 0) {
    options.unshift(...options.splice(suggestedIndex, 1));
  }

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel output-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="output-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onClose) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header>
          <div>
            <span className="detail-overline">Monitor audio</span>
            <h2 id="output-title">Where should audio play?</h2>
            <p>
              Join a host output feed, or listen on this device. You can change
              this later from the header.
            </p>
          </div>
          {onClose ? (
            <button className="line-button" type="button" onClick={onClose}>
              Cancel
            </button>
          ) : null}
        </header>
        <div className="output-options">
          {options.map(({ destination, title, detail }, index) => (
            <button
              key={destination}
              type="button"
              className="output-option"
              aria-pressed={current === destination}
              autoFocus={index === 0}
              onClick={() => onChoose(destination)}
            >
              <strong>{title}</strong>
              <span>{detail}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
