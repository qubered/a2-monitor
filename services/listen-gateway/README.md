# Listen gateway

Development-only direct audio-node transport for the local MVP. It launches
`pulse-device-capture` with one exact device name, exposes the observed inputs at
`GET /audio/v0/device`, and streams one selected mono Float32LE input at
`/audio/v0/listen?channel=N` over WebSocket.

It also meters every captured input outside the real-time callback (ADR 0027):
`GET /audio/v0/levels` returns capture state plus each input's peak, RMS and
clipped-sample count over the trailing second (`node-levels` contract), and
`/audio/v0/meters` is a receive-only WebSocket of 20 Hz `meter-frame` messages
for Live's card traces. If the capture process exits, the gateway restarts the
same named device with bounded backoff (1, 2, 4, 8, 15 then 30 s); it never
falls back to another device.

The reserved device name `Pulse test signal` selects a built-in simulated
source instead of a physical input (`A2_SIMULATED_CHANNELS`, default 8): speech,
a steady tone, room noise, periodic clipping, digital silence and a dropout.
It is reported as `simulated: true` and is never evidence about hardware.
`npm run simulate:shure` starts a development AD4Q double on
`127.0.0.1:2202` with scripted battery drain, RF dips, interference, mute and
transmitter loss.

The gateway is deliberately outside the management backend. It has no release
authorization, encryption, jitter recovery or performance claim and must not be
exposed to an untrusted network. ADR 0021 records its temporary scope.

List the host's input devices:

```sh
npm run devices
```

Start the complete local application with an exact name from that output:

```sh
A2_AUDIO_DEVICE="Exact device name" npm run dev
```

The default bind is `127.0.0.1:3001`. `A2_CAPTURE_BIN`, `A2_LISTEN_HOST` and
`A2_LISTEN_PORT` may override the development defaults. A packaged MVP may also
set `A2_LIVE_DIR` to serve the compiled Live application and
`A2_MANAGER_DIR` to serve Manager under `/manager/`.
`A2_BACKEND_ORIGIN` proxies same-origin `/api/` requests to the management
backend. These options keep the browser on one origin; they do not add transport
authentication or encryption.

The gateway loads Manager's receiver inventory from the local showfile and
opens an independent read-only Shure command-string connection to each unit on
TCP 2202. Inventory changes are reconciled without restarting audio.
`GET /audio/v0/shure` returns the closed normalized fleet battery contract.
This temporary host is governed by ADR 0023 and is not a physical-hardware
support claim.
