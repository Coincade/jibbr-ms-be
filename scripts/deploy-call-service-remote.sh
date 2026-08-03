#!/usr/bin/env bash
# Run on the call-service droplet via SSH from GitHub Actions.
# Expects:
#   - /opt/jibbr-ms-be/services/call-service/.env to already exist
#   - CALL_IMAGE to be exported (defaults to Docker Hub stable tag)
#
# Example:
#   CALL_IMAGE=docker.io/atharvad24/jibbr-call-service:<sha> ./scripts/deploy-call-service-remote.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CALL_IMAGE="${CALL_IMAGE:-atharvad24/jibbr-call-service:webrtc-ms}"
ENV_FILE="services/call-service/.env"
COMPOSE_FILE="docker-compose.call-image.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE on remote host" >&2
  exit 1
fi

echo "Disk before deploy:"
df -h / /var/lib/docker 2>/dev/null || df -h /

# Keep only the running call-service image + layers we need; free dangling/unused data
# so repeated CD pulls don't fill the droplet (common failure: containerd "no space left on device").
echo "Pruning unused Docker data (images/containers/build cache)…"
docker container prune -f >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
docker builder prune -af >/dev/null 2>&1 || true

AVAIL_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
# Require ~2 GiB free before pull (call image + extract headroom).
if [ -n "${AVAIL_KB}" ] && [ "${AVAIL_KB}" -lt 2000000 ]; then
  echo "ERROR: only ${AVAIL_KB} KB free on / — need ≥2 GiB to pull call-service." >&2
  echo "SSH to the droplet and free space, e.g.:" >&2
  echo "  docker system df" >&2
  echo "  sudo journalctl --vacuum-size=100M" >&2
  echo "  sudo apt-get clean" >&2
  df -h / >&2
  exit 1
fi

echo "Disk after prune:"
df -h / 2>/dev/null || true

echo "Deploying call-service image: $CALL_IMAGE"
if ! docker pull "$CALL_IMAGE"; then
  echo "ERROR: docker pull failed (often disk full while extracting layers)." >&2
  df -h / /var/lib/docker 2>/dev/null || df -h / >&2
  docker system df >&2 || true
  exit 1
fi

export CALL_IMAGE
docker compose -f "$COMPOSE_FILE" up -d --force-recreate

# Drop any leftover untagged layers from the previous SHA after recreate.
docker image prune -f >/dev/null 2>&1 || true

echo "Container status:"
docker compose -f "$COMPOSE_FILE" ps || true
docker compose -f "$COMPOSE_FILE" logs --tail=40 call-service || true

# Health is checked on the droplet loopback (host networking). Do not use the
# public staging URL here — this process is already SSH'd onto that host.
if [ -x "./scripts/check-call-service-health.sh" ]; then
  if ! CALL_HEALTH_ATTEMPTS="${CALL_HEALTH_ATTEMPTS:-30}" \
    CALL_HEALTH_SLEEP_SECS="${CALL_HEALTH_SLEEP_SECS:-2}" \
    CALL_SERVICE_URL="${CALL_SERVICE_URL:-http://127.0.0.1:3005}" \
    ./scripts/check-call-service-health.sh; then
    echo "----- call-service logs (tail) -----" >&2
    docker compose -f "$COMPOSE_FILE" logs --tail=120 call-service || true
    echo "----- container inspect -----" >&2
    docker ps -a --filter name=jibbr-call-service --no-trunc || true
    exit 1
  fi
else
  curl -fsS --retry 30 --retry-delay 2 --retry-connrefused --max-time 5 \
    "http://127.0.0.1:3005/health" >/dev/null
fi

echo "call-service deploy complete"
