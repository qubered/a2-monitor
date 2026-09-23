import type { Showfile } from "@rvlt/pulse-protocol/http";
import {
  DEFAULT_ALERT_POLICY,
  isCoherentAlertPolicy,
  type AlertPolicy,
} from "@rvlt/pulse-protocol/alert-policy";

export { DEFAULT_ALERT_POLICY, isCoherentAlertPolicy, type AlertPolicy };

export function resolveAlertPolicy(showfile: Showfile): AlertPolicy {
  return showfile.alertPolicy ?? DEFAULT_ALERT_POLICY;
}
