# End-to-end test

The script `full-stack.mjs` drives a real browser against the real services. Only Microsoft
is simulated, by the fake identity provider in `services/api/dev/fake-idp.ts`.

The script checks the following behaviour:

- Sign-in with PKCE, and the refusals for a missing MFA claim and a missing app role.
- Session cookie properties, and that the browser holds no Entra token.
- Board creation, drawing, and persistence across a reload.
- Sharing with an Entra group through the people picker.
- Live sync to a second user, and the server dropping a viewer's edit.
- Audit events for sign-in, board creation, sharing, and export.

## Run the test

To run the test, you need PostgreSQL 16, Redis 7, and Chromium. Follow these steps:

1. Start PostgreSQL with a `miroclone` database and Redis with a password.
2. Export `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
   `POSTGRES_SSL=0`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `ENTRA_TENANT_ID`.
3. Start the fake identity provider: `pnpm --filter @miroclone/api idp`.
4. Start the API with `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`,
   `ENTRA_REDIRECT_URI=http://127.0.0.1:5199/auth/callback`,
   `ENTRA_AUTHORITY=http://127.0.0.1:4010`, `GRAPH_BASE_URL=http://127.0.0.1:4010/v1.0`, and
   `INSECURE_COOKIES=1`, and write its output to a file: `pnpm --filter @miroclone/api start`.
5. Start the collaboration service: `pnpm --filter @miroclone/collab start`.
6. Start the web client on port 5199: `pnpm --filter @miroclone/web exec vite --port 5199 --host 127.0.0.1`.
7. Run `API_LOG=<path to the API output file> node e2e/full-stack.mjs`.
   Set `CHROMIUM_PATH` if Chromium isn't at `/opt/pw-browsers/chromium`.

The fake identity provider and `INSECURE_COOKIES` are for local use only.
