#!/usr/bin/env bash
# Move an existing installation from the old `rakazo` deployment names to
# `bobbot` without losing data.
#
# Why this needs a script: Docker derives volume and network names from the
# Compose project name, so renaming the project makes Compose look for empty
# volumes and start a fresh database next to the old one. The Compose files pin
# their volume names through BOBBOT_VOLUME_PREFIX for exactly this reason, and
# this script copies the data to the new prefix, then records the new prefix and
# project name in .env. The old volumes stay in place, so the rollback is one
# line in .env plus a redeploy.
#
# Dry run unless --apply is passed. The stack must be down: copying the files of
# a running Postgres is a corrupt copy, not a backup.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: rename-deployment.sh [--apply] [--systemd] [--from rakazo-prod] [--to bobbot-prod]

  --apply    Actually stop nothing, create and copy the volumes, and rewrite .env.
             Without it the script only prints what it would do.
  --systemd  Also install bobbot-backup.service/.timer into /etc/systemd/system and
             keep rakazo-backup.* working as symlinks. Needs root.
  --from     Volume prefix in use today (default: rakazo-prod).
  --to       Volume prefix to move to (default: bobbot-prod). Also becomes
             COMPOSE_PROJECT_NAME.

Run it from the deployment checkout, or point BOBBOT_DEPLOY_DIR at it.
USAGE
}

APPLY=0
INSTALL_SYSTEMD=0
FROM_PREFIX="rakazo-prod"
TO_PREFIX="bobbot-prod"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --systemd) INSTALL_SYSTEMD=1 ;;
    --from) FROM_PREFIX="${2:?--from needs a prefix}"; shift ;;
    --to) TO_PREFIX="${2:?--to needs a prefix}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

PROJECT_DIR="${BOBBOT_DEPLOY_DIR:-${RAKAZO_DEPLOY_DIR:-}}"
if [[ -z "${PROJECT_DIR}" ]]; then
  PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
[[ "${PROJECT_DIR}" == /* ]] || { echo "BOBBOT_DEPLOY_DIR must be an absolute path" >&2; exit 1; }
cd "${PROJECT_DIR}"

ENV_FILE="${PROJECT_DIR}/.env"
[[ -r "${ENV_FILE}" ]] || { echo "No readable ${ENV_FILE}" >&2; exit 1; }

COMPOSE_FILES_RAW="${BOBBOT_DEPLOY_COMPOSE_FILES:-${RAKAZO_DEPLOY_COMPOSE_FILES:-infra/compose/docker-compose.prod.yml}}"
read -r -a COMPOSE_FILES <<<"${COMPOSE_FILES_RAW//,/ }"
[[ ${#COMPOSE_FILES[@]} -gt 0 ]] || { echo "BOBBOT_DEPLOY_COMPOSE_FILES is empty" >&2; exit 1; }
COMPOSE_ARGS=(--env-file "${ENV_FILE}")
for file in "${COMPOSE_FILES[@]}"; do
  [[ "${file}" == /* || "${file}" == *..* || ! "${file}" =~ ^[A-Za-z0-9._/-]+\.ya?ml$ || ! -f "${file}" ]] \
    && { echo "Invalid Compose file '${file}'" >&2; exit 1; }
  COMPOSE_ARGS+=(-f "${file}")
done
compose=(docker compose "${COMPOSE_ARGS[@]}")

# Read the volumes Compose would mount today, rather than rebuilding their names
# from the project name: an operator's -p or COMPOSE_PROJECT_NAME would make the
# constructed name point at a different stack's volume.
config="$("${compose[@]}" config)"
declare -a VOLUME_KEYS=() VOLUME_NAMES=()
while read -r key name; do
  [[ -n "${key}" ]] || continue
  VOLUME_KEYS+=("${key}")
  VOLUME_NAMES+=("${name}")
done < <(awk '
  /^volumes:/ {involumes=1; next}
  /^[a-z]+:/ {involumes=0}
  involumes && /^  [A-Za-z0-9_.-]+:$/ {key=$1; sub(/:$/, "", key); next}
  involumes && /^    name: / {print key, $2}
' <<<"${config}")

[[ ${#VOLUME_NAMES[@]} -gt 0 ]] || { echo "This stack declares no volumes; nothing to move." >&2; exit 1; }

postgres_image="$(awk '/^  postgres:/ {f=1} f && /image:/ {print $2; exit}' <<<"${config}")"
postgres_image="${postgres_image:-postgres:16}"

cat <<PLAN
Deployment directory : ${PROJECT_DIR}
Compose files        : ${COMPOSE_FILES_RAW}
Volumes today        : ${VOLUME_NAMES[*]}
New prefix           : ${TO_PREFIX}
New project name     : ${TO_PREFIX}
Helper image         : ${postgres_image}
PLAN

if [[ "$(docker ps -q --filter "volume=${VOLUME_NAMES[0]}")" != "" ]]; then
  echo >&2
  echo "A container still uses ${VOLUME_NAMES[0]}; copying its files now would copy an open database." >&2
  echo "Stop the stack first:  ${compose[*]} down" >&2
  exit 1
fi

if [[ "${APPLY}" -eq 0 ]]; then
  echo
  echo "Dry run. With --apply this would:"
  echo "  1. copy each volume above to ${TO_PREFIX}_<name>"
  echo "  2. set BOBBOT_VOLUME_PREFIX=${TO_PREFIX} and COMPOSE_PROJECT_NAME=${TO_PREFIX} in ${ENV_FILE}"
  echo "  3. leave ${FROM_PREFIX}_* in place as the rollback"
  echo
  echo "Rollback (if you apply and then change your mind):"
  echo "  BOBBOT_VOLUME_PREFIX=${FROM_PREFIX}"
  echo "  COMPOSE_PROJECT_NAME=${FROM_PREFIX}"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "${ENV_FILE}" "${ENV_FILE}.rename-${stamp}"
echo "Saved ${ENV_FILE}.rename-${stamp}"

for index in "${!VOLUME_NAMES[@]}"; do
  from="${VOLUME_NAMES[$index]}"
  to="${TO_PREFIX}_${VOLUME_KEYS[$index]}"
  if [[ "${from}" == "${to}" ]]; then
    echo "Volume ${from} already carries the new name"
    continue
  fi
  if ! docker volume inspect "${from}" >/dev/null 2>&1; then
    echo "Volume ${from} does not exist; creating ${to} empty" >&2
    docker volume create "${to}" >/dev/null
    continue
  fi
  if ! docker volume inspect "${to}" >/dev/null 2>&1; then
    docker volume create "${to}" >/dev/null
  elif [[ -n "$(docker run --rm -v "${to}:/to:ro" --entrypoint sh "${postgres_image}" -c 'ls -A /to' 2>/dev/null)" ]]; then
    echo "Volume ${to} already holds data; keeping it (delete it first to re-copy)" >&2
    continue
  fi
  echo "Copying ${from} -> ${to}"
  docker run --rm \
    -v "${from}:/from:ro" \
    -v "${to}:/to" \
    --entrypoint sh \
    "${postgres_image}" -c 'cd /from && cp -a . /to' >/dev/null
done

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
  fi
}

set_env BOBBOT_VOLUME_PREFIX "${TO_PREFIX}"
set_env COMPOSE_PROJECT_NAME "${TO_PREFIX}"
echo "Wrote BOBBOT_VOLUME_PREFIX and COMPOSE_PROJECT_NAME=${TO_PREFIX} to ${ENV_FILE}"

if [[ "${INSTALL_SYSTEMD}" -eq 1 ]]; then
  [[ "${EUID}" -eq 0 ]] || { echo "--systemd needs root" >&2; exit 1; }
  install -d -m 700 /etc/bobbot
  install -m 644 "${PROJECT_DIR}/infra/systemd/bobbot-backup.service" /etc/systemd/system/bobbot-backup.service
  install -m 644 "${PROJECT_DIR}/infra/systemd/bobbot-backup.timer" /etc/systemd/system/bobbot-backup.timer
  install -m 755 "${PROJECT_DIR}/infra/compose/backup-prod.sh" /usr/local/sbin/bobbot-backup
  # Old names keep working: an existing timer, CI key or cron entry calls them.
  ln -sfn /usr/local/sbin/bobbot-backup /usr/local/sbin/rakazo-backup
  ln -sfn /etc/systemd/system/bobbot-backup.service /etc/systemd/system/rakazo-backup.service
  ln -sfn /etc/systemd/system/bobbot-backup.timer /etc/systemd/system/rakazo-backup.timer
  systemctl daemon-reload
  echo "Installed bobbot-backup.service/.timer; rakazo-backup.* are symlinks to them"
fi

cat <<NEXT

Next steps
  1. Start the stack:  ${compose[*]} up -d
  2. Check it:         ${compose[*]} ps   and open BOBBOT_HOST
  3. Confirm the data arrived (bots, chats, runs), then delete the old volumes
     when you no longer need them:
       docker volume rm ${FROM_PREFIX}_${VOLUME_KEYS[*]:-<name>}

Rollback
  Put the old prefix back into ${ENV_FILE} and redeploy:
    BOBBOT_VOLUME_PREFIX=${FROM_PREFIX}
    COMPOSE_PROJECT_NAME=${FROM_PREFIX}
  The old volumes were never deleted, so this returns to the old data set.
NEXT
