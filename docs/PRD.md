# Product requirements document: internal collaborative whiteboard

| Field | Value |
|---|---|
| Status | Draft for review |
| Version | 0.1 |
| Date | 30 September 2026 |
| Owner | To be confirmed |
| Working name | Miroclone |

## 1. Purpose

This document defines the requirements for an internal, self-hosted visual
collaboration whiteboard that offers the core capabilities of Miro. The
product runs on Kubernetes, uses Microsoft Entra ID for single sign-on (SSO),
and serves staff only. It has no commercial features such as pricing tiers,
billing, or usage limits.

Use this document to agree on scope, prioritise work, and guide architecture
decisions before development starts.

## 2. Background and research

### 2.1 Reference product

Miro is a hosted infinite-canvas whiteboard. Its core capabilities include the
following:

- An infinite canvas for brainstorming, diagramming, and mind maps.
- Real-time co-editing with live cursors, comments, and sharing.
- A template library for common workshops and diagrams.
- Workshop tools such as voting, timers, and presentation mode.
- Integrations with tools such as Jira, Trello, and Google Drive.

Miro's plan structure (Free, Starter, Business, and Enterprise) and its
board limits are out of scope for this product, because it serves internal
users only.

### 2.2 Open-source landscape

The research reviewed the main open-source building blocks for a
collaborative whiteboard. The following table summarises the findings.

Table 1. Candidate building blocks

| Component | Role | Licence | Assessment |
|---|---|---|---|
| tldraw | Canvas SDK with shapes, tools, and multiplayer | Source-available; production use needs a paid licence (from September 2025) | Rejected. The licence adds a commercial dependency, even for internal use. |
| Excalidraw | Hand-drawn style whiteboard app and React component | MIT | Useful reference and possible source of parts. Its data model and visual style don't match Miro-style objects such as sticky notes, frames, and cards. |
| Yjs | Conflict-free replicated data type (CRDT) library for shared state | MIT | Recommended for board state synchronisation. It's fast, mature, and supports offline editing. |
| Hocuspocus | WebSocket server for Yjs with auth hooks, persistence, and Redis scaling | MIT | Recommended as the real-time collaboration server. |
| PixiJS | WebGL 2D renderer | MIT | Recommended for rendering thousands of objects at interactive frame rates. |

### 2.3 Build approach

The recommended approach is to build a custom canvas engine on PixiJS, with
board state held in Yjs documents and synchronised through Hocuspocus. This
approach avoids licence risk, gives full control over the object model, and
uses proven MIT-licensed components for the hardest problems (sync and
rendering).

The main trade-off is effort. A custom canvas engine takes longer to build
than an embedded SDK. Section 11 lists this as a risk.

## 3. Goals and non-goals

### 3.1 Goals

The product has the following goals:

- Give staff a secure internal whiteboard for workshops, planning, and
  diagramming.
- Keep all board content inside infrastructure that the organisation
  controls.
- Use existing Entra identities and groups, so users don't manage separate
  accounts.
- Support smooth real-time collaboration for workshop-sized groups.
- Run as a standard Kubernetes workload that platform teams can operate with
  existing tools.

### 3.2 Non-goals

The following items are out of scope:

- Pricing, billing, subscriptions, trials, and plan limits.
- Public sign-up, local accounts, and social login.
- Anonymous or public link sharing outside the organisation.
- A marketplace for third-party apps.
- Native desktop and mobile apps. The web app must work on tablets, but
  native apps aren't planned.
- Full feature parity with Miro. The product targets the capabilities that
  internal teams use most.

## 4. Users

The following table describes the primary user types.

Table 2. User types

| User type | Description | Key needs |
|---|---|---|
| Facilitator | Runs workshops, retrospectives, and planning sessions | Templates, timers, voting, presentation mode, and control over who can edit |
| Participant | Joins sessions and contributes content | Fast sign-in, simple tools, and clear view of where others are working |
| Diagrammer | Creates architecture diagrams, flowcharts, and process maps | Shapes, connectors, alignment tools, and export |
| Viewer | Reviews finished boards | Read-only access, comments, and search |
| Platform administrator | Deploys and operates the service | Helm-based deployment, observability, backups, and audit logs |
| Service administrator | Manages the product inside the app | Board ownership transfer, retention settings, and audit review |

## 5. Key use cases

The product supports the following use cases:

1. A facilitator creates a retrospective board from a template, shares it with
   an Entra group, and runs a timed session with dot voting.
2. An engineer draws a system architecture diagram with shapes and
   connectors, then exports it as a PNG image for a design document.
3. A team keeps a long-lived planning board that several people edit over
   weeks and review through version history.
4. A manager presents a board frame by frame in a meeting, while participants
   follow the presenter's view.
5. A user who loses network access keeps editing, and the board merges their
   changes when the connection returns.

## 6. Functional requirements

Each requirement has a priority:

- **P0**: Required for the first release.
- **P1**: Required for general availability.
- **P2**: Planned after general availability.

### 6.1 Identity and access

Table 3. Identity and access requirements

| ID | Requirement | Priority |
|---|---|---|
| IAM-1 | Users sign in with Entra ID through OpenID Connect (OIDC), using the authorisation code flow with Proof Key for Code Exchange (PKCE). | P0 |
| IAM-2 | The app creates a user profile on first sign-in (just-in-time provisioning) from ID token claims: object ID, display name, email, and tenant ID. | P0 |
| IAM-3 | The app rejects sign-ins from any tenant other than the configured tenant. | P0 |
| IAM-4 | Entra app roles control service-level access: `Whiteboard.User` and `Whiteboard.Admin`. Users without a role can't sign in. | P0 |
| IAM-5 | Board owners share boards with individual users and Entra security groups, found through a people picker backed by Microsoft Graph. | P0 |
| IAM-6 | Each board member has one role: owner, editor, commenter, or viewer. | P0 |
| IAM-7 | Owners can make a board visible to everyone in the organisation, with a chosen default role. | P1 |
| IAM-8 | The app handles group overage (users in more than 200 groups) by resolving memberships through Microsoft Graph. | P1 |
| IAM-9 | The app ends sessions within a configurable period (default 8 hours) and re-checks role assignments on each session refresh. | P1 |
| IAM-10 | The app supports Entra B2B guest users, if the organisation allows them. | P2 |

### 6.2 Boards and organisation

Table 4. Board management requirements

| ID | Requirement | Priority |
|---|---|---|
| BRD-1 | Users create, rename, duplicate, and delete boards. Deleted boards stay in a recycle bin for 30 days. | P0 |
| BRD-2 | A dashboard lists recent, owned, shared, and starred boards, with thumbnails. | P0 |
| BRD-3 | Users organise boards into spaces (folders) that they can share with users and groups. | P1 |
| BRD-4 | Users search board titles and board text content. | P1 |
| BRD-5 | Owners transfer board ownership. Service administrators can reassign boards when an owner leaves. | P1 |
| BRD-6 | The app keeps version history and lets editors restore a named or automatic version. | P1 |

### 6.3 Canvas and objects

Table 5. Canvas requirements

| ID | Requirement | Priority |
|---|---|---|
| CNV-1 | The canvas is infinite, with pan, zoom (1% to 400%), zoom to fit, and zoom to selection. | P0 |
| CNV-2 | Users add sticky notes in a set of colours, with auto-sizing text. | P0 |
| CNV-3 | Users add basic shapes (rectangle, rounded rectangle, ellipse, triangle, diamond, and others) with fill, border, and text. | P0 |
| CNV-4 | Users add free text with basic formatting: bold, italic, underline, size, colour, alignment, lists, and links. | P0 |
| CNV-5 | Users draw freehand with a pen and highlighter, and erase strokes. | P0 |
| CNV-6 | Users draw connectors (straight, elbow, and curved) that attach to objects and stay attached when objects move. | P0 |
| CNV-7 | Users create frames that group content and act as slides for presentation and export. | P0 |
| CNV-8 | Users upload images (PNG, JPEG, GIF, SVG, and WebP) by file picker, drag and drop, or paste. | P0 |
| CNV-9 | Users select, move, resize, rotate, group, ungroup, lock, and delete objects, and change their stacking order. | P0 |
| CNV-10 | Users undo and redo their own changes, without undoing other users' changes. | P0 |
| CNV-11 | Users copy, cut, paste, and duplicate objects, including between boards. | P0 |
| CNV-12 | The canvas shows snapping guides, and users align and distribute selected objects. | P1 |
| CNV-13 | A minimap shows the whole board and the current viewport. | P1 |
| CNV-14 | Users add cards with a title, description, assignee, due date, and tags. | P1 |
| CNV-15 | Users build mind maps with keyboard shortcuts to add child and sibling nodes. | P2 |
| CNV-16 | Users add tables with editable cells. | P2 |
| CNV-17 | Users embed files (PDF preview) and links with previews. | P2 |

### 6.4 Real-time collaboration

Table 6. Collaboration requirements

| ID | Requirement | Priority |
|---|---|---|
| COL-1 | All changes sync to every connected user in real time, with automatic conflict resolution. | P0 |
| COL-2 | The canvas shows each user's cursor with their name and colour. | P0 |
| COL-3 | A presence list shows who's on the board. Users can jump to another user's location. | P0 |
| COL-4 | The app saves changes automatically. It has no save button. | P0 |
| COL-5 | The app shows connection status, and users keep editing while offline. Changes merge when the connection returns. | P1 |
| COL-6 | Users follow another user's viewport (follow mode). A facilitator can bring everyone to their view. | P1 |
| COL-7 | Users add comments on objects or canvas locations, reply in threads, resolve threads, and mention people with `@`. | P1 |
| COL-8 | The app notifies users of mentions and replies in the app and by email. | P1 |
| COL-9 | The app sends notifications to Microsoft Teams. | P2 |

### 6.5 Workshop tools

Table 7. Workshop requirements

| ID | Requirement | Priority |
|---|---|---|
| WSH-1 | A template library offers built-in templates: retrospective, kanban, brainstorm, flowchart, user story map, and SWOT analysis. | P1 |
| WSH-2 | Users save any board or frame as an organisation template. | P1 |
| WSH-3 | Facilitators start a shared countdown timer that all participants see. | P1 |
| WSH-4 | Facilitators run a voting session with a vote limit per person, anonymous or named votes, and a results view. | P1 |
| WSH-5 | Users present frames in order, full screen, with participants following the presenter. | P1 |
| WSH-6 | Participants send short emoji reactions during a session. | P2 |
| WSH-7 | Facilitators temporarily lock the board or hide other participants' content until a reveal (private mode). | P2 |

### 6.6 Import and export

Table 8. Import and export requirements

| ID | Requirement | Priority |
|---|---|---|
| EXP-1 | Users export a board, frame, or selection as PNG or SVG. | P0 |
| EXP-2 | Users export frames as a multi-page PDF. | P1 |
| EXP-3 | Users export and import a whole board as a JSON file for backup and transfer. | P1 |
| EXP-4 | Users import sticky notes from a CSV file. | P2 |
| EXP-5 | Users import boards from Miro through the Miro REST API. See open question Q4. | P2 |

### 6.7 Administration

Table 9. Administration requirements

| ID | Requirement | Priority |
|---|---|---|
| ADM-1 | The app records an audit log of sign-ins, board creation, sharing changes, exports, and deletions. | P0 |
| ADM-2 | The app sends audit events to standard output in JSON, for collection by the cluster's logging stack. | P0 |
| ADM-3 | Service administrators view usage statistics: active users, boards, and storage used. | P1 |
| ADM-4 | Service administrators set retention rules, such as archiving boards that nobody opens for 12 months. | P2 |

## 7. Non-functional requirements

### 7.1 Performance and scale

Table 10. Performance targets

| ID | Requirement | Target |
|---|---|---|
| PRF-1 | Frame rate while panning and zooming a board with 5,000 objects on a standard staff laptop | 60 frames per second (fps); no lower than 30 fps |
| PRF-2 | Maximum objects per board | 20,000 |
| PRF-3 | Change propagation between users in the same region | 95th percentile (p95) under 200 ms |
| PRF-4 | Time to open a board with 1,000 objects | p95 under 2 seconds |
| PRF-5 | Concurrent editors per board | 50 editors and 200 viewers |
| PRF-6 | Total concurrent users across the service | 2,000, scaling horizontally |

### 7.2 Availability and recovery

The service meets the following availability and recovery targets:

- **Availability**: 99.5% during business hours, excluding planned
  maintenance.
- **Recovery point objective (RPO)**: 15 minutes.
- **Recovery time objective (RTO)**: 4 hours.
- **Zero-downtime deployment**: Rolling updates drain WebSocket connections
  gracefully, and clients reconnect without losing changes.

### 7.3 Accessibility and compatibility

The product meets the following requirements:

- Conforms to Web Content Accessibility Guidelines (WCAG) 2.2 level AA for
  all non-canvas UI.
- Supports full keyboard navigation of the canvas, including moving focus
  between objects, and exposes object text to screen readers.
- Supports the current and previous major versions of Microsoft Edge, Google
  Chrome, Mozilla Firefox, and Apple Safari.
- Works with touch and pen input on tablets.

### 7.4 Security and privacy

The product meets the following security requirements:

- Encrypts all traffic with TLS 1.2 or later, including WebSocket traffic.
- Encrypts data at rest in the database and object storage.
- Authenticates every WebSocket connection when it opens and checks the
  user's board role before it sends any board data.
- Enforces roles on the server for every change. For example, the server
  drops updates from viewers and commenters.
- Stores session tokens in secure, `HttpOnly`, `SameSite` cookies. The
  browser never holds Entra access tokens.
- Applies a strict Content Security Policy and sanitises all user-supplied
  SVG and rich text.
- Scans uploaded files for malware before other users can download them.
- Makes no calls to external services except Entra ID and Microsoft Graph,
  unless an administrator turns on an integration.
- Passes an internal security assessment before general availability.

## 8. Architecture

### 8.1 Components

The system has the following components:

1. **Web client**: A React and TypeScript single-page app. PixiJS renders the
   canvas. A DOM overlay handles text editing. Yjs holds board state, and
   IndexedDB caches it for offline use.
2. **API service**: A Node.js and TypeScript service. It handles the OIDC
   sign-in (as a backend for frontend), sessions, boards, sharing, comments,
   search, templates, and exports.
3. **Collaboration service**: A Hocuspocus server that syncs Yjs documents
   over WebSockets. It checks sessions and board roles through hooks, stores
   document state in PostgreSQL, and uses Redis to fan out updates between
   pods.
4. **Worker service**: Background jobs for thumbnails, PDF and image export,
   search indexing, malware scanning, and snapshot compaction.
5. **PostgreSQL**: Stores users, boards, memberships, comments, audit events,
   and Yjs document snapshots and updates.
6. **Redis**: Handles collaboration pub/sub, session storage, and the job
   queue.
7. **Object storage**: An S3-compatible store (for example, Azure Blob Storage
   through an S3 gateway, or MinIO) for images, files, exports, and
   thumbnails.

### 8.2 Board data model

Each board is one Yjs document. The document holds a map of objects keyed by
unique ID. Each object stores its type, position, size, rotation, style,
content, and a fractional index for stacking order. Connectors store the IDs
of the objects they attach to.

The collaboration service stores incremental updates and periodically
compacts them into snapshots. Version history uses these snapshots.

Relational data, such as boards, members, comments, and audit events, lives in
PostgreSQL tables outside the Yjs document. This design keeps access control
out of the client-editable document.

### 8.3 Sign-in flow

The sign-in flow works as follows:

1. The user opens the app. The API service redirects them to Entra ID with an
   authorisation request that uses PKCE.
2. Entra ID authenticates the user, applying the organisation's conditional
   access and multi-factor authentication (MFA) policies.
3. Entra ID redirects back to the API service with an authorisation code.
4. The API service exchanges the code for tokens, validates the ID token,
   checks the tenant and app role, and creates or updates the user profile.
5. The API service creates a server-side session and sets a session cookie.
6. The web client opens a WebSocket to the collaboration service. The
   collaboration service validates the session cookie and the user's board
   role before it syncs the document.

The API service uses delegated Microsoft Graph permissions
(`User.ReadBasic.All` and `GroupMember.Read.All`) for the people picker and
group resolution. These permissions need tenant administrator consent.

### 8.4 Kubernetes deployment

The product ships as a Helm chart with the following characteristics:

- Separate Deployments for the web client (static files served by NGINX),
  the API service, the collaboration service, and the worker service.
- An Ingress (or Gateway API route) with TLS certificates from cert-manager.
  The route for the collaboration service supports WebSockets, allows
  idle timeouts of at least 1 hour, and uses consistent hashing on board ID,
  so users of the same board usually reach the same pod.
- Horizontal Pod Autoscalers for the API, collaboration, and worker services.
  The collaboration service scales on active connections.
- Pod Disruption Budgets, and a pre-stop hook that drains WebSocket
  connections before a pod stops.
- Liveness, readiness, and startup probes on every service.
- NetworkPolicies that allow only the required traffic between components.
- Secrets supplied through the External Secrets Operator or the Secrets Store
  CSI driver, backed by Azure Key Vault or the cluster's existing vault. The
  chart never stores secrets in values files.
- Support for Azure Workload Identity when the cluster runs on Azure
  Kubernetes Service (AKS).
- Containers that run as non-root, with read-only root file systems.
- Options to use managed PostgreSQL and Redis, or in-cluster operators such
  as CloudNativePG.

### 8.5 Observability

The services meet the following observability requirements:

- Emit structured JSON logs.
- Expose Prometheus metrics, including active connections, documents loaded,
  sync latency, and update sizes.
- Emit OpenTelemetry traces for API and collaboration requests.
- Ship Grafana dashboards and alert rules in the Helm chart.

### 8.6 Backup and restore

The deployment meets the following backup requirements:

- Takes continuous PostgreSQL backups with point-in-time recovery, to meet
  the 15-minute RPO.
- Turns on versioning and soft delete in object storage.
- Documents and tests the restore procedure every quarter.

## 9. Release plan

The following table shows the planned releases. Durations assume a team of
four to five engineers and are estimates only.

Table 11. Release plan

| Release | Scope | Estimated duration |
|---|---|---|
| R0: Foundations | Repository, continuous integration, Helm chart skeleton, Entra sign-in, and a canvas prototype that proves the performance targets | 4 to 6 weeks |
| R1: Pilot | All P0 requirements, released to one or two pilot teams | 10 to 12 weeks |
| R2: General availability | All P1 requirements, security assessment, accessibility audit, and load testing | 10 to 12 weeks |
| R3: Enhancements | P2 requirements, chosen by pilot and general availability feedback | Ongoing |

R0 is a decision point. If the canvas prototype can't reach PRF-1 and PRF-3,
the team reviews the build approach before R1 starts.

## 10. Success measures

The product uses the following success measures:

- **Adoption**: Weekly active users and boards created per week, measured
  from the audit log.
- **Satisfaction**: At least 4 out of 5 average rating in a pilot survey.
- **Reliability**: Availability and sync latency targets met for three
  consecutive months after general availability.
- **Performance**: PRF targets met in load tests before each release.

## 11. Risks

Table 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A custom canvas engine takes longer than planned. | Delays the pilot. | Prove the engine in R0. Limit P0 object types. Reuse MIT-licensed code from Excalidraw where it fits. |
| Yjs documents grow large on long-lived boards. | Slow board loading and high memory use. | Compact updates into snapshots, use garbage collection, and enforce the PRF-2 object limit. |
| Corporate proxies or ingress timeouts drop WebSocket connections. | Frequent reconnections. | Set long idle timeouts, send heartbeats, and reconnect automatically with backoff. |
| Canvas apps are hard to make accessible. | Fails the WCAG requirement for some users. | Design keyboard and screen reader support from R1, and schedule an audit in R2. |
| Entra configuration needs tenant administrator time. | Blocks R0 sign-in work. | Request the app registration, app roles, and Graph consent at project start. |
| Users rely on Miro-specific features the product lacks. | Low adoption. | Survey current Miro users before R1 and adjust priorities. |

## 12. Open questions

The following questions need answers before or during R0:

- **Q1**: Which cluster hosts the product: AKS, another managed service, or
  an on-premises cluster? The answer affects storage, secrets, and identity
  options.
- **Q2**: What is the highest data classification that boards can hold? The
  answer affects encryption, retention, and export controls.
- **Q3**: Can Entra B2B guest users use the product (IAM-10)?
- **Q4**: Do teams need to migrate existing Miro boards (EXP-5)? If so, how
  many boards, and what content types?
- **Q5**: Is a Microsoft Teams integration (such as a Teams tab or
  notifications) a priority?
- **Q6**: Do users want AI features, such as summarising sticky notes or
  clustering ideas? If so, which internally approved model service can the
  product use?
- **Q7**: Which data residency requirements apply to the database and object
  storage?

## 13. References

The research for this document used the following sources:

- [Is Miro free? Plans, limits, and pricing explained (2026)](https://boardmix.com/whiteboard/is-miro-free/)
- [Miro pricing (2026): Free vs Starter vs Business vs Enterprise](https://www.aimadefor.com/blog/miro-pricing-2026/)
- [tldraw vs Excalidraw vs Quickdraw: choosing a whiteboard library](https://tryquickdraw.com/blog/tldraw-vs-excalidraw-vs-quickdraw)
- [How to build a real-time collaboration whiteboard app in 2026](https://kanopylabs.com/blog/how-to-build-a-real-time-collaboration-whiteboard-app)
- [Yjs documentation](https://docs.yjs.dev/)
- [Hocuspocus documentation](https://tiptap.dev/docs/hocuspocus/introduction)
- [Microsoft identity platform: OAuth 2.0 authorisation code flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Google developer documentation style guide](https://developers.google.com/style)
