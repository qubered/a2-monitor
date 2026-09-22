import type { ChannelLevelSample, Verdict } from "@rvlt/pulse-protocol/http";

/** Below this, a measured level counts as silence rather than a quiet signal. */
export const AUDIO_SILENCE_FLOOR_DBFS = -50;
const AUDIO_CHECK_WINDOW_SAMPLES = 8;

/**
 * Turns a rolling window of real level-history samples into an Audio verdict —
 * the actual "is audio coming through" check, distinct from the manual
 * pass/fail guided mic check (§11.3). Falls back to whatever the source
 * already reports when there isn't yet enough history to judge, so a card
 * never regresses to a worse answer than it already had while data loads.
 */
export function deriveAudioVerdict(
  fallback: Verdict,
  samples: readonly ChannelLevelSample[],
): Verdict {
  if (fallback === "not-applicable") return fallback;
  const recent = samples.slice(-AUDIO_CHECK_WINDOW_SAMPLES);
  if (recent.length === 0) return fallback;

  const observed = recent.filter(
    (sample) => sample.availability === "observed",
  );
  if (observed.length === 0) return "unknown";

  const audible = observed.some(
    (sample) =>
      sample.audioDbfs !== null && sample.audioDbfs > AUDIO_SILENCE_FLOOR_DBFS,
  );
  return audible ? "good" : "fault";
}
