# Mockups

Generated from [`../prototype/index.html`](../prototype/index.html). They are
pictures of the reference build, not a separate source of truth: if one of these
and the prototype disagree, the prototype is right and the image is stale.

Regenerate with:

```
node scripts/render-mockups.mjs
```

That script is not wired into CI and playwright-core is deliberately not a
repository dependency — see the header comment in the script for what it needs.
Web fonts are fetched once and inlined, so the type in these images is the real
type rather than a fallback stack. If the script reports that it could not fetch
the fonts, the images it produced should not be committed.

| File | What it shows |
| --- | --- |
| `01-a2-grid-paper.png` | The A2 grid at rest, on the Paper surface. |
| `02-a2-grid-dark.png` | The same grid in dark. |
| `03-a2-alerts.png` | Unacknowledged alerts veiling their cards — the channel, meter and status strip still readable underneath. |
| `04-a2-acknowledged.png` | One alert acknowledged, one self-resolved, and the outstanding count falling on its own. |
| `05-a2-player.png` | The player expanded: audio, RF level, link quality and battery under a single playhead. |
| `06-a2-replay.png` | Scrubbed back into replay — violet chrome, everything after the playhead dimmed. |
| `07-a2-detail.png` | Channel detail: antennas and diversity with the squelch threshold marked, frequency, transmitter, battery, receiver. |
| `08-a1-grid.png` | The A1 view — glance and report, with no listen control anywhere. |
| `09-a1-report.png` | The report sheet with several issues selected. |
| `10-a1-sent.png` | Report sent, undo still live. |
| `11-mic-check.png` | Guided mic check, one-handed, with the A1's dimension outstanding. |
| `12-replay-incident.png` | The replay surface and the incident panel. |

All data in them is fabricated. The faces are placeholders standing in for real
production headshots at the exact crop and weight.
