# Listen gateway

Development-only direct audio-node transport for the local MVP. It launches
`a2-device-capture` with one exact device name, exposes the observed inputs at
`GET /audio/v0/device`, and streams one selected mono Float32LE input at
`/audio/v0/listen?channel=N` over WebSocket.

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
