# Performance report

This report records what the team measured against the performance targets in section 7.1 of the
[product requirements document](../PRD.md), and what the measurements don't show. All numbers come from one
development virtual machine (4 cores, shared with Postgres, Redis, and the load generator), so treat them as a
baseline to repeat on the production cluster, not as a sizing guide.

## Summary

The following table compares each target with the measurement.

Table 1. Performance targets and results

| ID | Target | Result in the test environment | Status |
|---|---|---|---|
| PRF-1 | 60 fps, and no lower than 30 fps, with 5,000 objects | About 26 fps in a software renderer (SwiftShader). Not representative of laptop graphics hardware. | Not verified |
| PRF-2 | 20,000 objects per board | Enforced by the object model. | Met by design |
| PRF-3 | Change propagation p95 under 200 ms | p95 1.4 ms between two users. | Met |
| PRF-4 | Open a 1,000-object board, p95 under 2 seconds | p95 37 to 64 ms over 30 opens. | Met |
| PRF-5 | 50 editors and 200 viewers on one board | All 250 connections sync and every update reaches every viewer. p95 propagation is under 200 ms with 10 editors, and 200 to 370 ms with 50 editors on one collaboration process. | Partly met |
| PRF-6 | 2,000 concurrent users across the service | Not measured. Needs a multi-pod cluster. | Not verified |

## How to repeat the measurements

To repeat the collaboration measurements, start the development stack and run the load script:

```sh
LOAD_EDITORS=50 LOAD_VIEWERS=200 LOAD_INTERVAL_MS=3000 LOAD_SECONDS=15 node e2e/load.mjs
```

The script signs in through the fake identity provider, imports a 1,000-object board through the API,
and then measures the following:

- **PRF-4**: The time from opening a connection to the first sync, over 30 opens.
- **PRF-3**: The time for one editor's change to appear for a second user, over 200 changes.
- **PRF-5**: The latency of every update to every viewer. Editors and viewers run in separate processes, 50 connections in each, so the load generator's single thread doesn't add to the result. Each editor starts at a random point and varies the time between edits, because real people don't edit in step.

Set `LOAD_EDITORS`, `LOAD_VIEWERS`, `LOAD_SECONDS`, `LOAD_INTERVAL_MS` (the time between one editor's edits), and `LOAD_SETTLE_MS` to change the shape.

## What the PRF-5 numbers mean

With 50 editors each making an edit every 3 seconds, the collaboration process sends about 3,300 messages a second.
The median delivery time is 6 ms, and the 95th percentile is between 50 and 370 ms from run to run.
With 10 editors the 95th percentile is 34 ms.

The collaboration service runs on one thread, and the event loop paused for up to a second during the heaviest runs.
The measurement doesn't show whether those pauses come from the service or from CPU contention on the shared virtual machine,
because the machine was 70% idle but the service's thread isn't spread across cores.
Before you rely on 50 simultaneous editors in one room, repeat the test on the cluster and profile the collaboration pod.

## Changes that came from measuring

The measurements found one defect, and the team fixed it:

- **Compaction on every edit.** The collaboration service read every stored update for a board after each edit, to count them, and merged them when there were more than 200. The count now runs in the database and reads no update data. The merge moved to the worker service, which compacts boards on a 15-second timer, so merging a large board no longer takes time from the collaboration thread. A board that opens with a long backlog is also compacted once in the background, in case the worker isn't running.

## Known limits of these measurements

- The load script uses one user's session for every connection, so it doesn't exercise role differences between viewers and editors.
- It runs one collaboration pod. It doesn't exercise the Redis fan-out between pods.
- PRF-1 needs a real laptop with graphics hardware. The browser tests run Chromium with a software renderer.
- PRF-6 needs a multi-pod cluster and a load generator that can hold 2,000 sessions.
