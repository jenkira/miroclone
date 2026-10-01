# CLAUDE.md

This file gives Claude Code the context it needs to work in this repository.

## Project

Miroclone is an internal, self-hosted collaborative whiteboard that offers the
core capabilities of Miro. The repository holds the product requirements
document (PRD) and the code, organised as a pnpm monorepo:

- `packages/shared`: Object model, board operations, roles, classifications,
  export, templates, workshop state, and the PDF writer.
- `packages/server-core`: Database migrations, sessions, persistence, search,
  versions, object storage, and metrics shared by the services.
- `services/api`: Fastify API service (sign-in, boards, sharing, spaces,
  comments, files, workshop, exports, administration, migration import).
- `services/collab`: Hocuspocus collaboration service with role enforcement.
- `services/worker`: Background jobs (email, purge, search index, versions,
  compaction).
- `apps/web`: React and PixiJS client.
- `tools/miro-migrate`: Command-line tool that converts Miro boards. It runs
  outside the PROTECTED environment.
- `deploy/helm/miroclone`: Helm chart for RKE2, with monitoring and network
  policies.
- `docker`, `e2e`: Image builds, and end-to-end and load scripts that run
  against a real stack. See `e2e/README.md`.
- `docs`: The PRD and the operations guides (performance, backup and restore,
  accessibility).

Run `pnpm install`, `pnpm typecheck`, and `pnpm test` from the repository root.
The end-to-end scripts need the local stack that `e2e/README.md` describes.

The source of truth for scope, requirements, and architecture is
[`docs/PRD.md`](docs/PRD.md). Read it before you propose a design or write
code.

## Fixed constraints

Every change must respect the following constraints. Raise a conflict with
the user instead of working around it.

- **Hosting**: On-premises Rancher Kubernetes Engine 2 (RKE2), with the CIS
  hardening profile, Pod Security Admission set to `restricted`, SELinux
  enforcing, and support for air-gapped installs. No cloud hosting of board
  content or files.
- **Identity**: Microsoft Entra ID through OpenID Connect (OIDC). No local
  accounts. The only outbound calls are to Entra ID and Microsoft Graph.
- **Clearance**: Every user or guest in Entra ID with an app role is cleared
  for PROTECTED.
- **Classification**: Boards hold information up to PROTECTED, under both the
  Protective Security Policy Framework (PSPF) and the Queensland Government
  Information Security Classification Framework (QGISCF).
- **Secrets**: Passwordstate, synced into Kubernetes by External Secrets
  Operator (ESO). Services read only standard Kubernetes Secrets. Never put
  secret values in source control, Helm values, or images.
- **Object storage**: Any S3-compatible store, through the standard S3 API
  only.
- **Scope**: Internal use only. No pricing, billing, plan limits, or public
  sharing.
- **Licences**: Use permissive open-source licences, such as MIT or
  Apache 2.0. Don't add dependencies that need a paid licence for production
  use. For example, the PRD rejects tldraw for this reason.

## Planned stack

The PRD recommends the following stack:

- **Web client**: React, TypeScript, PixiJS, and Yjs.
- **API service**: Node.js and TypeScript.
- **Collaboration service**: Hocuspocus, with Redis for fan-out between pods.
- **Data**: PostgreSQL through CloudNativePG, Redis or Valkey, and
  S3-compatible object storage.
- **Deployment**: One Helm chart.

## Writing style

Write all documents, commit messages, pull request descriptions, and replies
to the user in the Google developer documentation style. The main rules are
the following:

- Use Australian English spelling, such as "organisation" and "licence".
- Address the reader as "you". Use active voice and present tense.
- Use sentence case for headings. Start task headings with a verb.
- Introduce every list and table with a complete sentence.
- Use a table only when each item has three or more related data points.
- Define every acronym on first use. Use serial commas.
- Write dates as "30 September 2026".
- Avoid "please", "simply", "just", "should", "may", "via", "e.g.", and
  "etc.".

## PRD conventions

Follow these rules when you edit `docs/PRD.md`:

- Increase the version in the header table, and add a row to the change
  history table in section 1.1.
- Give each requirement an ID with its area prefix (such as `IAM-`, `PMK-`,
  or `CNV-`) and a priority from P0 to P2. Don't renumber existing IDs.
  Add new IDs at the end of their area.
- Number and caption each table, such as "Table 4. Identity and access
  requirements". Renumber later tables when you add one.
- When the user answers an open question, move it to the answered questions
  table in section 12.1, with the answer and the sections it changed. Keep
  question IDs stable.
- Update section references when you renumber sections.
- Add a row to the risks table for any new risk that an answer or change
  creates, and tell the user about it.
- Add each new source to section 13.

## Git workflow

Follow these rules for Git:

- Make changes on a feature branch and open a draft pull request against
  `main`.
- Write commit messages as a short imperative summary line, such as
  "Add secrets section to the PRD".

## Working with the user

Follow these rules when you reply to the user:

- Lead replies with the result, then the detail.
- If the user adds a comment in the middle of a task, ask whether they want
  to change direction now or note the comment for later. Wait for the answer.
