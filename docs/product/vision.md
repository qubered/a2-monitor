# Product vision

**Status:** Proposed

**Working title:** A2 Monitor

## Vision

Give every A2 and audio engineer a shared, trustworthy view of the sources they
are responsible for—and let them hear and diagnose any incident within two taps
and five seconds.

The product consists of a small hardware-adjacent audio node, a management
backend, a Manager web application for show building, and a focused Live web
application for operators. A simple deployment can run all components on one
appliance; larger deployments can separate them without changing their
responsibilities. Together they combine live multichannel audio,
wireless telemetry, replay, alerting, and show workflow without requiring a
native client on every operator device.

## Users

### A2 / backstage RF technician

Needs to identify failing microphones, weak coverage, interference, battery
risk, costume noise, and intermittent faults while remaining mobile.

### A1 / FOH engineer

Needs confidence that backstage is investigating the right source, rapid
auditioning, and a shared event history without leaving the console workflow.

### RF coordinator / systems engineer

Needs receiver inventory, RF quality and warning trends, network health, and
evidence that separates coverage, interference, device, and audio-path faults.

### Production / rental company

Needs repeatable show files, predictable deployment, secure access, exportable
incident records, and support for mixed receiver fleets.

## Core jobs

1. See the health of all wired and wireless channels at a glance.
2. Listen to any source or operational group immediately.
3. Correlate audio, RF, quality, battery, device, and operator events.
4. Rewind a synchronized production history and hear what happened.
5. Prepare and execute mic check, scenes, On Stage, and Up Next workflows.
6. Hand an incident to another operator with shared context.
7. Swap performers, understudies, microphone elements, packs and signal paths
   without losing identity or corrupting historical evidence.
8. Drive cue context through the documented local API and show the correct
   performer/role imagery throughout the performance.
9. Keep intended, physically installed, receiver-observed, captured-audio and
   A1-confirmed swap states distinct.

## Product promise

- The appliance continues its core work without internet access.
- The audio node keeps the active show running from cached configuration if
  the management backend becomes temporarily unavailable.
- UI or control-service failure does not stop audio capture and replay.
- Each operator has an independent monitor mix and layout.
- Alerts are explainable and acknowledge uncertainty.
- Latency and reliability claims are backed by reproducible measurements.
- Receiver integrations use documented, secure vendor interfaces where they
  are available.

## Initial scope

- Windows and macOS audio nodes using ASIO/WASAPI or Core Audio.
- Exactly one selected audio device at a time: DVS/DVS Pro, USB, Thunderbolt,
  built-in, virtual, or another device exposed by a supported host API.
- A 48 kHz reference profile; other formats/rates require an explicit validated
  compatibility tuple.
- Sennheiser EW-DX plus one representative Shure rack receiver in the
  end-to-end technical spike.
- 32–64 channels in the technical spike; 128 channels for the beta target.
- Modern desktop browsers and iPad as explicit test targets.
- Foreground browser operation only; background or screen-locked listening is
  not a version-one promise.
- Dedicated screen-awake show-device profile; intercom/radio remains the urgent
  path and product paging is advisory.
- Read-only QLab 5 cue observer plus manual coarse-scene/no-cue modes.
- Live metering, tap-to-listen, groups, configurable alerts, and show files.
- Thirty-minute synchronized replay in the limited field beta.

## Explicit non-goals for version one

- Performer foldback or IEM transport.
- Phase-coherent remote monitoring.
- Frequency coordination or receiver firmware management.
- Public-internet remote listening.
- Direct browser access to Dante or receiver management networks.
- Full show building or user administration on the audio node.
- Simultaneous or aggregate audio devices and transparent switching between
  independent device clocks.
- Replacing the console or Dante Controller.
- Claiming automatic fault diagnosis before a labeled evidence base exists.

## Relationship to Wireless Workbench and Wireless Systems Manager

A2 Monitor is a **soft replacement** for the vendor wireless tools, and the line
is time, not capability: **during a performance, the work happens here.** An
operator running a show should not be hopping between programs to find out what
a receiver is doing, and every value those tools would show them during a show
is in this product's channel detail.

Frequency coordination, scanning, deployment planning and firmware management
stay in the vendor tools, and stay listed above as non-goals. Those are
before-the-show and after-the-show work, done sitting down, and they are not
what the hopping problem is about.

See [ADR 0019](../decisions/0019-cue-optional-and-show-time-scope.md).

## Differentiation

The opportunity is not merely a browser clone of an existing meter grid. The
product should lead with:

- zero-install shared access;
- secure current-generation receiver APIs;
- assisted audio-to-radio pairing;
- causal incident cards that correlate telemetry and audio;
- an open adapter model for mixed fleets;
- more flexible independent client mixes; and
- an operational history that improves handoff and post-show learning.

## Success measures

- Median time from alert to correct source audition.
- Percentage of incidents with a confirmed cause.
- False-positive and missed-alert rates by alert type.
- Capture-to-ear and tap-to-switch latency by supported client profile.
- Audio callback underruns and discontinuities per show-hour.
- Time required to create and verify a show file.
- Operator adoption during real productions.

## Product safety position

The product is an advisory monitoring and diagnosis tool. It is not initially
the only monitoring path on which programme continuity or performer safety
depends. Supported productions retain a conventional console/headphone
fallback until later evidence and product decisions explicitly change that
position.

## Market sequence

Theatre and musical theatre are the first reference production and pilot
market. Corporate AV is second. Concert/festival and broadcast workflows remain
later profiles unless validation exposes a requirement that must be preserved
in the shared domain model.
