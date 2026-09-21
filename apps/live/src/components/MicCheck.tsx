import { useMemo, useState } from "react";
import type { LiveChannel as Channel } from "@rvlt/pulse-protocol/http";
import {
  loadMicCheck,
  micCheckDimensions,
  saveMicCheck,
  type MicCheckProgress,
  type MicCheckVerdict,
} from "../mic-check";

type MicCheckProps = {
  channel: Channel;
  showName: string;
  onClose: () => void;
};

export function MicCheck({ channel, showName, onClose }: MicCheckProps) {
  const [operatorName, setOperatorName] = useState(
    () => window.localStorage.getItem("a2-monitor-operator-name") ?? "",
  );
  const [a1Name, setA1Name] = useState(
    () => window.localStorage.getItem("a2-monitor-a1-name") ?? "",
  );
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<MicCheckProgress>(() =>
    loadMicCheck(showName, channel.id),
  );
  const firstOpen = useMemo(
    () =>
      micCheckDimensions.findIndex(
        ({ id }) => progress[id]?.verdict !== "pass",
      ),
    [progress],
  );
  const [step, setStep] = useState(firstOpen === -1 ? 0 : firstOpen);
  const dimension = micCheckDimensions[step] ?? micCheckDimensions[0]!;
  const currentRecord = progress[dimension.id];
  const completed = micCheckDimensions.filter(
    ({ id }) => progress[id]?.verdict === "pass",
  ).length;

  function begin() {
    const trimmedOperator = operatorName.trim();
    if (!trimmedOperator) return;
    setOperatorName(trimmedOperator);
    window.localStorage.setItem("a2-monitor-operator-name", trimmedOperator);
    if (a1Name.trim()) {
      window.localStorage.setItem("a2-monitor-a1-name", a1Name.trim());
    }
    setStarted(true);
  }

  function record(verdict: MicCheckVerdict) {
    const by = dimension.owner === "A1" ? a1Name.trim() : operatorName.trim();
    if (!by && verdict !== "waiting") return;
    const next = {
      ...progress,
      [dimension.id]: {
        verdict,
        by: by || "Waiting for named A1",
        atUtc: new Date().toISOString(),
      },
    };
    setProgress(next);
    saveMicCheck(showName, channel.id, next);
    if (step < micCheckDimensions.length - 1) setStep(step + 1);
  }

  return (
    <section className="mic-check" role="dialog" aria-modal="true">
      <header className="mic-check-header">
        <div>
          <span className="detail-overline">Guided mic check</span>
          <h2>{channel.character}</h2>
          <p>
            Channel {channel.number} · {channel.performer}
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
            disabled={!operatorName.trim()}
            onClick={begin}
          >
            Continue check
          </button>
          <p>Progress is stored on this device and survives a reload.</p>
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
              onClick={() => record("fail")}
            >
              {dimension.owner === "A1" ? "A1 fail" : "Fail"}
            </button>
            {dimension.owner === "A1" ? (
              <button
                type="button"
                className="check-wait"
                onClick={() => record("waiting")}
              >
                Waiting on A1
              </button>
            ) : null}
            <button
              type="button"
              className="check-pass"
              disabled={dimension.owner === "A1" && !a1Name.trim()}
              onClick={() => record("pass")}
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
