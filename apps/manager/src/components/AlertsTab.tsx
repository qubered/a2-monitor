import { useState } from "react";
import type { Showfile } from "@rvlt/pulse-protocol/http";
import {
  DEFAULT_ALERT_POLICY,
  isCoherentAlertPolicy,
  type AlertPolicy,
} from "@rvlt/pulse-protocol/alert-policy";
import { Button } from "./ui/button";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

type NumericKey = {
  [Key in keyof AlertPolicy]: AlertPolicy[Key] extends number ? Key : never;
}[keyof AlertPolicy];

type FieldSpec = {
  key: NumericKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  help: string;
};

const SECTIONS: Array<{ title: string; detail: string; fields: FieldSpec[] }> =
  [
    {
      title: "Transmitter battery",
      detail: "Evaluated on wireless channels with battery monitoring on.",
      fields: [
        {
          key: "batteryCautionPercent",
          label: "Caution at or below",
          unit: "%",
          min: 1,
          max: 100,
          help: "Low battery.",
        },
        {
          key: "batteryCriticalPercent",
          label: "Critical at or below",
          unit: "%",
          min: 0,
          max: 100,
          help: "Battery critical.",
        },
      ],
    },
    {
      title: "RF level",
      detail:
        "Received signal strength. Judged separately from link quality, never merged into one figure.",
      fields: [
        {
          key: "rfCautionDbm",
          label: "Caution at or below",
          unit: "dBm",
          min: -130,
          max: 0,
          help: "Low RF.",
        },
        {
          key: "rfCriticalDbm",
          label: "Critical at or below",
          unit: "dBm",
          min: -130,
          max: 0,
          help: "Low RF, critical.",
        },
      ],
    },
    {
      title: "Link quality",
      detail:
        "Receivers that report it (Axient Digital). Interference lowers it before RF level falls.",
      fields: [
        {
          key: "qualityCautionPercent",
          label: "Caution at or below",
          unit: "%",
          min: 0,
          max: 100,
          help: "Poor link.",
        },
        {
          key: "qualityCriticalPercent",
          label: "Critical at or below",
          unit: "%",
          min: 0,
          max: 100,
          help: "Poor link, critical.",
        },
      ],
    },
    {
      title: "Silence",
      detail:
        "Per-channel setting (the audio monitor toggle on Channels). Never inferred from cues.",
      fields: [
        {
          key: "silenceFloorDbfs",
          label: "Silence below",
          unit: "dBFS",
          min: -120,
          max: 0,
          help: "Captured peak under this counts as silence.",
        },
        {
          key: "silenceAfterSeconds",
          label: "No audio after",
          unit: "s",
          min: 5,
          max: 3600,
          help: "Continuous silence before a critical No audio alert. Arms once the channel has been heard since the backend started.",
        },
      ],
    },
    {
      title: "Card overlay",
      detail:
        "A critical alert holds its card until acknowledged. Caution overlays expire; the alert still counts as outstanding.",
      fields: [
        {
          key: "overlayExpiryMinutes",
          label: "Caution overlay expires after",
          unit: "min",
          min: 1,
          max: 60,
          help: "Expiry is never acknowledgement.",
        },
      ],
    },
  ];

function NumberField({
  spec,
  value,
  onCommit,
}: {
  spec: FieldSpec;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // An outside change (reset to defaults) replaces the draft.
    setLastValue(value);
    setDraft(String(value));
  }
  const parsed = Number(draft);
  const valid =
    draft.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= spec.min &&
    parsed <= spec.max;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${spec.label} (${spec.unit})`}
          aria-invalid={!valid || undefined}
          inputMode="numeric"
          className="w-28 font-mono tabular-nums"
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            const number = Number(next);
            if (
              next.trim() !== "" &&
              Number.isInteger(number) &&
              number >= spec.min &&
              number <= spec.max
            ) {
              onCommit(number);
            }
          }}
        />
        <span className="font-mono text-caption text-muted-foreground">
          {spec.unit}
        </span>
      </div>
      <span
        className={`text-caption ${valid ? "text-muted-foreground" : "text-out"}`}
      >
        {valid
          ? spec.help
          : `Enter a whole number from ${spec.min} to ${spec.max}.`}
      </span>
    </div>
  );
}

export function AlertsTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  const policy = showfile.alertPolicy ?? DEFAULT_ALERT_POLICY;
  const usingDefaults = showfile.alertPolicy === undefined;
  const coherent = isCoherentAlertPolicy(policy);

  function update(next: Partial<AlertPolicy>) {
    onChange({ ...showfile, alertPolicy: { ...policy, ...next } });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Alert policy</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Alerts
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Limits the backend applies to this show. Per-channel monitor toggles
            on Channels decide which dimensions are judged at all. These are
            rehearsal starting points, not validated thresholds.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-caption text-rep">
            {usingDefaults ? "Using defaults" : "Custom policy"}
          </span>
          <Button
            variant="outline"
            disabled={usingDefaults}
            onClick={() => {
              const next = { ...showfile };
              delete next.alertPolicy;
              onChange(next);
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </div>

      {!coherent ? (
        <p
          role="alert"
          className="max-w-xl rounded-md border border-out bg-out-soft px-4 py-3 text-ui text-out"
        >
          Each critical limit must be beyond its caution limit. The showfile
          will not save until they are.
        </p>
      ) : null}

      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h3 className="font-display text-cardhead text-foreground">
            {section.title}
          </h3>
          <p className="max-w-xl text-caption text-muted-foreground">
            {section.detail}
          </p>
          <Table className="max-w-xl">
            <TableBody>
              {section.fields.map((spec) => (
                <TableRow key={spec.key}>
                  <TableCell className="w-56 font-semibold text-foreground">
                    {spec.label}
                  </TableCell>
                  <TableCell>
                    <NumberField
                      spec={spec}
                      value={policy[spec.key]}
                      onCommit={(value) => update({ [spec.key]: value })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-cardhead text-foreground">Clipping</h3>
        <label className="flex min-h-11 max-w-xl items-center gap-3 text-ui text-foreground">
          <input
            type="checkbox"
            className="size-5 accent-ok"
            checked={policy.clipAlerts}
            onChange={(event) => update({ clipAlerts: event.target.checked })}
          />
          Raise a caution when a monitored input clips
        </label>
      </section>
    </div>
  );
}
