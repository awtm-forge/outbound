#!/bin/sh
# pg_dump on container start and then every 24 hours into /backups (gzip), pruning files older than BACKUP_RETENTION_DAYS.
# /backups is a host bind mount; copy it off-box with scripts/offsite-backup.sh. Never point it at a public bucket.
set -u
while true; do
  f=/backups/awtm_outbound_$(date +%Y%m%d_%H%M%S).sql.gz
  if pg_dump --no-owner --format=plain | gzip > "$f"; then echo "backup ok $f $(wc -c < "$f") bytes"; else echo "backup FAILED"; rm -f "$f"; fi
  find /backups -name 'awtm_outbound_*.sql.gz' -mtime +"$BACKUP_RETENTION_DAYS" -delete
  sleep 86400
done
