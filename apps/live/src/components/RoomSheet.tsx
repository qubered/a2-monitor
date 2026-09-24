import { roomTone, type RoomChoice, type RoomOption } from "../rooms";

type RoomSheetProps = {
  options: readonly RoomOption[];
  current: RoomChoice;
  onChoose: (room: RoomChoice) => void;
  onClose: () => void;
};

function attention(option: RoomOption): string {
  if (option.critical > 0) return `${option.critical} critical`;
  if (option.outstanding > 0) return `${option.outstanding} to acknowledge`;
  if (option.seen > 0) return `${option.seen} seen`;
  return "Clear";
}

/**
 * Which room this device shows. Every room reports its own state, so an
 * operator can tell where to look before switching (the header alert count
 * stays show-wide).
 */
export function RoomSheet({
  options,
  current,
  onChoose,
  onClose,
}: RoomSheetProps) {
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel output-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header>
          <div>
            <span className="detail-overline">This device shows</span>
            <h2 id="room-title">Room</h2>
          </div>
          <button className="line-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="room-options">
          {options.map((option) => {
            const tone = roomTone(option);
            return (
              <button
                key={option.key}
                type="button"
                className="room-option"
                aria-pressed={current === option.key}
                autoFocus={current === option.key}
                onClick={() => onChoose(option.key)}
              >
                <i className={`room-dot tone-${tone}`} aria-hidden="true" />
                <span className="room-option-main">
                  <strong>{option.label}</strong>
                  <span>
                    {option.channelCount}{" "}
                    {option.channelCount === 1 ? "channel" : "channels"}
                    {option.session ? ` · ${option.session}` : ""}
                  </span>
                </span>
                <span className={`room-attention tone-${tone}`}>
                  {attention(option)}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
