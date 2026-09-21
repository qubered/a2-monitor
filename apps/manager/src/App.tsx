import { useEffect, useState } from "react";
import type { Showfile, ShureTelemetry } from "@a2-monitor/protocol/http";
import {
  loadObservedDevice,
  loadShowfile,
  loadShureTelemetry,
  projectShowfileToDevice,
  saveShowfile,
  type ObservedDevice,
} from "./showfile";

type Theme = "system" | "light" | "dark";
type SaveState = "loading" | "saved" | "dirty" | "saving" | "error";

function readTheme(): Theme {
  const saved = window.localStorage.getItem("a2-monitor-theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [showfile, setShowfile] = useState<Showfile | null>(null);
  const [device, setDevice] = useState<ObservedDevice | null>(null);
  const [shure, setShure] = useState<ShureTelemetry | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("Loading showfile and audio inputs.");

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem("a2-monitor-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem("a2-monitor-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadShowfile(controller.signal),
      loadObservedDevice(controller.signal),
      loadShureTelemetry(controller.signal).catch(() => null),
    ])
      .then(([loaded, observed, receiver]) => {
        const projected = projectShowfileToDevice(loaded, observed);
        const changed =
          loaded.device?.name !== projected.device?.name ||
          loaded.device?.channelCount !== projected.device?.channelCount ||
          JSON.stringify(loaded.channels) !==
            JSON.stringify(projected.channels);
        setDevice(observed);
        setShure(receiver);
        setShowfile(projected);
        setSaveState(changed ? "dirty" : "saved");
        setMessage(
          changed
            ? "Observed inputs are ready. Save this showfile to bind their names."
            : "Showfile loaded from this Mac.",
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSaveState("error");
        setMessage(
          error instanceof Error ? error.message : "Manager could not start.",
        );
      });
    return () => controller.abort();
  }, []);

  function update(next: Showfile) {
    setShowfile(next);
    setSaveState("dirty");
    setMessage("Unsaved changes.");
  }

  async function save() {
    if (!showfile || saveState === "saving") return;
    setSaveState("saving");
    setMessage("Saving showfile on this Mac.");
    try {
      const saved = await saveShowfile(showfile);
      setShowfile(saved);
      setSaveState("saved");
      setMessage("Showfile saved. Live now uses these channel names.");
    } catch (error) {
      setSaveState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The showfile could not be saved.",
      );
    }
  }

  return (
    <div className="manager-app">
      <header className="app-header">
        <div className="brand" aria-label="A2 Monitor Manager">
          <span aria-hidden="true">▲</span>
          <strong>A2</strong> <b>Monitor</b>
          <em>Manager</em>
        </div>
        <div className="draft-name">
          <span>Local showfile</span>
          <strong>{showfile?.show.name ?? "Waiting"}</strong>
        </div>
        <a className="line-button live-link" href="/">
          Open Live
        </a>
        <label className="theme-picker">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Paper</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>

      <section className={`connection-notice state-${saveState}`} role="status">
        <div>
          <strong>
            {saveState === "loading"
              ? "Loading showfile."
              : saveState === "saving"
                ? "Saving showfile."
                : saveState === "saved"
                  ? "Showfile saved."
                  : saveState === "dirty"
                    ? "Showfile has unsaved changes."
                    : "Showfile unavailable."}
          </strong>
          <span>{message}</span>
        </div>
        {showfile ? (
          <span className="revision-badge">Revision {showfile.revision}</span>
        ) : null}
      </section>

      <main>
        <section className="page-heading" aria-labelledby="showfile-title">
          <div>
            <span className="overline">Show setup</span>
            <h1 id="showfile-title">Build a showfile</h1>
            <p>
              Add the channels you use, name them, then patch each one to a
              physical audio input and optional Shure receiver channel.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={
              !showfile || saveState === "saving" || saveState === "saved"
            }
            onClick={() => void save()}
          >
            {saveState === "saving" ? "Saving" : "Save showfile"}
          </button>
        </section>

        {showfile ? (
          <form
            className="showfile-editor"
            onSubmit={(event) => event.preventDefault()}
          >
            <section
              className="show-details"
              aria-labelledby="show-details-title"
            >
              <div>
                <span className="overline">Identity</span>
                <h2 id="show-details-title">Show</h2>
              </div>
              <label>
                <span>Show name</span>
                <input
                  value={showfile.show.name}
                  maxLength={120}
                  onChange={(event) =>
                    update({ ...showfile, show: { name: event.target.value } })
                  }
                />
              </label>
            </section>

            <section
              className="channel-editor"
              aria-labelledby="channel-editor-title"
            >
              <div className="channel-editor-heading">
                <div>
                  <span className="overline">Channel patch</span>
                  <h2 id="channel-editor-title">Show channels</h2>
                </div>
                <button
                  className="line-button"
                  type="button"
                  onClick={() =>
                    update({
                      ...showfile,
                      channels: [
                        ...showfile.channels,
                        {
                          inputIndex: null,
                          name: `Channel ${showfile.channels.length + 1}`,
                          shureChannelIndex: null,
                        },
                      ],
                    })
                  }
                >
                  Add channel
                </button>
              </div>
              <p className="patch-summary">
                {device
                  ? `${device.name} · ${device.channelCount} inputs · ${device.sampleRateHz / 1000} kHz`
                  : "Audio input state unknown"}
                {shure?.receiver
                  ? ` · Shure ${shure.receiver.model ?? "receiver"} at ${shure.receiver.host}`
                  : " · Shure receiver not configured"}
              </p>
              <div className="channel-name-list">
                {showfile.channels.map((channel, position) => (
                  <div className="channel-name-row" key={position}>
                    <span className="channel-number">{position + 1}</span>
                    <label>
                      <span>Name</span>
                      <input
                        aria-label={`Channel ${position + 1} name`}
                        value={channel.name}
                        maxLength={120}
                        onChange={(event) => {
                          const channels = [...showfile.channels];
                          channels[position] = {
                            ...channel,
                            name: event.target.value,
                          };
                          update({ ...showfile, channels });
                        }}
                      />
                    </label>
                    <label>
                      <span>Audio input</span>
                      <select
                        aria-label={`Channel ${position + 1} audio input`}
                        value={channel.inputIndex ?? ""}
                        onChange={(event) => {
                          const channels = [...showfile.channels];
                          channels[position] = {
                            ...channel,
                            inputIndex:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          };
                          update({ ...showfile, channels });
                        }}
                      >
                        <option value="">Not patched</option>
                        {device?.channels.map((input) => (
                          <option
                            key={input.index}
                            value={input.index}
                            disabled={showfile.channels.some(
                              (other, index) =>
                                index !== position &&
                                other.inputIndex === input.index,
                            )}
                          >
                            Input {input.index + 1} · {input.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Shure channel</span>
                      <select
                        aria-label={`Channel ${position + 1} Shure channel`}
                        value={channel.shureChannelIndex ?? ""}
                        onChange={(event) => {
                          const channels = [...showfile.channels];
                          channels[position] = {
                            ...channel,
                            shureChannelIndex:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          };
                          update({ ...showfile, channels });
                        }}
                      >
                        <option value="">None</option>
                        {shure?.receiver
                          ? shure.channels.map((receiverChannel) => (
                              <option
                                key={receiverChannel.index}
                                value={receiverChannel.index}
                                disabled={showfile.channels.some(
                                  (other, index) =>
                                    index !== position &&
                                    other.shureChannelIndex ===
                                      receiverChannel.index,
                                )}
                              >
                                Receiver {receiverChannel.index + 1}
                              </option>
                            ))
                          : null}
                      </select>
                    </label>
                    <button
                      className="remove-channel"
                      type="button"
                      aria-label={`Remove channel ${position + 1}`}
                      onClick={() =>
                        update({
                          ...showfile,
                          channels: showfile.channels.filter(
                            (_, index) => index !== position,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {showfile.channels.length === 0 ? (
                  <div className="empty-state">
                    <strong>No show channels.</strong>
                    <span>Add a channel, then patch it to an input.</span>
                  </div>
                ) : null}
              </div>
            </section>
          </form>
        ) : (
          <section className="empty-state">
            <strong>No editable showfile.</strong>
            <span>{message}</span>
          </section>
        )}
      </main>
    </div>
  );
}
