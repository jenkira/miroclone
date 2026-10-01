#!/bin/bash
# Proves that a logical backup restores to the same data (PRD section 8.7). It dumps the database, restores the dump
# into a new database, and compares row counts and a content checksum for every table that holds board data.
# Set POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB first.
set -euo pipefail
export PGPASSWORD="$POSTGRES_PASSWORD"
conn=(-h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER")
copy="${POSTGRES_DB}_restore_$$"
dump="$(mktemp)"
trap 'psql "${conn[@]}" -d postgres -qc "DROP DATABASE IF EXISTS \"$copy\"" >/dev/null 2>&1 || true; rm -f "$dump"' EXIT

pg_dump "${conn[@]}" -Fc -d "$POSTGRES_DB" -f "$dump"
psql "${conn[@]}" -d postgres -qc "CREATE DATABASE \"$copy\""
pg_restore "${conn[@]}" -d "$copy" --no-owner "$dump"

tables="users boards board_members board_participants board_updates board_versions board_files board_search board_stars comments notifications org_templates vote_sessions votes spaces space_members settings schema_migrations"
fail=0
for t in $tables; do
  q="SELECT count(*) || ':' || coalesce(md5(string_agg(x::text, '' ORDER BY x::text)), '') FROM $t x"
  a=$(psql "${conn[@]}" -d "$POSTGRES_DB" -Atc "$q" 2>/dev/null || echo missing)
  b=$(psql "${conn[@]}" -d "$copy" -Atc "$q" 2>/dev/null || echo missing)
  if [ "$a" == "$b" ] && [ "$a" != "missing" ]; then echo "PASS  $t  ${a%%:*} rows"; else echo "FAIL  $t  source=$a restored=$b"; fail=1; fi
done
[ $fail -eq 0 ] && echo "Restore test passed." || { echo "Restore test failed."; exit 1; }
