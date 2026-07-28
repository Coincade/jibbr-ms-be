#!/usr/bin/env bash
# Build call-service for linux/amd64 (Droplet) and push to Docker Hub.
# Usage (from jibbr-ms-be root):
#   export DOCKERHUB_NAMESPACE=your-dockerhub-user
#   ./scripts/publish-call-image.sh
#   ./scripts/publish-call-image.sh v1.0.0   # custom tag

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAMESPACE="${DOCKERHUB_NAMESPACE:-atharvad24}"
TAG="${1:-webrtc-ms}"
IMAGE="${NAMESPACE}/jibbr-call-service:${TAG}"

echo "Building ${IMAGE} for linux/amd64..."
docker build --platform linux/amd64 \
  -f services/call-service/Dockerfile \
  -t "${IMAGE}" \
  .

echo "Pushing ${IMAGE}..."
docker push "${IMAGE}"

echo ""
echo "Done. On the Droplet:"
echo "  docker login"
echo "  docker pull ${IMAGE}"
echo "  export CALL_IMAGE=${IMAGE}"
echo "  cd /opt/jibbr-ms-be && docker compose -f docker-compose.call-image.yml up -d"
