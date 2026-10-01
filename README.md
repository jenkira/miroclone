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

## Explore the repository

The following list describes where to find each part:

- `apps/web`: The React and PixiJS client. Run `pnpm --filter @miroclone/web dev` to start it.
- `services/api`, `services/collab`, `services/worker`: The backend services.
- `packages/shared`, `packages/server-core`: Code that the client and services share.
- `tools/miro-migrate`: The [Miro migration tool](tools/miro-migrate/README.md).
- `deploy/helm/miroclone`: The Helm chart.
- `e2e`: End-to-end and load scripts. See [e2e/README.md](e2e/README.md).
- `docs/operations`: [Performance](docs/operations/performance.md), [backup and restore](docs/operations/backup-restore.md), and [accessibility](docs/operations/accessibility.md).
