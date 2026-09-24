import {
  formatStartMinute,
  sessionById,
  type SessionState,
  type TurnoverItem,
} from "../sessions";

type SessionSheetProps = {
  session: SessionState;
  roomName?: string | null;
  turnover: readonly TurnoverItem[];
  busy: boolean;
  error: string | null;
  onStart: (sessionId: string | null) => void;
  onShowChannel: (channelId: string) => void;
  onClose: () => void;
};

const TONE_LABEL: Record<TurnoverItem["tone"], string> = {
  ready: "Ready",
  action: "To do",
  unknown: "Unknown",
};

/**
 * The turnover between sessions: every channel the next session needs, what
 * each is waiting on, then the one action that starts it. Starting a session
 * re-arms silence and transmitter-loss alerting for every Live client.
 */
export function SessionSheet({
  session,
  roomName = null,
  turnover,
  busy,
  error,
  onStart,
  onShowChannel,
  onClose,
}: SessionSheetProps) {
  const active = sessionById(session, session.activeId);
  const next = sessionById(session, session.nextId);
  const toPrepare = turnover.filter(({ tone }) => tone !== "ready").length;

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel session-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="detail-overline">
              {roomName ? `${roomName} · ` : ""}
              {active ? `Now · ${active.name}` : "No session running"}
            </span>
            <h2 id="session-title">
              {next ? `Turnover to ${next.name}` : "Run of show"}
            </h2>
            <p>
              {next
                ? toPrepare
                  ? `${toPrepare} of ${turnover.length} channels still need something.`
                  : `All ${turnover.length} channels read ready.`
                : "The last session is running."}
            </p>
          </div>
          <button
            className="line-button"
            type="button"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </header>

        {next ? (
          <section
            className="turnover"
            aria-label={`Channels for ${next.name}`}
          >
            {turnover.length ? (
              <ul>
                {turnover.map(
                  ({ channel, presenterChange, tone, readiness }) => (
                    <li key={channel.id}>
                      <button
                        type="button"
                        className={`turnover-row turnover-${tone}`}
                        onClick={() => onShowChannel(channel.id)}
                        aria-label={`${channel.name}, channel ${channel.number}. ${TONE_LABEL[tone]}: ${readiness}.${presenterChange ? ` Presenter changes to ${presenterChange.to}.` : ""}`}
                      >
                        <span className="turnover-number mono">
                          {String(channel.number).padStart(2, "0")}
                        </span>
                        <span className="turnover-body">
                          <strong>{channel.name}</strong>
                          <span>
                            {presenterChange
                              ? presenterChange.from
                                ? `${presenterChange.from} → ${presenterChange.to}`
                                : `Presenter: ${presenterChange.to}`
                              : (channel.session?.nextPresenter ??
                                "No presenter recorded")}
                          </span>
                        </span>
                        <span className="turnover-state">
                          <b>{TONE_LABEL[tone]}</b>
                          <span>{readiness}</span>
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="turnover-empty">
                {next.name} lists no channels. Add them in Manager.
              </p>
            )}
            <div className="turnover-start">
              <button
                className="control-button primary-button"
                type="button"
                disabled={busy}
                onClick={() => onStart(next.id)}
              >
                {busy ? "Starting" : `Start ${next.name}`}
              </button>
              <span>
                Channels not in {next.name} stop alerting for silence, mute and
                transmitter loss.
              </span>
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="session-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="session-list" aria-label="All sessions">
          <h3>All sessions</h3>
          <ol>
            {session.sessions.map((entry) => {
              const running = entry.id === session.activeId;
              const time = formatStartMinute(entry.startMinute);
              return (
                <li
                  key={entry.id}
                  className={running ? "is-running" : undefined}
                >
                  <span className="mono">{time ?? "—:—"}</span>
                  <span className="session-list-name">
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.channelCount} channel
                      {entry.channelCount === 1 ? "" : "s"}
                      {running
                        ? " · running"
                        : entry.id === session.nextId
                          ? " · next"
                          : ""}
                    </span>
                  </span>
                  {running ? null : (
                    <button
                      className="line-button"
                      type="button"
                      disabled={busy}
                      onClick={() => onStart(entry.id)}
                    >
                      Start
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {active ? (
            <button
              className="line-button session-end"
              type="button"
              disabled={busy}
              onClick={() => onStart(null)}
            >
              End the run of show{roomName ? ` in ${roomName}` : ""}
            </button>
          ) : null}
        </section>
      </section>
    </div>
  );
}
