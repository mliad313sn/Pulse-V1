#!/usr/bin/env bash
# Manual backup: pg_dump -Fc + verification pass + 14-day retention.
# Same logic as the scheduled job (src/jobs/backup.js); usable standalone:
#   DATABASE_URL=postgres://... BACKUP_DIR=/backups bash scripts/backup.sh
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%S)"
FILE="$BACKUP_DIR/pulse_${STAMP}.dump"

echo "Dumping to $FILE ..."
pg_dump -Fc -f "$FILE" --dbname "$DATABASE_URL"

echo "Verifying dump ..."
if ! pg_restore --list "$FILE" > /dev/null; then
  echo "VERIFICATION FAILED — removing bad dump" >&2
  rm -f "$FILE"
  exit 1
fi

echo "Pruning dumps older than ${RETENTION_DAYS} days ..."
find "$BACKUP_DIR" -name 'pulse_*.dump' -mtime +${RETENTION_DAYS} -delete

echo "Backup OK: $FILE"
