# Development runbook

## Repository setup

Until component toolchains are selected, only Git and a POSIX shell are
required.

```sh
git status --short --branch
./scripts/check-repo.sh
```

Component READMEs will own their exact setup and checks. Do not add a root task
runner until at least two real components need shared orchestration.

## Local topology

Development must support both:

1. **single host:** audio node, backend, and frontend on one workstation; and
2. **split host:** audio node beside hardware, backend/frontend on another host.

Use synthetic devices by default. Access to real Dante and receiver networks
must be explicit, and test credentials belong in an ignored local secret store.

## Adding a component dependency

Before adding a production dependency:

- identify the capability it provides;
- check license and redistribution terms;
- assess real-time, binary-size, update, and security impact;
- pin it through the component's package manager; and
- add an ADR if it establishes a framework or runtime boundary.

Never vendor Dante/vendor SDK binaries or credentials into Git.

## Test artifacts

Write generated recordings, packet captures, performance reports, databases,
and logs only to ignored directories such as `recordings`, `captures`, or
`reports`. Share approved large artifacts through the future artifact store,
not normal Git history.
