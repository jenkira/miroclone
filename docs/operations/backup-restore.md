# Back up and restore

This guide describes how to back up Miroclone, how to restore it, and how to test the restore. It implements
section 8.7 of the [product requirements document](../PRD.md). The recovery targets are a recovery point objective (RPO)
of 15 minutes and a recovery time objective (RTO) of 4 hours.

## What to back up

The following table lists every store that holds state, and how to protect it.

Table 1. Stores and their backups

| Store | What it holds | How to protect it |
|---|---|---|
| PostgreSQL | Boards, stored updates, versions, members, comments, votes, settings, and audit-relevant metadata | CloudNativePG continuous backup with point-in-time recovery, written to object storage |
| Object storage | Uploaded images, referenced by the `board_files` table | Turn on versioning and object locking if the store supports them, and replicate to a second location |
| Kubernetes resources | The Helm release, values, and ExternalSecret definitions | The cluster's backup tool, such as Rancher Backups or Velero |
| Redis | Sessions only | Don't back it up. Users sign in again after a loss. |

Passwordstate holds the secrets, so it has its own backup. Never copy secret values into any backup of the chart.

## Back up PostgreSQL

To meet the 15-minute RPO, enable CloudNativePG's continuous archiving to object storage on infrastructure authorised for PROTECTED,
and encrypt the backups. For a one-off logical copy, run `pg_dump` in the custom format:

```sh
pg_dump -Fc -h <host> -U <user> -d miroclone -f miroclone.dump
```

## Restore

To restore the service, complete the following steps:

1. Stop the API, collaboration, and worker deployments, so nothing writes while you restore.
2. Restore PostgreSQL. For point-in-time recovery, create a new CloudNativePG cluster that recovers from the backup to the target time. For a logical copy, create an empty database and run `pg_restore --no-owner -d miroclone miroclone.dump`.
3. Restore the object storage bucket to the same point in time, or to the nearest earlier version.
4. Point the chart at the restored database and bucket, and start the deployments. The services apply any missing migrations when they start.
5. Sign in, open a board that holds an image, and open its history to confirm the data is complete.

Images are the one place where the database and the object store must agree. If the bucket is older than the database, a board can
refer to an image that is missing. The board shows a placeholder where the image was, and nothing else fails.

## Test the restore every quarter

Run the restore test against a copy of production data, or against a staging database:

```sh
export POSTGRES_HOST=<host> POSTGRES_PORT=5432 POSTGRES_DB=miroclone POSTGRES_USER=<user> POSTGRES_PASSWORD=<password>
./e2e/restore-test.sh
```

The script dumps the database, restores the dump into a new database, and compares the row count and a checksum of the contents for
every table. It deletes the copy when it finishes, and it exits with a non-zero status if any table differs.

Record the date, the result, and the time the restore took. If the time approaches the 4-hour RTO, raise it with the platform team.

## Last test

The team ran the restore test against the development database on 30 September 2026. All 18 tables matched,
including 119 boards, 340 stored updates, and 37 versions. Point-in-time recovery depends on CloudNativePG and the cluster's object store,
so test it on the cluster before general availability.
