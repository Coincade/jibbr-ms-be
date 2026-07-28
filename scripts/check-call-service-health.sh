#!/usr/bin/env bash
# Poll call-service /health and exit non-zero when unhealthy.
# Usage:
#   ./scripts/check-call-service-health.sh
#   CALL_SERVICE_URL=http://168.144.155.162:3005 ./scripts/check-call-service-health.sh

set -euo pipefail

BASE_URL="${CALL_SERVICE_URL:-http://127.0.0.1:3005}"
URL="${BASE_URL%/}/health"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 2
fi

response="$(curl -fsS --max-time 5 "$URL" 2>/dev/null || true)"
if [ -z "$response" ]; then
  echo "call-service health check failed: no response from $URL" >&2
  exit 1
fi

status="$(printf '%s' "$response" | node -e "
  let data = '';
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(data);
      process.stdout.write(String(j.status || 'unknown'));
    } catch {
      process.stdout.write('invalid');
    }
  });
")"

echo "$response"

printf '%s' "$response" | node -e "
  let data = '';
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(data);
      const warnings = Array.isArray(j.warnings) ? j.warnings : [];
      for (const w of warnings) console.error('warning:', w);
      if (j.turnConfigured === false) {
        console.error('hint: set TURN_URL / TURN_USERNAME / TURN_CREDENTIAL for production NAT traversal');
      }
      if (j.announcedIpConfigured === false) {
        console.error('hint: set MEDIASOUP_ANNOUNCED_IP to this host public IP');
      }
    } catch { /* ignore */ }
  });
"

case "$status" in
  healthy) exit 0 ;;
  degraded) echo "warning: call-service is degraded" >&2; exit 0 ;;
  unhealthy)
    echo "error: call-service is unhealthy" >&2
    exit 1
    ;;
  *)
    echo "error: unexpected health status: $status" >&2
    exit 1
    ;;
esac
