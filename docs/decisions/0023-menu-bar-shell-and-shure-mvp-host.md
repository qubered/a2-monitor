# ADR 0023: Use a menu-bar shell and temporary Shure MVP host

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-21
- **Owners:** Project team

## Context

The self-contained macOS MVP used a persistent modal AppleScript dialog to keep
its services alive. It behaved like a blocking setup utility rather than a Mac
application. The same MVP now needs read-only Shure battery telemetry before the
production adapter-process and node IPC boundaries exist.

## Decision

Compile a small AppKit menu-bar executable into the development `.app`. It owns
the existing bundled Node launcher and exposes Open Live, Open Manager, start,
stop, log and quit actions. Receiver inventory is configured only in Manager.
Initial audio-device
and network-scope selection remain bounded setup dialogs; no dialog remains open
to keep the server alive.

For this MVP only, the listen gateway hosts the bounded Shure TCP 2202 monitor.
It reconciles multiple explicitly configured IP addresses from the Manager-owned
showfile, sends independent read-only identity and battery queries, consumes
unsolicited `REP` frames, and publishes only the
closed normalized telemetry contract. It does not send receiver mutations,
perform discovery, expose raw frames, or enter the real-time capture callback.

## Consequences

- The app stays out of the operator's way and remains controllable from the menu
  bar.
- Receiver failure remains independent of PCM capture and listening.
- The Shure connection is plaintext and unauthenticated, so it is restricted to
  an isolated trusted control network and reported as `compatible-read-only`.
- Parser and simulated transcript tests are implementation evidence only. No
  receiver model or firmware is physically verified by this decision.

## Replacement gate

Move the Shure session into the dedicated hardware-adjacent adapter process
when the native node/adapter IPC and confinement boundary is implemented. The
normalized contract may remain; the gateway-hosted session must not become the
production topology.
