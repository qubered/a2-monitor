// Alert policy defaults shared by the backend (evaluation) and Manager
// (editing). The showfile stores a production's own policy; when it has
// none, these apply. They are rehearsal starting points, not thresholds
// validated against a labelled alert set.

import type { Showfile } from "../generated/http-contracts.js";

export type AlertPolicy = NonNullable<Showfile["alertPolicy"]>;

export const DEFAULT_ALERT_POLICY: AlertPolicy = {
  batteryCautionPercent: 25,
  batteryCriticalPercent: 10,
  rfCautionDbm: -80,
  rfCriticalDbm: -90,
  qualityCautionPercent: 40,
  qualityCriticalPercent: 20,
  silenceFloorDbfs: -70,
  silenceAfterSeconds: 30,
  clipAlerts: true,
  overlayExpiryMinutes: 5,
};

/** Critical limits must sit beyond their caution limits or the escalation order is meaningless. */
export function isCoherentAlertPolicy(policy: AlertPolicy): boolean {
  return (
    policy.batteryCriticalPercent < policy.batteryCautionPercent &&
    policy.rfCriticalDbm < policy.rfCautionDbm &&
    policy.qualityCriticalPercent < policy.qualityCautionPercent
  );
}
