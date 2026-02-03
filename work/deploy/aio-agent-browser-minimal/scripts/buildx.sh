#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

DOCKER_CONFIG_DIR="${DOCKER_CONFIG_DIR:-}"
if [[ -n "${DOCKER_CONFIG_DIR}" ]]; then
  mkdir -p "${DOCKER_CONFIG_DIR}"
  export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"
fi

IMAGE="${IMAGE:-aio-agent-browser-minimal}"
TAG="${TAG:-dev}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${PUSH:-0}"
BUILDER="${BUILDER:-aio-agent-browser-minimal}"

RUNS_DIR="${RUNS_DIR:-${REPO_ROOT}/work/deploy/aio-agent-browser-minimal/_runs}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${RUNS_DIR}/${RUN_ID}-buildx"
METADATA_FILE="${OUT_DIR}/build-metadata.json"

mkdir -p "${OUT_DIR}"

BUILDX=(docker buildx)
if ! docker buildx version >/dev/null 2>&1; then
  if [[ -x "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx" ]]; then
    BUILDX=(/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx)
  fi
fi

if ! "${BUILDX[@]}" inspect "${BUILDER}" >/dev/null 2>&1; then
  "${BUILDX[@]}" create --name "${BUILDER}" --use >/dev/null
else
  "${BUILDX[@]}" use "${BUILDER}" >/dev/null
fi

BUILD_ARGS=(
  --platform "${PLATFORMS}"
  -f "${REPO_ROOT}/work/deploy/aio-agent-browser-minimal/Dockerfile"
  -t "${IMAGE}:${TAG}"
  --metadata-file "${METADATA_FILE}"
)

if [[ "${PUSH}" == "1" ]]; then
  "${BUILDX[@]}" build "${BUILD_ARGS[@]}" --push "${REPO_ROOT}"
else
  "${BUILDX[@]}" build "${BUILD_ARGS[@]}" --output "type=oci,dest=${OUT_DIR}/image.oci.tar" "${REPO_ROOT}"
fi

DIGEST="$(grep -Eo 'sha256:[0-9a-f]{64}' "${METADATA_FILE}" | head -n 1 || true)"

echo "Built: ${IMAGE}:${TAG}"
echo "Platforms: ${PLATFORMS}"
echo "Push: ${PUSH}"
if [[ -n "${DIGEST}" ]]; then
  echo "Digest: ${DIGEST}"
else
  echo "Digest: (not found in ${METADATA_FILE})"
fi
echo "Output: ${OUT_DIR}"
