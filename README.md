# Miroclone

Miroclone is an internal, self-hosted collaborative whiteboard. It runs on an
on-premises RKE2 Kubernetes cluster, uses Microsoft Entra ID for single
sign-on (SSO), and holds information classified up to PROTECTED.

To review the scope, requirements, and architecture, see the
[product requirements document](docs/PRD.md).

## Develop

To install dependencies and run the checks, run the following commands from
the repository root:

```sh
pnpm install
pnpm typecheck
pnpm test
```

To start the canvas prototype, run `pnpm --filter @miroclone/web dev`.
