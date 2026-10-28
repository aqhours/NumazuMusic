#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${YOMIKANA_APP_DIR:-/opt/apps/yomikana}"
BRANCH="${YOMIKANA_BRANCH:-main}"
REMOTE="${YOMIKANA_REMOTE:-origin}"
LOCK_FILE="${YOMIKANA_LOCK_FILE:-/run/aqhours-webhook/yomikana.lock}"
LOCK_WAIT_SECONDS="${YOMIKANA_LOCK_WAIT_SECONDS:-900}"
SITE_URL="${YOMIKANA_SITE_URL:-https://numazumusic.aqhours.cn/}"
GITHUB_REPOSITORY="${YOMIKANA_GITHUB_REPOSITORY:-aqhours/yomikana}"
FETCH_URL="${YOMIKANA_FETCH_URL:-https://github.com/${GITHUB_REPOSITORY}.git}"
DEPLOYMENT_ENVIRONMENT="${YOMIKANA_DEPLOYMENT_ENVIRONMENT:-production}"
DEPLOYMENT_REPORTER="${YOMIKANA_DEPLOYMENT_REPORTER:-/opt/deploy/github-deployment-status.sh}"
TARGET_COMMIT="${1:-${DEPLOY_SHA:-}}"
deployment_id=""

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

report_deployment_status() {
  local state="$1"

  [[ -n "$deployment_id" ]] || return 0
  if ! "$DEPLOYMENT_REPORTER" status \
    "$GITHUB_REPOSITORY" "$deployment_id" "$state" \
    "$DEPLOYMENT_ENVIRONMENT" "$SITE_URL"; then
    log "WARNING: Could not report GitHub deployment status: ${state}"
  fi
}

on_error() {
  local exit_code=$?
  trap - ERR
  report_deployment_status failure
  log "Deployment failed at line ${BASH_LINENO[0]} with exit code ${exit_code}."
  exit "$exit_code"
}
trap on_error ERR

for command_name in curl docker flock git mesh-proxy python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Required command not found: ${command_name}"
done

[[ "$TARGET_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || fail "A full 40-character Git commit SHA is required."
[[ -d "$APP_DIR/.git" ]] || fail "Not a Git checkout: ${APP_DIR}"
[[ -f "$APP_DIR/compose.yaml" ]] || fail "compose.yaml not found in ${APP_DIR}"
[[ -x "$DEPLOYMENT_REPORTER" ]] || fail "Deployment reporter is not executable: ${DEPLOYMENT_REPORTER}"

exec 9>"$LOCK_FILE"
log "Waiting for deployment lock."
flock -w "$LOCK_WAIT_SECONDS" 9 || fail "Timed out waiting for ${LOCK_FILE}"

if deployment_id="$($DEPLOYMENT_REPORTER create \
  "$GITHUB_REPOSITORY" "$TARGET_COMMIT" "$DEPLOYMENT_ENVIRONMENT" "$SITE_URL")"; then
  report_deployment_status in_progress
  log "GitHub deployment ${deployment_id} is in progress."
else
  deployment_id=""
  log "WARNING: Could not create a GitHub deployment; continuing without status reporting."
fi

cd "$APP_DIR"
log "Fetching ${FETCH_URL} ${BRANCH}."
mesh-proxy exec git fetch --prune "$FETCH_URL" \
  "+refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}"

git cat-file -e "${TARGET_COMMIT}^{commit}"
git merge-base --is-ancestor "$TARGET_COMMIT" "${REMOTE}/${BRANCH}" \
  || fail "Target commit is not reachable from ${REMOTE}/${BRANCH}: ${TARGET_COMMIT}"

current_commit="$(git rev-parse --verify HEAD)"
log "Updating checkout from ${current_commit} to ${TARGET_COMMIT}."
git reset --hard "$TARGET_COMMIT"

log "Building production image."
mesh-proxy pull node:22-bookworm-slim
mesh-proxy exec docker compose build --pull

log "Starting production service."
docker compose up -d --remove-orphans --no-build --wait --wait-timeout 120
docker compose ps

for attempt in {1..12}; do
  if curl --fail --silent --show-error --head --max-time 10 "$SITE_URL" >/dev/null; then
    log "Health check passed: ${SITE_URL}"
    report_deployment_status success
    log "Deployment completed at ${TARGET_COMMIT}."
    exit 0
  fi

  log "Health check ${attempt}/12 failed; retrying in 5 seconds."
  sleep 5
done

fail "Health check did not pass: ${SITE_URL}"
