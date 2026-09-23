import { useEffect, useMemo, useState } from "react";
import type { LiveStateChannel as Channel } from "@rvlt/pulse-protocol/http";
import {
  loadChecks,
  micCheckDimensions,
  progressFor,
  recordCheck,
  type MicCheckProgress,
  type MicCheckVerdict,
} from "../mic-check";

type MicCheckProps = {
  channel: Channel;
  onClose: () => void;
};

type Sync = "loading" | "ready" | "saving" | "error";

function readName(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function MicCheck({ channel, onClose }: MicCheckProps) {
  const [operatorName, setOperatorName] = useState(() =>
    readName("pulse-operator-name"),
  );
  const [a1Name, setA1Name] = useState(() => readName("pulse-a1-name"));
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<MicCheckProgress>({});
  const [stale, setStale] = useState(false);
  const [sync, setSync] = useState<Sync>("loading");
  const [syncError, setSyncError] = useState<string | null>(null);
  const firstOpen = useMemo(
    () =>
      micCheckDimensions.findIndex(
        ({ id }) => progress[id]?.verdict !== "pass",
      ),
    [progress],
  );
  const [step, setStep] = useState(0);
  const dimension = micCheckDimensions[step] ?? micCheckDimensions[0]!;
  const currentRecord = progress[dimension.id];
  const completed = micCheckDimensions.filter(
    ({ id }) => progress[id]?.verdict === "pass",
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    loadChecks(fetch, controller.signal)
      .then((checks) => {
        const shared = progressFor(checks, channel.id);
        setProgress(shared.progress);
        setStale(shared.stale);
        setSync("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSync("error");
        setSyncError(
          error instanceof Error
            ? error.message
            : "Checks could not be loaded.",
        );
      });
    return () => controller.abort();
  }, [channel.id]);

  function begin() {
    const trimmedOperator = operatorName.trim();
    if (!trimmedOperator) return;
    setOperatorName(trimmedOperator);
    try {
      window.localStorage.setItem("pulse-operator-name", trimmedOperator);
      if (a1Name.trim()) {
        window.localStorage.setItem("pulse-a1-name", a1Name.trim());
      }
    } catch {
      // Names stay in memory when storage is unavailable.
    }
    setStep(firstOpen === -1 ? 0 : firstOpen);
    setStarted(true);
  }

  async function record(verdict: MicCheckVerdict) {
    const name = dimension.owner === "A1" ? a1Name.trim() : operatorName.trim();
    if (!name && verdict !== "waiting") return;
    const by =
      dimension.owner === "A1" && verdict !== "waiting"
        ? `${name} (A1)`
        : `${operatorName.trim()} (A2)`;
    setSync("saving");
    setSyncError(null);
    try {
      const checks = await recordCheck(channel.id, dimension.id, verdict, by);
      const shared = progressFor(checks, channel.id);
      setProgress(shared.progress);
      setStale(shared.stale);
      setSync("ready");
      if (step < micCheckDimensions.length - 1) setStep(step + 1);
    } catch (error) {
      setSync("error");
      setSyncError(
        error instanceof Error
          ? error.message
          : "The verdict was not recorded.",
      );
    }
  }

  return (
    <section className="mic-check" role="dialog" aria-modal="true">
      <header className="mic-check-header">
        <div>
          <span className="detail-overline">Guided mic check</span>
          <h2>{channel.name}</h2>
          <p>
            Channel {channel.number} ·{" "}
            {channel.performer ?? "performer not recorded"}
          </p>
        </div>
        <div className="mic-check-progress" aria-live="polite">
          <strong>{completed} / 8 passed</strong>
          <button className="line-button" type="button" onClick={onClose}>
            Save and close
          </button>
        </div>
      </header>

      {!started ? (
        <div className="mic-check-start">
          <h3>Who is running this check?</h3>
          <label>
            <span>A2 operator</span>
            <input
              autoFocus
              value={operatorName}
              onChange={(event) => setOperatorName(event.target.value)}
              placeholder="Name"
            />
          </label>
          <label>
            <span>A1 at console</span>
            <input
              value={a1Name}
              onChange={(event) => setA1Name(event.target.value)}
              placeholder="Name for captured-audio verdict"
            />
          </label>
          <button
            className="check-primary"
            type="button"
            disabled={!operatorName.trim() || sync === "loading"}
            onClick={begin}
          >
            Continue check
          </button>
          <p>
            {sync === "loading"
              ? "Loading this channel's shared check."
              : stale
                ? "The patch or performer changed since the last check. The next verdict starts a new check."
                : "Progress is shared with every Pulse device and survives a reload or restart."}
          </p>
        </div>
      ) : (
        <div className="mic-check-step">
          <ol className="check-stepper" aria-label="Check dimensions">
            {micCheckDimensions.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={index === step ? "step" : undefined}
                  data-verdict={progress[item.id]?.verdict ?? "open"}
                  onClick={() => setStep(index)}
                >
                  {index + 1}
                </button>
              </li>
            ))}
          </ol>
          {syncError ? (
            <p className="check-sync-error" role="alert">
              {syncError}
            </p>
          ) : null}
          <div className="check-question">
            <span className="detail-overline">
              Step {step + 1} · {dimension.owner} verdict
            </span>
            <h3>{dimension.label}</h3>
            <p>{dimension.prompt}</p>
            {currentRecord ? (
              <p className="saved-verdict">
                Current: {currentRecord.verdict} · {currentRecord.by}
              </p>
            ) : null}
          </div>
          <div className="check-actions">
            <button
              type="button"
              className="check-fail"
              disabled={sync === "saving"}
              onClick={() => void record("fail")}
            >
              {dimension.owner === "A1" ? "A1 fail" : "Fail"}
            </button>
            {dimension.owner === "A1" ? (
              <button
                type="button"
                className="check-wait"
                disabled={sync === "saving"}
                onClick={() => void record("waiting")}
              >
                Waiting on A1
              </button>
            ) : null}
            <button
              type="button"
              className="check-pass"
              disabled={
                sync === "saving" ||
                (dimension.owner === "A1" && !a1Name.trim())
              }
              onClick={() => void record("pass")}
            >
              {dimension.owner === "A1" ? "A1 pass" : "Pass"}
            </button>
          </div>
          <div className="check-navigation">
            <button
              type="button"
              className="line-button"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="line-button"
              disabled={step === micCheckDimensions.length - 1}
              onClick={() => setStep(step + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
