# Manager web application

Manager is the back-office web surface for configuring the system and building
shows. It is not intended to be the primary interface during a performance.

## Owns

- node enrollment, health, capabilities, and audio-device inventory;
- receiver inventory and secure connection setup;
- source creation, photos, notes, and metadata;
- people, roles, cast alternatives, performances, headshots, and privacy state;
- microphone elements, transmitters, kits, spares, placement images, and
  condition history;
- audio-input, receiver-channel, and transmitter pairing;
- groups, scenes, layouts, alert rules, and permissions;
- ordered cue definitions and expected On Stage/Up Next/silence/zone state;
- show validation, observed-versus-intended activation diff, revision history,
  show lock, activation, import, and export;
- administration and diagnostic workflows.

Manager talks only to the management backend. It never connects directly to
Dante, audio devices, or receiver APIs and never receives live monitor audio.

Manager and Live may share `packages/ui` and generated `packages/protocol`
types, but must remain separately buildable and deployable.

Receiver credentials are sealed in the browser to the enrolled node's public
key. The backend routes the envelope but does not persist or decrypt it.

Manager uses the same documented `/api/v1` resources and command schemas made
available to authorized local integrations; it has no private mutation API.

## Implementation baseline

Manager is a strict TypeScript React application built with Vite. It is a
separate npm workspace and deployable static bundle. It shares generated
protocol clients, accessible headless UI primitives and design tokens with
Live, but not Live's show-time entry point or media session code.

The current Phase 0T shell is intentionally disconnected from the management
API. It renders only fabricated labels and explicit unknown/empty states; it
does not claim that a production, hardware manifest, validation result, or
activation exists.

## Local development

From the repository root, install the pinned workspace dependencies and start
Manager on `127.0.0.1:4174`:

```sh
npm ci
npm run dev --workspace @a2-monitor/manager
```

Run its format, lint, interaction-test, type, and production-build checks with:

```sh
npm run check --workspace @a2-monitor/manager
```

Manager must remain independently buildable and must not import from
`apps/live`. Its next data integration must use a management API contract added
for a running backend path rather than inventing a UI-only resource shape.
