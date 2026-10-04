#!/usr/bin/env bash
# Restore a production snapshot (rakazo.dump + appdata.tgz) into a prepared stack.
#
# Consumes the production layout that backup-prod.sh writes: a custom-format
# Postgres dump, an appdata archive, and SHA256SUMS.
#
# The target stack must be a *fresh* installation: this restores into an empty
# database, replaces the backed-up files inside DATA_DIR, and never merges into
# an existing product. Backups are tied to the ENCRYPTION_KEY that was active at
# backup time, so that key must already be present in the target .env and is
# never regenerated here.
#
# Usage: restore-prod.sh /var/backups/rakazo/<stamp>
set -Eeuo pipefail

if [[ -z "${RAKAZO_RESTORE_DIR:-}" && -r /etc/rakazo/restore.env ]]; then
  # shellcheck disable=SC1091
  source /etc/rakazo/restore.env
fi
TARGET_DIR="${RAKAZO_RESTORE_DIR:-/srv/rakazo}"
[[ "${TARGET_DIR}" == /* ]] || { echo "RAKAZO_RESTORE_DIR must be an absolute path" >&2; exit 1; }
COMPOSE_FILE="${TARGET_DIR}/infra/compose/docker-compose.prod.yml"
ENV_FILE="${TARGET_DIR}/.env"
[[ -f "${ENV_FILE}" ]] || { echo "No .env at ${TARGET_DIR}; copy it from the source installation" >&2; exit 1; }

snapshot="${1:-${RAKAZO_RESTORE_SNAPSHOT:-}}"
[[ -n "${snapshot}" ]] || { echo "Usage: restore-prod.sh /var/backups/rakazo/<stamp>" >&2; exit 1; }
snapshot="${snapshot%/}"
[[ "${snapshot}" == /* ]] || { echo "Snapshot path must be absolute" >&2; exit 1; }
[[ -d "${snapshot}" ]] || { echo "No such snapshot directory: ${snapshot}" >&2; exit 1; }

# Restoring over a checkout someone is actively changing invites a mixed state;
# require a clean tree so the restore result is reproducible.
if [[ -d "${TARGET_DIR}/.git" ]] && ! git -C "${TARGET_DIR}" diff-index --quiet HEAD --; then
  echo "Target checkout ${TARGET_DIR} is dirty; restore only into a clean checkout." >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

dump="${snapshot}/rakazo.dump"
appdata="${snapshot}/appdata.tgz"
sums="${snapshot}/SHA256SUMS"
for artifact in "${dump}" "${appdata}" "${sums}"; do
  [[ -r "${artifact}" ]] || { echo "Missing snapshot artifact: ${artifact}" >&2; exit 1; }
done

echo "Verifying snapshot ${snapshot} before touching the database..."
pg_restore --list "${dump}" >/dev/null || { echo "rakazo.dump is corrupt; refusing to restore." >&2; exit 1; }
tar -tzf "${appdata}" >/dev/null || { echo "appdata.tgz is corrupt; refusing to restore." >&2; exit 1; }
(cd "${snapshot}" && sha256sum -c --status SHA256SUMS) || {
  echo "SHA256SUMS does not match this snapshot; refusing to restore." >&2
  exit 1
}
echo "Snapshot verified."

# Refuse to clobber a populated database unless the operator says so explicitly.
if [[ -z "${RAKAZO_RESTORE_FORCE:-}" ]]; then
  if compose exec -T postgres pg_isready -U rakazo >/dev/null 2>&1; then
    echo "Target database is reachable; pass RAKAZO_RESTORE_FORCE=1 to overwrite it." >&2
    exit 1
  fi
fi

compose down --remove-orphans >/dev/null

compose up -d postgres
deadline=$((SECONDS + 60))
until compose exec -T postgres pg_isready -U rakazo >/dev/null 2>&1; do
  if ((SECONDS >= deadline)); then
    echo "Postgres did not become ready within 60 seconds; restore aborted." >&2
    exit 1
  fi
  sleep 1
done

# ON_ERROR_STOP plus a single transaction keep a failed SQL import from leaving a
# half-populated database behind.
if ! compose exec -T postgres psql -X -U rakazo -d rakazo \
  --set=ON_ERROR_STOP=on --single-transaction --file=- <"${dump}"; then
  echo "Database restore failed; the previous database content is untouched." >&2
  compose down --remove-orphans >/dev/null
  exit 1
fi

# Restore the backed-up files inside the same appdata volume, as root. The API runs
# as uid 1000 with cap_drop ALL and cannot read or unlink the root-owned files the
# supervisor writes (bot computer homes, receipts, connector tokens) — the same
# reason backup-prod.sh archives them from the host. `compose run` reuses this
# file's image and volume wiring, so a custom project or overlay needs no extra
# configuration, and the one-off container is removed afterwards.
if ! compose run --rm --user root --entrypoint sh api -c \
  'rm -rf /data/* && tar -xzf - -C /data' <"${appdata}"; then
  echo "File restore failed; the database was restored but the files may be incomplete." >&2
  echo "Do not start the application until /data holds the snapshot contents." >&2
  exit 1
fi

# A restore without the original ENCRYPTION_KEY cannot decrypt anything and a
# regenerated key would make the restored credentials permanently unreadable.
if ! grep -q '^ENCRYPTION_KEY=..' "${ENV_FILE}"; then
  echo "ENCRYPTION_KEY is missing or too short in ${ENV_FILE}; restored credentials cannot be decrypted." >&2
  echo "Copy the ENCRYPTION_KEY from the source installation into ${ENV_FILE} and retry." >&2
  exit 1
fi

compose up -d api worker web

echo "Production restore complete from ${snapshot}."
