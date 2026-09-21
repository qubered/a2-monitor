# ADR 0024: Replace setup dialogs with an app window for device and network selection

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-21
- **Owners:** Project team
- **Supersedes:** 0023 (device and network selection only; its menu-bar item and
  Shure MVP host decision stand)

## Context

ADR 0023 kept the audio-device and network-scope choices as bounded
AppleScript `choose from list` dialogs shown once at launch, with no dialog
left open afterward. That reads as a one-shot setup wizard rather than an
application the operator can return to, and it gives the operator no way to
see or change those choices without quitting and relaunching.

## Decision

The bundled AppKit executable now opens an ordinary app window at launch
instead of running the AppleScript pickers. The window lists the observed 48
kHz input devices (queried directly from the bundled `a2-device-capture
--list`) and the network-scope options in native controls, shows server
status, and has Start/Stop, Open Live, Open Manager and Show Log actions. The
menu-bar item remains for quick access and can reopen the window; closing the
window hides it rather than quitting the app. The chosen device and network
scope are remembered in user defaults and pre-selected on the next launch.

The bundled Node launcher already accepted `A2_AUDIO_DEVICE` and
`A2_BIND_HOST` as overrides ahead of its own AppleScript prompts; the app now
always supplies both, so those prompts only remain as a fallback for
launching `launcher.mjs` directly outside the app bundle (development use).

## Consequences

- The operator can see and change the audio device and network scope from a
  persistent window instead of a one-shot dialog sequence, and reopen it at
  any time from the menu bar.
- Device listing moves from the Node launcher (invoked through AppleScript)
  to the AppKit window, which calls the same bundled capture binary directly.
- Remembering the last selection removes a step on repeat launches at the
  cost of one small local preferences surface (user defaults only; no new
  persisted file).
- The window is still an unsigned, ad-hoc-signed development shell per ADR
  0023; it changes none of that ADR's Shure MVP host or trust-boundary
  decisions.

## Replacement gate

Fold this window into the production packaging described by ADR 0018 once a
signed, notarized installer and its application shell exist; the local MVP
window and its remembered preferences must not become the production
configuration surface.
