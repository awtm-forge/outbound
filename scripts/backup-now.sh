#!/bin/sh
# One-off backup from the host. Usage: scripts/backup-now.sh
set -eu; cd "$(dirname "$0")/.."; . ./.env
f=backups/awtm_outbound_$(date +%Y%m%d_%H%M%S).sql.gz
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" --no-owner "$POSTGRES_DB" | gzip > "$f" && echo "wrote $f"
