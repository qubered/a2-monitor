# Listen gateway

Development-only host for the local MVP's direct node-to-Live listening path
(ADR 0026). It launches `pulse-media-worker` with one exact device name. The
worker runs `pulse-device-capture` as its child, encodes the selected input as
10 ms mono Opus and sends it to each browser over WebRTC. The gateway exposes
the observed inputs at `GET /audio/v0/device` and relays signaling. No audio
passes through this process.

Signaling is WHEP-style, with no trickle ICE because the node is ICE-lite:

| Request                                      | Body                               | Response                                    |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| `POST /audio/v0/listen/sessions`             | `{"channel": N, "offer": "<sdp>"}` | `201 {"sessionId", "answer"}`               |
| `PUT /audio/v0/listen/sessions/{id}/channel` | `{"channel": N}`                   | `204`; the node crossfades to the new input |
| `DELETE /audio/v0/listen/sessions/{id}`      | none                               | `204`                                       |

Bodies must be `application/json`. The node advertises the address the browser
used to reach this server as its only ICE candidate. For a loopback page load it
advertises the first LAN IPv4 address instead, because browsers pair from their
LAN interfaces. Media is DTLS-SRTP encrypted and marked DSCP EF for Wi-Fi WMM
voice queueing.

The worker also meters every captured input outside the capture callback
(ADR 0027). `GET /audio/v0/levels` returns capture state plus each input's
peak, RMS and clipped-sample count over the trailing second (`node-levels`
contract), which the backend polls to evaluate alerts. `GET /audio/v0/meters`
is a receive-only Server-Sent Events stream of 20 Hz `meter-frame` payloads
(`event: meters`) for Live's card traces; a slow client skips frames. If the
worker exits, the gateway restarts the same named device with bounded backoff
(1, 2, 4, 8, 15 then 30 s); it never falls back to another device.

The reserved device name `Pulse test signal` makes `pulse-device-capture`
generate a built-in test signal instead of opening a physical input
(`A2_SIMULATED_CHANNELS`, default 8): speech, a steady tone, room noise,
periodic clipping, digital silence and a dropout. It is reported as
`simulated: true` and is never evidence about hardware. `npm run dev:simulate`
at the repository root runs it with a seeded demo show, and
`npm run simulate:shure` starts a development AD4Q double on `127.0.0.1:2202`
with scripted battery drain, RF dips, interference, mute and transmitter loss.

The gateway is deliberately outside the management backend. Signaling has no
listener authorization and makes no performance claim. It must not be exposed
to an untrusted network.

List the host's input devices:

```sh
npm run devices
```

Start the complete local application with an exact name from that output:

```sh
A2_AUDIO_DEVICE="Exact device name" npm run dev
```

Building the worker compiles libopus from source and needs `cmake`.

The default bind is `127.0.0.1:3001`. These variables may override the
development defaults:

- `A2_MEDIA_WORKER_BIN`
- `A2_CAPTURE_BIN`
- `A2_SIMULATED_CHANNELS` (test signal only, 1 to 64)
- `A2_LISTEN_HOST`
- `A2_LISTEN_PORT`

A packaged MVP may also set `A2_LIVE_DIR` to serve the compiled Live application
and `A2_MANAGER_DIR` to serve Manager under `/manager/`. `A2_BACKEND_ORIGIN`
proxies same-origin `/api/` requests to the management backend. These options
keep the browser on one origin; they do not add authentication.

The gateway loads Manager's receiver inventory from the local showfile and
opens an independent read-only Shure command-string connection to each unit on
TCP 2202. Inventory changes are reconciled without restarting audio.
`GET /audio/v0/shure` returns the closed normalized fleet battery contract.
This temporary host is governed by ADR 0023 and is not a physical-hardware
support claim.
