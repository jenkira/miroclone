# Set up Teams notifications

This guide describes how to turn on Microsoft Teams activity notifications (COL-9). When someone mentions a person or
replies to them in a comment, the person also gets a notification in the Teams activity feed. The notification
names the board's classification and links to the board. It holds no board title, comment text, or commenter name, because
a Teams client isn't authorised for PROTECTED content (COL-8).

## How it works

The worker service sends each notification through Microsoft Graph, with the app's own Entra ID credentials.
The worker calls Entra ID for a token and then calls Graph, so the fixed rule on outbound calls holds. It uses the Graph call
`POST /users/{id}/teamwork/sendActivityNotification`. The feature stays off until an administrator turns it on, and a person
gets a notification only if they installed the Miroclone Teams app.

## Before you begin

You need the following:

- A tenant administrator who approves the Teams app and grants an application permission.
- The Entra app registration that Miroclone already uses for sign-in, and its client secret in Passwordstate.
- Egress from the worker pods to Entra ID and Graph. The chart's `networkPolicy.entraEgressCidrs` list covers it.

## Set up the feature

To set up the feature, complete the following steps:

1. In the Entra app registration, add the application permission **TeamsActivity.Send** (Microsoft Graph), and ask a tenant administrator to grant consent.
2. Build the Teams app package. The script needs only Python 3.

   ```sh
   python3 deploy/teams/build-package.py \
     --app-url https://board.example.internal \
     --entra-client-id <the app registration's client ID> \
     --organisation "Example Agency"
   ```

   Keep the Teams app ID that the script prints, and pass it as `--teams-app-id` for every later build.
3. In the Teams admin centre, upload `miroclone-teams.zip` as a custom app, and approve it. Use an app setup policy to install it for the people who need notifications.
4. In the chart values, set `teams.enabled: true`, add `ENTRA_CLIENT_SECRET` under `externalSecrets.worker` with the same Passwordstate password ID that the API uses, and upgrade the release.
5. Sign in as a service administrator, open **Administration**, and select **Send Teams notifications**.

## What happens when something goes wrong

The following table lists what the worker does for each Graph response.

Table 1. Worker behaviour for each response

| Response | Meaning | What the worker does |
|---|---|---|
| 204 | The notification was sent. | Marks it sent. |
| 404 | The person isn't in the tenant, or hasn't installed the Teams app. | Marks it done and doesn't retry. |
| 403 | The app lacks the TeamsActivity.Send permission, or consent is missing. | Retries every minute, up to five attempts, then gives up. |
| 401 | The token expired. | Gets a new token once, and tries again. |
| 429 or 5xx | Graph is busy or down. | Retries every minute, up to five attempts. |

The `worker_emails_total` metric counts results with the labels `teams_sent`, `teams_failed`, and `teams_skipped`.
A rising `teams_failed` count usually means missing consent, so check the permission first.

## Turn it off

Clear **Send Teams notifications** in **Administration**. The worker stops sending at its next check, within 30 seconds.
Notifications created while it was off are sent when you turn it back on, up to the retry limit.

## Test it

The `e2e/teams.mjs` script runs the worker against a fake Entra ID and Graph, mentions a person, and reads back what Graph received.
It checks that nothing is sent while the setting is off, that the notification carries the classification and link and no board content,
and that it goes out once. The unit tests in `services/worker/src/teams.test.ts` cover the token, the retries, and the 404 case.
