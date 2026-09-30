# Product requirements document: internal collaborative whiteboard

| Field | Value |
|---|---|
| Status | Draft for review |
| Version | 0.3 |
| Date | 30 September 2026 |
| Owner | To be confirmed |
| Working name | Miroclone |
| Highest classification | PROTECTED |

## 1. Purpose

This document defines the requirements for an internal, self-hosted visual
collaboration whiteboard that offers the core capabilities of Miro. The
product has the following characteristics:

- Runs on an on-premises Rancher Kubernetes Engine 2 (RKE2) cluster.
- Uses Microsoft Entra ID for single sign-on (SSO).
- Holds information classified up to PROTECTED.
- Serves staff only, with no commercial features such as pricing tiers,
  billing, or usage limits.

Use this document to agree on scope, prioritise work, and guide architecture
decisions before development starts.

### 1.1 Change history

The following table lists changes to this document.

Table 1. Change history

| Version | Date | Change |
|---|---|---|
| 0.1 | 30 September 2026 | First draft. |
| 0.2 | 30 September 2026 | Set the hosting platform to on-premises RKE2, set the highest classification to PROTECTED, and added Miro migration requirements. |
| 0.3 | 30 September 2026 | Recorded answers to Q8 to Q11: both marking frameworks, all Entra users cleared, offline caching allowed, and MinIO for object storage. Set Passwordstate as the secrets repository. |

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

Table 2. Candidate building blocks

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

Self-hosting also suits the PROTECTED classification. All board content
stays on infrastructure that the organisation controls and has authorised.

The main trade-off is effort. A custom canvas engine takes longer to build
than an embedded SDK. Section 11 lists this as a risk.

## 3. Goals and non-goals

### 3.1 Goals

The product has the following goals:

- Give staff a secure internal whiteboard for workshops, planning, and
  diagramming.
- Keep all board content inside the organisation's on-premises
  infrastructure.
- Handle information up to PROTECTED, with protective markings on every board
  and export.
- Use existing Entra identities and groups, so users don't manage separate
  accounts.
- Support smooth real-time collaboration for workshop-sized groups.
- Run as a standard RKE2 workload that platform teams can operate with
  existing tools.
- Let teams move existing boards from Miro, if they need to.

### 3.2 Non-goals

The following items are out of scope:

- Pricing, billing, subscriptions, trials, and plan limits.
- Public sign-up, local accounts, and social login.
- Anonymous or public link sharing outside the organisation.
- Information classified above PROTECTED.
- Cloud hosting of any board content or files.
- A marketplace for third-party apps.
- Native desktop and mobile apps. The web app must work on tablets, but
  native apps aren't planned.
- Full feature parity with Miro. The product targets the capabilities that
  internal teams use most.

## 4. Users

The following table describes the primary user types.

Table 3. User types

| User type | Description | Key needs |
|---|---|---|
| Facilitator | Runs workshops, retrospectives, and planning sessions | Templates, timers, voting, presentation mode, and control over who can edit |
| Participant | Joins sessions and contributes content | Fast sign-in, simple tools, and clear view of where others are working |
| Diagrammer | Creates architecture diagrams, flowcharts, and process maps | Shapes, connectors, alignment tools, and export |
| Viewer | Reviews finished boards | Read-only access, comments, and search |
| Platform administrator | Deploys and operates the service on RKE2 | Helm-based deployment, observability, backups, and audit logs |
| Service administrator | Manages the product inside the app | Board ownership transfer, retention settings, migration, and audit review |
| Security officer | Oversees the system's security authorisation | Audit logs, protective marking controls, and evidence for assessment |

## 5. Key use cases

The product supports the following use cases:

1. A facilitator creates a retrospective board from a template, shares it with
   an Entra group, and runs a timed session with dot voting.
2. An engineer draws a system architecture diagram with shapes and
   connectors, then exports it as a PNG image, marked with the board's
   classification, for a design document.
3. A team keeps a long-lived PROTECTED planning board that several people
   edit over weeks and review through version history.
4. A manager presents a board frame by frame in a meeting, while participants
   follow the presenter's view.
5. A user who loses network access keeps editing, and the board merges their
   changes when the connection returns.
6. A team moves its existing Miro boards into the product, and the import
   report lists any content that didn't transfer.

## 6. Functional requirements

Each requirement has a priority:

- **P0**: Required for the first release.
- **P1**: Required for general availability.
- **P2**: Planned after general availability.

### 6.1 Identity and access

Table 4. Identity and access requirements

| ID | Requirement | Priority |
|---|---|---|
| IAM-1 | Users sign in with Entra ID through OpenID Connect (OIDC), using the authorisation code flow with Proof Key for Code Exchange (PKCE). | P0 |
| IAM-2 | The app creates a user profile on first sign-in (just-in-time provisioning) from ID token claims: object ID, display name, email, and tenant ID. | P0 |
| IAM-3 | The app rejects sign-ins from any tenant other than the configured tenant. | P0 |
| IAM-4 | Entra app roles control service-level access: `Whiteboard.User` and `Whiteboard.Admin`. Users without a role can't sign in. | P0 |
| IAM-5 | Board owners share boards with individual users and Entra security groups, found through a people picker backed by Microsoft Graph. | P0 |
| IAM-6 | Each board member has one role: owner, editor, commenter, or viewer. | P0 |
| IAM-7 | Entra conditional access enforces multi-factor authentication (MFA) and device compliance for the app registration. The app checks the `amr` claim and rejects sessions without MFA. | P0 |
| IAM-8 | Owners can make a board visible to everyone in the organisation, with a chosen default role. The app blocks this option on PROTECTED boards. | P1 |
| IAM-9 | The app handles group overage (users in more than 200 groups) by resolving memberships through Microsoft Graph. | P1 |
| IAM-10 | The app ends sessions after a configurable idle period and a maximum lifetime, set to meet the Information Security Manual (ISM). It re-checks role assignments on each session refresh. | P1 |
| IAM-11 | The app treats every user in the configured tenant with an app role as cleared for PROTECTED, and doesn't check clearance separately. The process for assigning the `Whiteboard.User` role must confirm that the user is cleared. | P0 |
| IAM-12 | The app supports Entra B2B guest users, if the organisation allows them. Guests can't open PROTECTED boards. | P2 |

### 6.2 Boards and organisation

Table 5. Board management requirements

| ID | Requirement | Priority |
|---|---|---|
| BRD-1 | Users create, rename, duplicate, and delete boards. Deleted boards stay in a recycle bin for 30 days. | P0 |
| BRD-2 | A dashboard lists recent, owned, shared, and starred boards, with thumbnails and each board's classification. | P0 |
| BRD-3 | Users organise boards into spaces (folders) that they can share with users and groups. | P1 |
| BRD-4 | Users search board titles and board text content. Results show only boards the user can open. | P1 |
| BRD-5 | Owners transfer board ownership. Service administrators can reassign boards when an owner leaves. | P1 |
| BRD-6 | The app keeps version history and lets editors restore a named or automatic version. | P1 |

### 6.3 Protective markings

The product must handle information classified up to PROTECTED under both
the Protective Security Policy Framework (PSPF) and the Queensland Government
Information Security Classification Framework (QGISCF).

Table 6. Protective marking requirements

| ID | Requirement | Priority |
|---|---|---|
| PMK-1 | Every board has one classification from a list that covers both frameworks. The default list, from lowest to highest, is OFFICIAL, OFFICIAL: Sensitive (PSPF), SENSITIVE (QGISCF), and PROTECTED. Administrators configure the list, the order, and the default for new boards. | P0 |
| PMK-2 | The board shows its classification in a banner at the top and bottom of the screen, in text and colour. | P0 |
| PMK-3 | Board owners can raise a board's classification. Lowering it needs the owner to confirm and give a reason, and the app records the change in the audit log. | P0 |
| PMK-4 | Every export (PNG, SVG, PDF, and JSON) carries the board's classification in the file, and in the header and footer of visual exports. | P0 |
| PMK-5 | The app warns users, and records an audit event, when they paste content from a board into a board with a lower classification. | P1 |
| PMK-6 | Users can add information management markers (IMMs) and caveats to a board, if the agency uses them. | P2 |
| PMK-7 | Administrators define which markings are equivalent across the two frameworks, such as OFFICIAL: Sensitive and SENSITIVE. The app uses these equivalences when it compares classifications, for example in PMK-5. | P1 |

### 6.4 Canvas and objects

Table 7. Canvas requirements

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
| CNV-17 | Users embed files (PDF preview) and links. Link previews use only internal fetching, and never call external sites from PROTECTED boards. | P2 |

### 6.5 Real-time collaboration

Table 8. Collaboration requirements

| ID | Requirement | Priority |
|---|---|---|
| COL-1 | All changes sync to every connected user in real time, with automatic conflict resolution. | P0 |
| COL-2 | The canvas shows each user's cursor with their name and colour. | P0 |
| COL-3 | A presence list shows who's on the board. Users can jump to another user's location. | P0 |
| COL-4 | The app saves changes automatically. It has no save button. | P0 |
| COL-5 | The app shows connection status, and users keep editing while offline. Changes merge when the connection returns. This applies to boards at every classification. | P1 |
| COL-6 | Users follow another user's viewport (follow mode). A facilitator can bring everyone to their view. | P1 |
| COL-7 | Users add comments on objects or canvas locations, reply in threads, resolve threads, and mention people with `@`. | P1 |
| COL-8 | The app notifies users of mentions and replies in the app, and by email through the internal mail relay. Emails contain a link and the board's classification, but no board content. | P1 |
| COL-9 | The app sends notifications to Microsoft Teams, if the agency approves it. Notifications contain no board content. | P2 |
| COL-10 | The app clears cached board content from the browser when the user signs out or the session ends. Offline caching relies on managed devices with full-disk encryption, which conditional access enforces (IAM-7). | P1 |

### 6.6 Workshop tools

Table 9. Workshop requirements

| ID | Requirement | Priority |
|---|---|---|
| WSH-1 | A template library offers built-in templates: retrospective, kanban, brainstorm, flowchart, user story map, and SWOT analysis. | P1 |
| WSH-2 | Users save any board or frame as an organisation template. | P1 |
| WSH-3 | Facilitators start a shared countdown timer that all participants see. | P1 |
| WSH-4 | Facilitators run a voting session with a vote limit per person, anonymous or named votes, and a results view. | P1 |
| WSH-5 | Users present frames in order, full screen, with participants following the presenter. | P1 |
| WSH-6 | Participants send short emoji reactions during a session. | P2 |
| WSH-7 | Facilitators temporarily lock the board or hide other participants' content until a reveal (private mode). | P2 |

### 6.7 Import and export

Table 10. Import and export requirements

| ID | Requirement | Priority |
|---|---|---|
| EXP-1 | Users export a board, frame, or selection as PNG or SVG. | P0 |
| EXP-2 | Users export frames as a multi-page PDF. | P1 |
| EXP-3 | Users export and import a whole board as a JSON file for backup and transfer. | P1 |
| EXP-4 | Users import sticky notes from a CSV file. | P2 |
| EXP-5 | Administrators can turn off export, or limit it to owners, for each classification. | P1 |

### 6.8 Miro migration

Teams might need to move existing boards from Miro. Miro is a cloud service,
so the migration can't run inside the PROTECTED environment. A separate
migration tool reads boards through the Miro REST API and writes files in the
product's JSON import format (EXP-3). An administrator then transfers the
files through an approved path and imports them.

These requirements apply only if the migration goes ahead. See open question
Q4.

Table 11. Migration requirements

| ID | Requirement | Priority |
|---|---|---|
| MIG-1 | The migration tool exports boards through the Miro REST API, given a Miro access token with read access. | P1 |
| MIG-2 | The tool converts sticky notes, shapes, text, connectors, frames, images, and cards into the product's object model, keeping position, size, colour, and text. | P1 |
| MIG-3 | The tool replaces unsupported items with a placeholder that names the original item type. | P1 |
| MIG-4 | The tool writes a report for each board that lists converted items, placeholders, and errors. | P1 |
| MIG-5 | Administrators bulk import converted boards, assign owners by matching email addresses to Entra users, and set each board's classification. | P1 |
| MIG-6 | The tool keeps comments, with the original author's name and date as text. | P2 |

### 6.9 Administration

Table 12. Administration requirements

| ID | Requirement | Priority |
|---|---|---|
| ADM-1 | The app records an audit log of sign-ins, board access, board creation, sharing changes, classification changes, exports, imports, and deletions. | P0 |
| ADM-2 | The app sends audit events to standard output in JSON, for collection by the cluster's logging stack and forwarding to the security information and event management (SIEM) system. | P0 |
| ADM-3 | Service administrators view usage statistics: active users, boards by classification, and storage used. | P1 |
| ADM-4 | Service administrators set retention rules that meet the agency's records management obligations, such as archiving boards that nobody opens for 12 months. | P2 |

## 7. Non-functional requirements

### 7.1 Performance and scale

Table 13. Performance targets

| ID | Requirement | Target |
|---|---|---|
| PRF-1 | Frame rate while panning and zooming a board with 5,000 objects on a standard staff laptop | 60 frames per second (fps); no lower than 30 fps |
| PRF-2 | Maximum objects per board | 20,000 |
| PRF-3 | Change propagation between users on the internal network | 95th percentile (p95) under 200 ms |
| PRF-4 | Time to open a board with 1,000 objects | p95 under 2 seconds |
| PRF-5 | Concurrent editors per board | 50 editors and 200 viewers |
| PRF-6 | Total concurrent users across the service | 2,000, scaling horizontally within cluster capacity |

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

### 7.4 Security

The product must pass the agency's security authorisation for a PROTECTED
system. The assessment uses the ISM controls for PROTECTED, and might
include an Infosec Registered Assessors Program (IRAP) assessment. The
product meets the following security requirements:

- Encrypts all traffic, including WebSocket traffic, with TLS 1.3, or TLS 1.2
  where needed, using only ASD Approved Cryptographic Algorithms (AACAs).
- Encrypts data at rest in the database, object storage, and backups, with
  keys held in the organisation's key management service.
- Takes all secrets, such as database passwords, OIDC client secrets, and
  object storage keys, from Passwordstate. No secret is stored in source
  control or Helm values.
- Authenticates every WebSocket connection when it opens and checks the
  user's board role before it sends any board data.
- Enforces roles on the server for every change. For example, the server
  drops updates from viewers and commenters.
- Stores session tokens in secure, `HttpOnly`, `SameSite` cookies. The
  browser never holds Entra access tokens.
- Applies a strict Content Security Policy and sanitises all user-supplied
  SVG and rich text.
- Scans uploaded files for malware with an on-premises scanner, such as
  ClamAV, before other users can download them.
- Makes no outbound calls except to Entra ID and Microsoft Graph. Board
  content never leaves the cluster.
- Builds container images from hardened base images, signs them, publishes a
  software bill of materials (SBOM) for each one, and scans them for
  vulnerabilities in continuous integration and in the registry.
- Keeps audit logs for the period set by the ISM and the agency's records
  policy.

### 7.5 Privacy and records

The product meets the following privacy and records requirements:

- Stores the minimum personal information needed: Entra object ID, display
  name, email, and group memberships.
- Supports the agency's obligations under the applicable privacy and public
  records legislation, including retention and disposal of boards.

## 8. Architecture

### 8.1 Components

The system has the following components:

1. **Web client**: A React and TypeScript single-page app. PixiJS renders the
   canvas. A DOM overlay handles text editing. Yjs holds board state.
2. **API service**: A Node.js and TypeScript service. It handles the OIDC
   sign-in (as a backend for frontend), sessions, boards, sharing, protective
   markings, comments, search, templates, imports, and exports.
3. **Collaboration service**: A Hocuspocus server that syncs Yjs documents
   over WebSockets. It checks sessions and board roles through hooks, stores
   document state in PostgreSQL, and uses Redis to fan out updates between
   pods.
4. **Worker service**: Background jobs for thumbnails, PDF and image export,
   search indexing, malware scanning, and snapshot compaction.
5. **PostgreSQL**: Stores users, boards, memberships, classifications,
   comments, audit events, and Yjs document snapshots and updates. The
   CloudNativePG operator runs it in the cluster, unless the organisation has
   a managed on-premises PostgreSQL service.
6. **Redis**: Handles collaboration pub/sub, session storage, and the job
   queue. Valkey is a drop-in open-source alternative.
7. **Object storage**: The organisation's MinIO service, through its
   S3-compatible API, for images, files, exports, and thumbnails. The
   services use only the standard S3 API, so the store can change later
   without code changes.
8. **Migration tool**: A separate command-line tool that runs outside the
   cluster and converts Miro boards into the product's JSON format.

### 8.2 Board data model

Each board is one Yjs document. The document holds a map of objects keyed by
unique ID. Each object stores its type, position, size, rotation, style,
content, and a fractional index for stacking order. Connectors store the IDs
of the objects they attach to.

The collaboration service stores incremental updates and periodically
compacts them into snapshots. Version history uses these snapshots.

Relational data, such as boards, classifications, members, comments, and
audit events, lives in PostgreSQL tables outside the Yjs document. This
design keeps access control and markings out of the client-editable
document.

### 8.3 Sign-in flow

The sign-in flow works as follows:

1. The user opens the app. The API service redirects them to Entra ID with an
   authorisation request that uses PKCE.
2. Entra ID authenticates the user, applying the organisation's conditional
   access and MFA policies.
3. Entra ID redirects back to the API service with an authorisation code.
4. The API service exchanges the code for tokens, validates the ID token,
   checks the tenant, app role, and MFA claim, and creates or updates the
   user profile.
5. The API service creates a server-side session and sets a session cookie.
6. The web client opens a WebSocket to the collaboration service. The
   collaboration service validates the session cookie and the user's board
   role before it syncs the document.

The API service uses delegated Microsoft Graph permissions
(`User.ReadBasic.All` and `GroupMember.Read.All`) for the people picker and
group resolution. These permissions need tenant administrator consent.

Entra ID is a cloud service, so the API service needs outbound HTTPS access to
`login.microsoftonline.com` and `graph.microsoft.com`, usually through the
organisation's egress proxy. No other component needs internet access.

### 8.4 RKE2 deployment

The product ships as a Helm chart for RKE2, with the following
characteristics:

- Separate Deployments for the web client (static files served by NGINX),
  the API service, the collaboration service, and the worker service.
- Works with the cluster's ingress controller (Traefik or NGINX) and with
  Gateway API routes. TLS certificates come from cert-manager, using the
  organisation's internal certificate authority.
- The route for the collaboration service supports WebSockets, allows idle
  timeouts of at least 1 hour, and uses consistent hashing on board ID, so
  users of the same board usually reach the same pod.
- Runs on RKE2 clusters that use the CIS hardening profile, with Pod Security
  Admission set to `restricted`, and with SELinux enforcing.
- Runs containers as non-root, with read-only root file systems, no
  privilege escalation, and dropped Linux capabilities.
- Supports air-gapped installation. All images come from the organisation's
  private registry, and the chart lets administrators override every image
  location.
- Uses persistent volumes from the cluster's storage class, such as Longhorn
  or an existing Container Storage Interface (CSI) driver.
- Includes Horizontal Pod Autoscalers for the API, collaboration, and worker
  services. The collaboration service scales on active connections.
- Includes Pod Disruption Budgets, and a pre-stop hook that drains WebSocket
  connections before a pod stops.
- Includes liveness, readiness, and startup probes on every service.
- Includes NetworkPolicies that allow only the required traffic between
  components, and egress only to Entra ID and Microsoft Graph.
- Takes secrets from Passwordstate. External Secrets Operator has no native
  Passwordstate provider, so the recommended approach uses its webhook
  provider to read secrets through the Passwordstate REST API. The API key
  gives read-only access to one password list for this product, and
  Passwordstate restricts it to the cluster's egress IP addresses. The chart
  never stores secrets in values files. See open question Q15.

### 8.5 Observability

The services meet the following observability requirements:

- Emit structured JSON logs.
- Expose Prometheus metrics, including active connections, documents loaded,
  sync latency, and update sizes.
- Emit OpenTelemetry traces for API and collaboration requests.
- Ship Grafana dashboards and alert rules in the Helm chart, compatible with
  Rancher Monitoring.

### 8.6 Backup and restore

The deployment meets the following backup requirements:

- Takes continuous PostgreSQL backups with point-in-time recovery, to meet
  the 15-minute RPO. CloudNativePG writes these backups to object storage.
- Turns on versioning and object locking in MinIO.
- Copies backups to a second storage location, so a MinIO failure doesn't
  lose both the data and its backups.
- Stores backups encrypted, on infrastructure authorised for PROTECTED.
- Backs up Kubernetes resources with the cluster's existing tool, such as
  Rancher Backups or Velero.
- Documents and tests the restore procedure every quarter.

## 9. Release plan

The following table shows the planned releases. Durations assume a team of
four to five engineers and are estimates only.

Table 14. Release plan

| Release | Scope | Estimated duration |
|---|---|---|
| R0: Foundations | Repository, continuous integration, Helm chart skeleton on RKE2, Entra sign-in, and a canvas prototype that proves the performance targets. Start the security authorisation process. | 4 to 6 weeks |
| R1: Pilot | All P0 requirements, released to one or two pilot teams with boards limited to OFFICIAL | 10 to 12 weeks |
| R2: General availability | All P1 requirements, including migration if needed, plus load testing, an accessibility audit, and the security assessment. Boards can hold PROTECTED after authorisation. | 10 to 12 weeks, plus assessment lead time |
| R3: Enhancements | P2 requirements, chosen by pilot and general availability feedback | Ongoing |

R0 is a decision point. If the canvas prototype can't reach PRF-1 and PRF-3,
the team reviews the build approach before R1 starts.

The pilot limits boards to OFFICIAL, so it can start before the system is
authorised for PROTECTED.

## 10. Success measures

The product uses the following success measures:

- **Adoption**: Weekly active users and boards created per week, measured
  from the audit log.
- **Satisfaction**: At least 4 out of 5 average rating in a pilot survey.
- **Reliability**: Availability and sync latency targets met for three
  consecutive months after general availability.
- **Performance**: PRF targets met in load tests before each release.
- **Security**: Authorisation to operate at PROTECTED granted before general
  availability.

## 11. Risks

Table 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A custom canvas engine takes longer than planned. | Delays the pilot. | Prove the engine in R0. Limit P0 object types. Reuse MIT-licensed code from Excalidraw where it fits. |
| The security assessment for PROTECTED takes longer than planned. | Delays general availability. | Engage the security team in R0. Map ISM controls to the design early. Run the pilot at OFFICIAL. |
| The PROTECTED network blocks or restricts egress to Entra ID and Microsoft Graph. | Users can't sign in. | Confirm the egress path and proxy rules in R0. |
| Yjs documents grow large on long-lived boards. | Slow board loading and high memory use. | Compact updates into snapshots, use garbage collection, and enforce the PRF-2 object limit. |
| Proxies or ingress timeouts drop WebSocket connections. | Frequent reconnections. | Set long idle timeouts, send heartbeats, and reconnect automatically with backoff. |
| MinIO's community edition is archived (February 2026) and gets no security fixes. | An unpatched store fails ISM patching controls and blocks authorisation. | Confirm the MinIO edition (Q14). If it's the community edition, move to the supported commercial edition (AIStor) or another S3-compatible store before general availability. |
| The Passwordstate API key is a bootstrap secret held in the cluster. | Anyone who reads it can read the product's secrets. | Scope the key to one read-only password list, restrict it by IP address, rotate it on a schedule, and limit which accounts can read the Kubernetes secret that holds it. |
| The `Whiteboard.User` app role acts as the clearance check (IAM-11). | An uncleared user who gets the role can open PROTECTED boards. | Assign the role only through a group that the security team controls, and review its membership regularly. |
| Miro content converts poorly. | Teams lose work or trust in the product. | Produce a report for each board (MIG-4). Run a trial migration on sample boards before bulk migration. |
| Canvas apps are hard to make accessible. | Fails the WCAG requirement for some users. | Design keyboard and screen reader support from R1, and schedule an audit in R2. |
| Entra configuration needs tenant administrator time. | Blocks R0 sign-in work. | Request the app registration, app roles, conditional access policy, and Graph consent at project start. |
| Users rely on Miro-specific features the product lacks. | Low adoption. | Survey current Miro users before R1 and adjust priorities. |

## 12. Open questions

### 12.1 Answered questions

The following table records answered questions.

Table 16. Answered questions

| ID | Question | Answer | Effect on this document |
|---|---|---|---|
| Q1 | Which cluster hosts the product? | On-premises RKE2 | Rewrote sections 8.1, 8.4, and 8.6 for on-premises hosting. |
| Q2 | What is the highest data classification that boards can hold? | PROTECTED | Added section 6.3 and expanded section 7.4. |
| Q4 | Do teams need to migrate existing Miro boards? | Potentially yes | Added section 6.8 as P1, conditional on confirmation. |
| Q7 | Which data residency requirements apply? | Resolved by on-premises hosting | All data stays on premises. No change needed. |
| Q8 | Which classification framework governs the markings? | Both the PSPF and the QGISCF | Updated PMK-1 and added PMK-7. |
| Q9 | Does a user's clearance level exist in Entra ID? | Every user in Entra ID is cleared | Replaced the clearance check in IAM-11 and added a risk. |
| Q10 | Can browsers cache PROTECTED content for offline editing? | Yes | Removed the condition from COL-5 and added COL-10. |
| Q11 | Which S3-compatible object store is available? | MinIO | Updated sections 8.1 and 8.6, and added a risk. |

### 12.2 Remaining questions

The following questions need answers before or during R0:

- **Q3**: Can Entra B2B guest users use the product (IAM-12)?
- **Q4a**: If migration goes ahead, how many boards need to move, and what is
  their classification in Miro?
- **Q5**: Is a Microsoft Teams integration (such as a Teams tab or
  notifications) a priority, and is it approved for this environment?
- **Q6**: Do users want AI features, such as summarising sticky notes or
  clustering ideas? At PROTECTED, any model service must run on premises or be
  authorised for PROTECTED.
- **Q12**: Is the cluster air-gapped apart from the Entra egress path, and
  which private container registry does it use?
- **Q13**: Does the pilot need a separate non-production RKE2 cluster?
- **Q14**: Which MinIO edition runs on premises: the archived community
  edition or the supported commercial edition (AIStor)?
- **Q15**: Does the platform team already have a pattern for syncing
  Passwordstate secrets into Kubernetes? If so, the product uses that
  pattern instead of the webhook approach in section 8.4.

## 13. References

The research for this document used the following sources:

- [Is Miro free? Plans, limits, and pricing explained (2026)](https://boardmix.com/whiteboard/is-miro-free/)
- [Miro pricing (2026): Free vs Starter vs Business vs Enterprise](https://www.aimadefor.com/blog/miro-pricing-2026/)
- [tldraw vs Excalidraw vs Quickdraw: choosing a whiteboard library](https://tryquickdraw.com/blog/tldraw-vs-excalidraw-vs-quickdraw)
- [How to build a real-time collaboration whiteboard app in 2026](https://kanopylabs.com/blog/how-to-build-a-real-time-collaboration-whiteboard-app)
- [Yjs documentation](https://docs.yjs.dev/)
- [Hocuspocus documentation](https://tiptap.dev/docs/hocuspocus/introduction)
- [Microsoft identity platform: OAuth 2.0 authorisation code flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)
- [RKE2 documentation](https://docs.rke2.io/)
- [MinIO CE in 2026: retired upstream, source-only, and what to use](https://www.glukhov.org/data-infrastructure/object-storage/minio-dead/)
- [MinIO users complain after admin UI removed from Community Edition](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/)
- [External Secrets Operator](https://github.com/external-secrets/external-secrets)
- [Miro REST API](https://developers.miro.com/docs/rest-api-reference-guide)
- [Information Security Manual (ISM)](https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism)
- [Protective Security Policy Framework (PSPF)](https://www.protectivesecurity.gov.au/)
- [Queensland Government Information Security Classification Framework (QGISCF)](https://www.forgov.qld.gov.au/information-and-communication-technology/qgea-policies-standards-and-guidelines/information-security-classification-framework-qgiscf)
- [Google developer documentation style guide](https://developers.google.com/style)
