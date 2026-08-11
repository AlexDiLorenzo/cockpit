#!/bin/bash
# Sauvegarde nocturne de la base du Cockpit.
#
# Appelé par le crontab de l'utilisateur du VPS :
#   30 3 * * * /srv/pilotage/scripts/sauvegarde.sh >> /srv/pilotage/sauvegardes/cron.log 2>&1
#
# Conserve 30 jours. La base contient ce qui ne se réimporte pas : cibles,
# actions de comité, seuils, paramètres de coût, rapprochements de noms.
set -euo pipefail

DEST=${CK_BACKUP_DIR:-/srv/pilotage/sauvegardes}
mkdir -p "$DEST"

FICHIER="$DEST/cockpit-$(date +%F).sql.gz"
docker exec pilotage-db pg_dump -U "${CK_DB_USER:-cockpit}" "${CK_DB_NAME:-cockpit}" \
  | gzip > "$FICHIER"

# Un dump vide ou tronqué signale un échec silencieux — pg_dump peut échouer
# alors que gzip réussit, le pipe masquant le code de sortie. Mieux vaut pas
# de fichier qu'un fichier qui fait croire à une sauvegarde.
if [ ! -s "$FICHIER" ] || [ "$(stat -c %s "$FICHIER")" -lt 500 ]; then
  echo "$(date +'%F %T') sauvegarde vide ou tronquée, supprimée : $FICHIER" >&2
  rm -f "$FICHIER"
  exit 1
fi

find "$DEST" -name 'cockpit-*.sql.gz' -mtime +30 -delete
echo "$(date +'%F %T') sauvegarde OK : $FICHIER ($(stat -c %s "$FICHIER") octets)"
