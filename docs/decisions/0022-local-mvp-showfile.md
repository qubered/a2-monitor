# ADR 0022: Persist one editable local MVP showfile

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-21
- **Owners:** Project team
- **Supersedes:** None

## Context

The physical-listening MVP exposes numbered inputs but has no way to give them
show-specific names. Operators need to prepare one show on the audio Mac and see
those names in Live without installing development tools. The production domain
model requires immutable revisions, activation, audit history, permissions and
multi-user conflict handling; those systems do not exist yet.

## Decision

Add one backend-owned, versioned local showfile contract containing the show
name, exact observed device identity and an ordered list of logical show
channels. Each channel has a name, an optional physical audio-input patch and an
optional normalized receiver-channel patch. Manager is the only editing
surface. Live reads the saved projection and falls back to observed device
labels when the showfile is absent or belongs to another device.

The showfile also owns a multi-unit Shure receiver inventory. Wireless patches
use the stable receiver ID plus its zero-based channel index, so equal channel
numbers on different receiver units remain distinct.

The backend assigns a monotonically increasing revision and rejects a save whose
base revision is stale. The macOS MVP stores the closed JSON contract at
`~/Library/Application Support/A2 Monitor/showfile.json`, writes a sibling
temporary file and atomically renames it into place. The pre-inventory MVP shape
is migrated once by adding an empty receiver list and clearing ambiguous legacy
receiver-channel patches; other invalid persisted bytes fail closed.

## Consequences

- A double-clicked local MVP can add/remove show channels and patch them to
  physical audio and receiver inputs.
- Backend ownership preserves the Manager/Live boundary and gives both browsers
  the same saved names.
- Device name and channel count prevent patches from silently moving onto a
  different interface. Unpatched channels remain explicit and cannot listen.
- This file is mutable local setup, not an immutable activated production
  revision, database, backup format or collaboration protocol.

## Replacement gate

Replace this file with the production show store only when immutable revisions,
validation, activation, authorization, audit history, migration, backup and
multi-user concurrency are implemented and tested.
