#!/usr/bin/env bash
# Restore a verified dump into a database (drill: restore into a FRESH database,
# then point the app at it — plan §7).
#   Usage: DATABASE_URL=postgres://user:pass@host:5432/target_db bash scripts/restore.sh <dumpfile>
# The target database must exist and be empty (createdb target_db first).
set -euo pipefail

DUMP="${1:?usage: restore.sh <dumpfile>}"
: "${DATABASE_URL:?DATABASE_URL must be set to the TARGET database}"

[ -f "$DUMP" ] || { echo "Dump not found: $DUMP" >&2; exit 1; }

echo "Verifying dump ..."
pg_restore --list "$DUMP" > /dev/null

echo "Restoring $DUMP into $DATABASE_URL ..."
pg_restore --no-owner --no-privileges --dbname "$DATABASE_URL" "$DUMP"

echo "Restore complete. Row check:"
psql "$DATABASE_URL" -c "SELECT (SELECT count(*) FROM projects) AS projects, (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM audit_log) AS audit_entries;"
