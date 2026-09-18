# ADR 0003: Cross-platform, single-device audio capture

- **Status:** Accepted
- **Date:** 2026-09-18
- **Owners:** Project team
- **Supersedes:** None

## Context

The audio node must work on Windows and macOS with Dante Virtual Soundcard and
ordinary professional audio interfaces. Simultaneously opening unrelated audio
devices creates multiple clock domains, drift, aggregate-device behavior, and
failure cases that are not necessary for the product's first purpose.

## Decision

The audio node has one cross-platform capture abstraction and opens exactly one
audio device at a time.

- Windows supports ASIO as the preferred professional path and WASAPI where an
  appropriate device has no ASIO driver.
- macOS supports Core Audio/HAL.
- DVS and DVS Pro are device profiles reached through those operating-system
  APIs; they are not a separate architecture.
- USB, Thunderbolt, built-in, virtual, and future devices use the same capture
  contract when exposed by a supported host API.
- One selected device may expose many input channels, but all active channels
  belong to its one capture clock.
- Aggregate devices, simultaneous DVS plus USB, and multiple independent audio
  devices are not supported in version one.

The node enumerates installed devices but never silently follows the operating
system's default-device change. Selection is explicit and stored using the
most stable identifier the host API and driver provide. A changed driver,
missing device, changed channel layout, sample-rate change, or device switch
requires validation and creates a new capture timeline epoch.

The engine accepts the selected device's native sample format and rate. The
reference profile is 48 kHz. Formats and rates outside the validated matrix are
reported as compatible-unverified or unsupported; the media boundary performs
bounded resampling to Opus's 48 kHz clock when required. Device compatibility
is claimed for an exact OS, host API, driver, model, firmware, sample rate,
buffer size, and channel-count tuple.

## Device-loss behavior

- Capture stops and a discontinuity event closes the current timeline epoch.
- Existing media continues with an explicit unavailable/silence state; stale
  audio must never masquerade as live input.
- The node retries only the same stable device identity with bounded backoff.
- It never falls back to another device or changed channel map automatically.
- Successful recovery starts a new epoch and requires binding reconciliation
  before the show returns to healthy.
- Selecting a different device is a controlled stop/reconfigure/start action,
  not a seamless show-time switch.

## Consequences

### Positive

- Windows and macOS share one domain model and most of the audio engine.
- DVS, USB, and other interfaces can coexist in the product catalogue without
  introducing concurrent clock domains.
- Replay and event correlation have one authoritative sample clock at a time.
- Device changes fail visibly instead of silently repatching sources.

### Negative

- A user cannot combine two interfaces without routing them into one supported
  device externally.
- Host-API and driver differences still require separate hardware validation.
- Non-48-kHz profiles require a measured real-time resampling budget.

## Validation

Before the decision is considered implemented:

- capture DVS and at least one representative USB interface on Windows and
  macOS;
- test ASIO, Core Audio, and the selected WASAPI modes independently;
- exercise device loss, driver restart, channel-layout change, sample-rate
  change, clock loss, NIC loss for DVS, suspend/resume, and 20 cold boots;
- prove that no device change silently alters a source binding; and
- publish the exact validated tuples and results.

