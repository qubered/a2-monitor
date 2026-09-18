# Security policy

## Reporting

Until a private security contact is configured, do not open a public issue for
a suspected vulnerability. Contact the repository owner privately and include
the affected version, reproduction steps, impact, and any proposed mitigation.

A monitored private address or hosted private-reporting mechanism, severity
triage owner, acknowledgement target, remediation targets, and disclosure
process are mandatory before an external pilot. Until then, external deployment
is not security-supported.

## Supported versions

The project is pre-release and has no supported production version. Security
fixes will target the active development branch until a release policy is
published.

## Sensitive material

Never commit:

- EW-DX or other receiver credentials;
- private keys, local CA material, or production certificates;
- Dante or vendor SDK license files;
- real show audio, talent photos, or operator notes without explicit approval;
- network captures containing credentials or production addresses; or
- customer configuration exports.

Use `.env.example` files containing fake values where configuration examples
are needed. Rotate any secret immediately if it reaches Git history.
