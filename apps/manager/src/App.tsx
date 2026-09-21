import { useEffect, useState } from "react";
import type { Showfile } from "@a2-monitor/protocol/http";
import {
  loadObservedDevice,
  loadShowfile,
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
    ])
      .then(([loaded, observed]) => {
        const projected = projectShowfileToDevice(loaded, observed);
        const changed =
          loaded.device?.name !== projected.device?.name ||
          loaded.device?.channelCount !== projected.device?.channelCount ||
          loaded.channels.length !== projected.channels.length;
        setDevice(observed);
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
              Name the show and each observed physical input. Saved names appear
              in Live on every connected device.
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
                  <span className="overline">Observed device</span>
                  <h2 id="channel-editor-title">
                    {device?.name ??
                      showfile.device?.name ??
                      "Device unavailable"}
                  </h2>
                </div>
                <span className="device-readout">
                  {device
                    ? `${device.channelCount} inputs · ${device.sampleRateHz / 1000} kHz`
                    : "Input state unknown"}
                </span>
              </div>
              <div className="channel-name-list">
                {showfile.channels.map((channel, position) => (
                  <label className="channel-name-row" key={channel.inputIndex}>
                    <span className="channel-number">
                      {channel.inputIndex + 1}
                    </span>
                    <span className="channel-input">Physical input</span>
                    <input
                      aria-label={`Channel ${channel.inputIndex + 1} name`}
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
                ))}
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
