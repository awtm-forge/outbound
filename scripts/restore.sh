#!/bin/sh
# Restore a backup into the running postgres. DESTRUCTIVE: drops and recreates the database.
# Usage: scripts/restore.sh backups/awtm_outbound_YYYYMMDD_HHMMSS.sql.gz
set -eu; cd "$(dirname "$0")/.."; . ./.env
[ -f "${1:-}" ] || { echo "usage: $0 <backup.sql.gz>"; exit 1; }
printf 'This drops %s and restores %s. Type the database name to continue: ' "$POSTGRES_DB" "$1"; read -r ans
[ "$ans" = "$POSTGRES_DB" ] || exit 1
docker compose stop core n8n
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" -c "CREATE DATABASE \"$POSTGRES_DB\";"
gunzip -c "$1" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q
docker compose start core n8n && echo "restored"
