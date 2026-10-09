#!/usr/bin/env bash
# Build and roll out one already-tested revision on the single-VM production stack.
#
# Install as /usr/local/sbin/rakazo-deploy-main and give CI a key restricted to it. CI passes the
# tested commit as the requested SSH command (`ssh ... <sha>`), so a main that moved after the checks
# cannot change what ships. The deploy user needs passwordless sudo for Docker.
set -Eeuo pipefail

# A forced SSH command carries no environment, so read the checkout path from a root-owned file.
if [[ -z "${BOBBOT_DEPLOY_DIR:-${RAKAZO_DEPLOY_DIR:-}}" && -r /etc/rakazo/deploy.env ]]; then
  # shellcheck disable=SC1091
  source /etc/rakazo/deploy.env
fi
APP_DIR="${BOBBOT_DEPLOY_DIR:-${RAKAZO_DEPLOY_DIR:-/srv/rakazo}}"
[[ "${APP_DIR}" == /* ]] || { echo "BOBBOT_DEPLOY_DIR must be an absolute path" >&2; exit 1; }

# The privileged interface takes exactly one input: the full commit CI already tested.
target_revision="${BOBBOT_DEPLOY_REVISION:-${RAKAZO_DEPLOY_REVISION:-}}"
if [[ -z "${target_revision}" && -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  read -r target_revision _ <<<"${SSH_ORIGINAL_COMMAND}"
fi
if [[ ! "${target_revision}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Pass the tested full commit SHA as BOBBOT_DEPLOY_REVISION or the SSH command" >&2
  exit 1
fi

# Topology is a space/comma separated list so an overlay stack deploys with the files it runs with.
COMPOSE_FILES_RAW="${BOBBOT_DEPLOY_COMPOSE_FILES:-${RAKAZO_DEPLOY_COMPOSE_FILES:-infra/compose/docker-compose.prod.yml}}"
# CI allows 30 minutes: 15m build + 5m start + ~1m of readiness retries + 8m rollback.
BUILD_TIMEOUT="${BOBBOT_DEPLOY_BUILD_TIMEOUT:-${RAKAZO_DEPLOY_BUILD_TIMEOUT:-15m}}"
UP_TIMEOUT="${BOBBOT_DEPLOY_UP_TIMEOUT:-${RAKAZO_DEPLOY_UP_TIMEOUT:-5m}}"
UP_WAIT_SECONDS="${BOBBOT_DEPLOY_UP_WAIT_SECONDS:-${RAKAZO_DEPLOY_UP_WAIT_SECONDS:-300}}"
ROLLBACK_TIMEOUT="${BOBBOT_DEPLOY_ROLLBACK_TIMEOUT:-${RAKAZO_DEPLOY_ROLLBACK_TIMEOUT:-8m}}"
SNAPSHOT_TIMEOUT="${BOBBOT_DEPLOY_SNAPSHOT_TIMEOUT:-${RAKAZO_DEPLOY_SNAPSHOT_TIMEOUT:-5m}}"
HEALTH_INTERVAL="${BOBBOT_DEPLOY_HEALTH_INTERVAL:-${RAKAZO_DEPLOY_HEALTH_INTERVAL:-2}}"

cd "${APP_DIR}"

read -r -a COMPOSE_FILES <<<"${COMPOSE_FILES_RAW//,/ }"
[[ ${#COMPOSE_FILES[@]} -gt 0 ]] || { echo "BOBBOT_DEPLOY_COMPOSE_FILES is empty" >&2; exit 1; }
for file in "${COMPOSE_FILES[@]}"; do
  if [[ "${file}" == /* || "${file}" == *".."* || ! "${file}" =~ ^[A-Za-z0-9._/-]+\.ya?ml$ || ! -f "${file}" ]]; then
    echo "Invalid Compose file '${file}'; use a relative .yml/.yaml path inside the checkout" >&2
    exit 1
  fi
done
COMPOSE_ARGS=(--env-file .env)
for file in "${COMPOSE_FILES[@]}"; do COMPOSE_ARGS+=(-f "${file}"); done

if [[ -z "${BOBBOT_HEALTH_URL:-${RAKAZO_HEALTH_URL:-}}" ]]; then
  host="$(sed -n 's/^BOBBOT_HOST=//p' .env | tail -n 1)"
  [[ -n "${host}" ]] || { echo "Set BOBBOT_HOST in .env or BOBBOT_HEALTH_URL" >&2; exit 1; }
  BOBBOT_HEALTH_URL="https://${host}/health"
fi

# The revision baked into the images being built; the rollback switches it to the previous commit.
build_revision="${target_revision}"
compose() {
  local limit="$1"
  shift
  timeout --kill-after=30s "${limit}" sudo env \
    GIT_SHA="${build_revision}" \
    docker compose "${COMPOSE_ARGS[@]}" "$@"
}

healthy() {
  curl --fail --silent --show-error --max-time 15 "${BOBBOT_HEALTH_URL:-${RAKAZO_HEALTH_URL:-}}" >/dev/null
}

# The public health endpoint is constant liveness, so the running revision is read from the
# operator-only endpoint on the API port and compared with the commit we asked to deploy.
api_serves_revision() {
  compose 1m exec -T api node -e \
    "fetch('http://127.0.0.1:3100/internal/health').then(r=>r.json()).then(b=>process.exit(b&&b.ok===true&&b.revision===process.argv[1]?0:1)).catch(()=>process.exit(1))" \
    "$1" >/dev/null 2>&1
}

worker_ready() {
  compose 1m logs --no-color --tail 200 worker 2>/dev/null | grep -q '"message":"worker ready"'
}

ready_for() {
  healthy && api_serves_revision "$1" && worker_ready
}

exec 9>"${APP_DIR}/.deploy.lock"
if ! flock -n 9; then
  # CI runs one deploy at a time, so a held lock means an earlier deploy is stuck. Fail loudly
  # instead of reporting a deploy that never happened.
  echo "Another production deployment holds the lock; refusing to report success." >&2
  exit 1
fi

previous_revision="$(git rev-parse HEAD)"
git fetch --quiet --prune origin main
if ! git cat-file -e "${target_revision}^{commit}" 2>/dev/null; then
  echo "Target revision ${target_revision} is not present in ${APP_DIR}." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "${target_revision}" origin/main; then
  echo "Target revision ${target_revision} is not on origin/main; refusing to deploy untested code." >&2
  exit 1
fi

# Written only after a healthy rollout. A reset can make HEAD match before containers change.
deployed_revision=""
if [[ -r "${APP_DIR}/.last-deployed-revision" ]]; then
  deployed_revision="$(tr -d '[:space:]' <"${APP_DIR}/.last-deployed-revision")"
fi
if [[ "${deployed_revision}" == "${target_revision}" ]] && ready_for "${target_revision}"; then
  echo "Production is already at ${target_revision} and ready."
  exit 0
fi

# A rollback returns the code, not the schema: once the new version's migrations ran, the old
# version may never serve again. Snapshot the live database before touching anything, verify it
# the same way backup-prod.sh does, and refuse the update when that is not possible. The dump
# goes next to .deploy.lock so the deploy user can write it without extra privileges; the
# redirect runs in this shell, so the umask keeps it owner-only.
pre_deploy_snapshot=""
discard_snapshot() {
  rm -rf "$1"
  rmdir "${APP_DIR}/.pre-deploy" 2>/dev/null || true
}
pre_deploy_backup() {
  if ! compose 1m exec -T postgres pg_isready >/dev/null 2>&1; then
    echo "Postgres is not running; skipping the pre-deploy snapshot (no data to protect yet)."
    return 0
  fi
  local backup_dir="${APP_DIR}/.pre-deploy/$(date -u +%Y%m%dT%H%M%SZ)-${previous_revision}"
  umask 077
  mkdir -p "${backup_dir}"
  chmod 700 "${APP_DIR}/.pre-deploy" "${backup_dir}"
  if ! compose "${SNAPSHOT_TIMEOUT}" exec -T postgres sh -c \
    'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    >"${backup_dir}/rakazo.dump"; then
    echo "Pre-deploy database snapshot failed; refusing to update without one." >&2
    discard_snapshot "${backup_dir}"
    return 1
  fi
  if ! compose 1m exec -T postgres pg_restore --list <"${backup_dir}/rakazo.dump" >/dev/null; then
    echo "The pre-deploy snapshot is not a valid pg_restore archive; refusing to update." >&2
    discard_snapshot "${backup_dir}"
    return 1
  fi
  if ! (cd "${backup_dir}" && sha256sum rakazo.dump >SHA256SUMS && sha256sum -c --status SHA256SUMS); then
    echo "The pre-deploy snapshot failed its checksum; refusing to update." >&2
    discard_snapshot "${backup_dir}"
    return 1
  fi
  pre_deploy_snapshot="${backup_dir}"
  echo "Pre-deploy database snapshot verified at ${backup_dir}."
  # Keep the newest three snapshots so a failed deploy still has a known-good copy.
  find "${APP_DIR}/.pre-deploy" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +4 |
    while IFS= read -r old; do rm -rf "${old}"; done
}
pre_deploy_backup || exit 1

rollback() {
  trap - ERR
  echo "Deployment failed; restoring the previous revision ${previous_revision}." >&2
  git reset --hard "${previous_revision}"
  build_revision="${previous_revision}"
  if ! compose "${ROLLBACK_TIMEOUT}" up -d --build --wait --wait-timeout "${UP_WAIT_SECONDS}" --remove-orphans; then
    echo "The rollback restart failed; recover from the pre-deploy snapshot ${pre_deploy_snapshot:-<none was taken>}." >&2
    exit 1
  fi
  for _ in {1..30}; do
    if ready_for "${previous_revision}"; then
      echo "Rolled back to ${previous_revision} and it is serving; the update itself failed." >&2
      exit 1
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  # Code is back but the schema may have moved under it; say so instead of implying recovery.
  echo "The rollback is running but never became ready; the database may have been migrated by ${target_revision}." >&2
  echo "Restore the pre-deploy snapshot ${pre_deploy_snapshot:-<none was taken>} with infra/compose/restore-prod.sh; see docs/self-host.md (Restore)." >&2
  exit 1
}
trap rollback ERR

git reset --hard "${target_revision}"
compose 1m config --quiet
compose "${BUILD_TIMEOUT}" build
compose "${UP_TIMEOUT}" up -d --wait --wait-timeout "${UP_WAIT_SECONDS}" --remove-orphans

for _ in {1..30}; do
  if ready_for "${target_revision}"; then
    printf '%s\n' "${target_revision}" >"${APP_DIR}/.last-deployed-revision"
    trap - ERR
    echo "Deployed ${target_revision} successfully."
    exit 0
  fi
  sleep "${HEALTH_INTERVAL}"
done

echo "Production did not become ready at ${target_revision}." >&2
false
