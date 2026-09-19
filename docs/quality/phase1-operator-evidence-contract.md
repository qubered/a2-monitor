# Phase 1 operator evidence contract

**Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).

This document states requirements; the catalogue and run manifest it described
are withdrawn with the rest of the evidence apparatus. What they lacked is
recorded in [open questions](../open-questions.md): slice promotion sets for
`1A.1`/`1A.2`/`1A.3`, named A1/A2/observer roles, catalogue-frozen numeric
thresholds rather than per-run choices, and per-repetition completion, abort
and fault allocation rather than a bare repetition count.

When rebuilt, each slice uses a closed operator catalogue, validates a frozen
run manifest, and emits the same signed evidence-result envelope as Phase 0.

The normative theatre fixture has 32 performers, 40 roles, 48 captured/receiver
paths, six prepared spares, eight zones and at least 120 cue definitions. A run
records participant role and anonymized experience band, a versioned training
script, competency pass, at least five repetitions and blinded fault injection.
Thresholds are selected and signed before the first trial; observation does not
change them mid-run.

Every slice has zero tolerance for wrong-source or unsafe action. Abort triggers
include hearing-safety concern, programme-path risk, loss of conventional comms,
wrong-source action and observer stop. Aborted trials remain evidence and cannot
be silently replaced. Timing uses synchronized observer/system records; screen,
ledger, physical-boundary and debrief artifacts are content-addressed.

The 1A.2 alert gate uses labeled ground truth and freezes sensitivity, critical
miss, false-alarm/flood/retrigger, detection-time and correct-action thresholds.
It must pass before alerts become an operator dependency. Waivers cannot excuse
a zero-tolerance event or promote above their declared slice.
