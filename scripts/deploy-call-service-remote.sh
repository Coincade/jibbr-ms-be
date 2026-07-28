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

echo "Deploying call-service image: $CALL_IMAGE"
docker pull "$CALL_IMAGE"

export CALL_IMAGE
docker compose -f "$COMPOSE_FILE" up -d --force-recreate

docker compose -f "$COMPOSE_FILE" logs --tail=40 call-service || true

if [ -x "./scripts/check-call-service-health.sh" ]; then
  ./scripts/check-call-service-health.sh
else
  curl -fsS --max-time 10 "http://127.0.0.1:3005/health" >/dev/null
fi

echo "call-service deploy complete"
