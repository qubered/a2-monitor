import { useEffect, useState } from "react";
import type { Showfile, ShureTelemetry } from "@a2-monitor/protocol/http";
import {
  SHURE_MODEL_INFO,
  SHURE_RECEIVER_MODELS,
  type ShureReceiverModel,
} from "@a2-monitor/protocol/shure-models";
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

function receiverId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `receiver-${Date.now()}`;
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
              className="receiver-editor"
              aria-labelledby="receiver-editor-title"
            >
              <div className="channel-editor-heading">
                <div>
                  <span className="overline">Wireless inventory</span>
                  <h2 id="receiver-editor-title">Shure receivers</h2>
                </div>
                <button
                  className="line-button"
                  type="button"
                  onClick={() => {
                    const defaultModel: ShureReceiverModel = "ULXD4D";
                    update({
                      ...showfile,
                      shureReceivers: [
                        ...showfile.shureReceivers,
                        {
                          id: receiverId(),
                          name: `Receiver ${showfile.shureReceivers.length + 1}`,
                          host: "192.168.1.100",
                          model: defaultModel,
                          channelCount:
                            SHURE_MODEL_INFO[defaultModel].defaultChannelCount,
                        },
                      ],
                    });
                  }}
                >
                  Add receiver
                </button>
              </div>
              <p className="patch-summary">
                Add every receiver unit here. Select its exact model, then use
                an explicit control-network IP address.
              </p>
              <div className="receiver-list">
                {showfile.shureReceivers.map((receiver, position) => {
                  const observed = shure?.receivers.find(
                    ({ id }) => id === receiver.id,
                  );
                  return (
                    <div className="receiver-row" key={receiver.id}>
                      <label>
                        <span>Unit name</span>
                        <input
                          aria-label={`Receiver ${position + 1} name`}
                          value={receiver.name}
                          maxLength={120}
                          onChange={(event) => {
                            const shureReceivers = [...showfile.shureReceivers];
                            shureReceivers[position] = {
                              ...receiver,
                              name: event.target.value,
                            };
                            update({ ...showfile, shureReceivers });
                          }}
                        />
                      </label>
                      <label>
                        <span>Model</span>
                        <select
                          aria-label={`Receiver ${position + 1} model`}
                          value={receiver.model}
                          onChange={(event) => {
                            const model = event.target
                              .value as ShureReceiverModel;
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
                            update({ ...showfile, shureReceivers });
                          }}
                        >
                          {SHURE_RECEIVER_MODELS.map((model) => (
                            <option key={model} value={model}>
                              {SHURE_MODEL_INFO[model].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Control IP</span>
                        <input
                          aria-label={`Receiver ${position + 1} control IP`}
                          value={receiver.host}
                          maxLength={45}
                          onChange={(event) => {
                            const shureReceivers = [...showfile.shureReceivers];
                            shureReceivers[position] = {
                              ...receiver,
                              host: event.target.value,
                            };
                            update({ ...showfile, shureReceivers });
                          }}
                        />
                      </label>
                      {SHURE_MODEL_INFO[receiver.model as ShureReceiverModel]
                        ?.dynamicChannelCount ? (
                        <label>
                          <span>Channels</span>
                          <input
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
                              const shureReceivers = [
                                ...showfile.shureReceivers,
                              ];
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
                              update({ ...showfile, shureReceivers });
                            }}
                          />
                        </label>
                      ) : (
                        <span className="receiver-channel-count">
                          {receiver.channelCount} channel
                          {receiver.channelCount === 1 ? "" : "s"}
                        </span>
                      )}
                      <span
                        className={`receiver-status state-${observed?.status ?? "unconfigured"}`}
                      >
                        {observed
                          ? `${observed.status} · ${observed.model ?? "model unknown"}`
                          : "Save to connect"}
                      </span>
                      <button
                        className="remove-channel"
                        type="button"
                        aria-label={`Remove receiver ${position + 1}`}
                        onClick={() =>
                          update({
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
                        Remove
                      </button>
                    </div>
                  );
                })}
                {showfile.shureReceivers.length === 0 ? (
                  <div className="empty-state">
                    <strong>No wireless receivers.</strong>
                    <span>Add a unit to patch its channels.</span>
                  </div>
                ) : null}
              </div>
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
                          shureReceiverId: null,
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
                {showfile.shureReceivers.length
                  ? ` · ${showfile.shureReceivers.length} Shure receiver unit${showfile.shureReceivers.length === 1 ? "" : "s"}`
                  : " · Shure receivers not configured"}
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
                        value={
                          channel.shureReceiverId != null &&
                          channel.shureChannelIndex != null
                            ? `${channel.shureReceiverId}:${channel.shureChannelIndex}`
                            : ""
                        }
                        onChange={(event) => {
                          const channels = [...showfile.channels];
                          const separator = event.target.value.lastIndexOf(":");
                          channels[position] = {
                            ...channel,
                            shureReceiverId:
                              event.target.value === ""
                                ? null
                                : event.target.value.slice(0, separator),
                            shureChannelIndex:
                              event.target.value === ""
                                ? null
                                : Number(
                                    event.target.value.slice(separator + 1),
                                  ),
                          };
                          update({ ...showfile, channels });
                        }}
                      >
                        <option value="">None</option>
                        {showfile.shureReceivers.flatMap((receiver) =>
                          Array.from(
                            { length: receiver.channelCount },
                            (_, receiverChannelIndex) => (
                              <option
                                key={`${receiver.id}:${receiverChannelIndex}`}
                                value={`${receiver.id}:${receiverChannelIndex}`}
                                disabled={showfile.channels.some(
                                  (other, index) =>
                                    index !== position &&
                                    other.shureReceiverId === receiver.id &&
                                    other.shureChannelIndex ===
                                      receiverChannelIndex,
                                )}
                              >
                                {receiver.name} · channel{" "}
                                {receiverChannelIndex + 1}
                              </option>
                            ),
                          ),
                        )}
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
