import { useEffect, useState } from "react";
import type { RecordingState } from "@rvlt/pulse-protocol/http";
import { loadRecording, saveRecording } from "../showfile";
import { Badge, type BadgeProps } from "./ui/badge";
import { Button } from "./ui/button";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";

const REFRESH_MS = 2_000;
const MAX_MINUTES = 60;
const PRESETS = [5, 15, 30, 60] as const;

function status(state: RecordingState | null | "unavailable"): {
  variant: BadgeProps["variant"];
  label: string;
  detail: string;
} {
  if (state === null) {
    return {
      variant: "neutral",
      label: "reading",
      detail: "Reading the node's recording state.",
    };
  }
  if (state === "unavailable") {
    return {
      variant: "neutral",
      label: "unknown",
      detail: "The node's recording state is unknown.",
    };
  }
  if (!state.available) {
    return {
      variant: "neutral",
      label: "unavailable",
      detail: "This node has no place to keep recordings.",
    };
  }
  if (!state.enabled) {
    return { variant: "neutral", label: "off", detail: "Nothing is recorded." };
  }
  if (!state.active) {
    return {
      variant: "warn",
      label: "waiting",
      detail: "Recording is on but the node is not capturing audio.",
    };
  }
  if (state.writeErrors > 0 || state.droppedBlocks > 0) {
    return {
      variant: "warn",
      label: "recording, with gaps",
      detail: `The recorder fell behind ${state.droppedBlocks} time(s) and failed ${state.writeErrors} write(s) since the node started. Each leaves a gap in the audio.`,
    };
  }
  return {
    variant: "ok",
    label: "recording",
    detail: `Every input is recorded and the last ${state.retentionMinutes} min are kept.`,
  };
}

/**
 * Optional audio recording on the node. It belongs to the node, not to a
 * production: the node keeps the setting itself and records whichever show is
 * running. Live uses the recording to listen back while scrubbing history.
 */
export function RecordingTab() {
  const [state, setState] = useState<RecordingState | null | "unavailable">(
    null,
  );
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const [draftMinutes, setDraftMinutes] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      loadRecording(controller.signal).then(setState, () => {
        if (!controller.signal.aborted) setState("unavailable");
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const known = state !== null && state !== "unavailable" ? state : null;
  const enabled = draftEnabled ?? known?.enabled ?? false;
  const minutes = draftMinutes ?? known?.retentionMinutes ?? MAX_MINUTES;
  const valid =
    Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES;
  const changed =
    known !== null &&
    (enabled !== known.enabled || minutes !== known.retentionMinutes);
  const turningOff = known?.enabled === true && !enabled;
  const shown = status(state);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      setState(await saveRecording(enabled, minutes));
      setDraftEnabled(null);
      setDraftMinutes(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The setting was not saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <CardOverline>Node setting</CardOverline>
        <h2 className="mt-1 font-display text-section leading-tight text-foreground">
          Audio recording
        </h2>
        <p className="mt-1 text-caption text-muted-foreground">
          Records every input on the audio node so Live can play back what a
          channel sounded like earlier, for example to catch a mic fault. Audio
          stays on the node&apos;s computer and only the most recent minutes are
          kept. It applies to whichever show is running.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={shown.variant}>{shown.label}</Badge>
          <span className="text-caption text-muted-foreground">
            {shown.detail}
          </span>
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-3 text-ui text-foreground">
        <input
          type="checkbox"
          className="size-5 accent-ok"
          checked={enabled}
          disabled={!known?.available || saving}
          onChange={(event) => setDraftEnabled(event.target.checked)}
        />
        Record all inputs
      </label>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="recording-minutes"
          className="text-ui font-semibold text-ink-2"
        >
          Keep the last (minutes, 1 to {MAX_MINUTES})
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="recording-minutes"
            className="w-24"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_MINUTES}
            value={Number.isNaN(minutes) ? "" : minutes}
            disabled={!known?.available || saving}
            onChange={(event) => setDraftMinutes(event.target.valueAsNumber)}
          />
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              variant={minutes === preset ? "default" : "outline"}
              disabled={!known?.available || saving}
              onClick={() => setDraftMinutes(preset)}
            >
              {preset} min
            </Button>
          ))}
        </div>
      </div>

      {turningOff ? (
        <p role="note" className="text-caption text-warn">
          Turning recording off deletes the audio already recorded.
        </p>
      ) : null}
      {message ? (
        <div
          role="alert"
          className="rounded-md border border-out bg-out-soft px-4 py-3 text-ui text-out"
        >
          {message}
        </div>
      ) : null}
      <div>
        <Button
          disabled={!changed || !valid || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save recording setting"}
        </Button>
      </div>
    </div>
  );
}
