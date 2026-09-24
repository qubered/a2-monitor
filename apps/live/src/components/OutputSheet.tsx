import type { HostOutput } from "@rvlt/pulse-protocol/http";
import { describeOutputChannels, type OutputDestination } from "../host-output";

type OutputSheetProps = {
  output: NonNullable<HostOutput["output"]>;
  current: OutputDestination | null;
  /** Offered first: the last choice on this device, or this device. */
  suggested: OutputDestination;
  onChoose: (destination: OutputDestination) => void;
  /** Absent on the opening prompt: a choice is required before listening. */
  onClose?: () => void;
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where this device's monitor audio plays: here, or on the shared host output (ADR 0029). */
export function OutputSheet({
  output,
  current,
  suggested,
  onChoose,
  onClose,
}: OutputSheetProps) {
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
    {
      destination: "host",
      title: "Host output",
      detail: `${capitalize(describeOutputChannels(output.outputChannels))} of ${output.deviceName}${output.simulated ? " (simulated)" : ""}. Shared: everyone on host output hears and controls the same channel, mute and level.${
        output.status === "ready" ? "" : ` ${output.detail}`
      }`,
    },
  ];
  if (suggested === "host") options.reverse();

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
            <p>You can change this later from the header.</p>
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
