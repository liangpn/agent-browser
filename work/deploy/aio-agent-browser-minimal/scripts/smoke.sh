#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

DOCKER_CONFIG_DIR="${DOCKER_CONFIG_DIR:-}"
if [[ -n "${DOCKER_CONFIG_DIR}" ]]; then
  mkdir -p "${DOCKER_CONFIG_DIR}"
  export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"
fi

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/work/deploy/aio-agent-browser-minimal/docker-compose.yml}"
HOST_PORT="${HOST_PORT:-8080}"
export HOST_PORT
BASE_URL="${BASE_URL:-http://localhost:${HOST_PORT}}"
WAIT_SEC="${WAIT_SEC:-90}"
CLEANUP="${CLEANUP:-0}"

RUNS_DIR="${RUNS_DIR:-${REPO_ROOT}/work/deploy/aio-agent-browser-minimal/_runs}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${RUNS_DIR}/${RUN_ID}-smoke"

mkdir -p "${OUT_DIR}"

COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  elif [[ -x "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose" ]]; then
    COMPOSE=(/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose)
  else
    echo "Cannot find docker compose. Install Docker Compose v2 or set COMPOSE explicitly." >&2
    exit 2
  fi
fi

compose() {
  "${COMPOSE[@]}" -f "${COMPOSE_FILE}" "$@"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w "%{http_code}" "${url}" || echo "000"
}

wait_for_http() {
  local url="$1"
  local expected="$2"
  local deadline=$((SECONDS + WAIT_SEC))
  while true; do
    local code
    code="$(http_code "${url}")"
    if [[ "${code}" == "${expected}" ]]; then
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for: ${url} (expected ${expected}, got ${code})" >&2
      return 1
    fi
    sleep 1
  done
}

if [[ "${CLEANUP}" == "1" ]]; then
  trap 'compose down -v >/dev/null 2>&1 || true' EXIT
fi

compose up -d --build

# Wait until VNC UI is ready (avoid transient 503 during startup).
wait_for_http "${BASE_URL}/vnc/index.html" "200"

MCP_CODE="$(http_code "${BASE_URL}/mcp")"
VNC_CODE="$(http_code "${BASE_URL}/vnc/index.html?autoconnect=true")"
TICKETS_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/tickets" || echo "000")"
BLOCKED_CODE="$(http_code "${BASE_URL}/v1/docs")"

{
  echo "BASE_URL=${BASE_URL}"
  echo "/mcp=${MCP_CODE}"
  echo "/vnc/index.html=${VNC_CODE}"
  echo "POST /tickets=${TICKETS_CODE}"
  echo "/v1/docs=${BLOCKED_CODE}"
} | tee "${OUT_DIR}/checks.txt"

compose logs --no-color >"${OUT_DIR}/compose.log" || true

fail=0

# /mcp should be reachable (not 403/404). Some builds may return 405/400 on GET.
if [[ "${MCP_CODE}" == "403" || "${MCP_CODE}" == "404" || "${MCP_CODE}" == "000" ]]; then
  echo "FAIL: /mcp is not reachable (code=${MCP_CODE})" >&2
  fail=1
fi

# /vnc should be reachable (not 403/404).
if [[ "${VNC_CODE}" == "403" || "${VNC_CODE}" == "404" || "${VNC_CODE}" == "000" ]]; then
  echo "FAIL: /vnc is not reachable (code=${VNC_CODE})" >&2
  fail=1
fi

# /tickets should be reachable (not 403/404). It may return 401/405 without JWT.
if [[ "${TICKETS_CODE}" == "403" || "${TICKETS_CODE}" == "404" || "${TICKETS_CODE}" == "000" ]]; then
  echo "FAIL: /tickets is not reachable (code=${TICKETS_CODE})" >&2
  fail=1
fi

# A blocked endpoint should return 403.
if [[ "${BLOCKED_CODE}" != "403" ]]; then
  echo "FAIL: /v1/docs should be blocked with 403 (got ${BLOCKED_CODE})" >&2
  fail=1
fi

if [[ "${fail}" == "0" ]]; then
  echo "Smoke OK. Logs: ${OUT_DIR}"
else
  echo "Smoke FAILED. Logs: ${OUT_DIR}" >&2
  exit 1
fi
