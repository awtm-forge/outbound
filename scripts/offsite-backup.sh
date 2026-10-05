#!/bin/sh
# Copy the newest local backup to a private remote. Set OFFSITE_TARGET to an scp destination (user@host:/path) or an rclone remote (remote:bucket/path).
# Run from cron on the VPS: 0 3 * * * /opt/awtm-outbound-os/scripts/offsite-backup.sh
set -eu; cd "$(dirname "$0")/.."
latest=$(ls -t backups/awtm_outbound_*.sql.gz | head -1); [ -n "$latest" ] || { echo "no backup"; exit 1; }
case "${OFFSITE_TARGET:?set OFFSITE_TARGET}" in *:*/*|*:*) if command -v rclone >/dev/null && echo "$OFFSITE_TARGET" | grep -qv '@'; then rclone copy "$latest" "$OFFSITE_TARGET"; else scp "$latest" "$OFFSITE_TARGET"; fi;; esac
echo "copied $latest"
