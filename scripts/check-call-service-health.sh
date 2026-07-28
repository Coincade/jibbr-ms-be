#!/usr/bin/env bash
# Poll call-service /health and exit non-zero when unhealthy.
#
# Defaults to http://127.0.0.1:3005 because this script is meant to run ON the
# droplet (via SSH). With docker-compose.call-image.yml host networking, the
# container binds the host's loopback/public interfaces directly — 127.0.0.1 is
# correct. Use CALL_SERVICE_URL only for remote checks from another machine.
#
# JSON parsing uses python3 (standard on Ubuntu droplets). Host Node.js is NOT
# required — call-service runs inside Docker.
#
# Usage:
#   ./scripts/check-call-service-health.sh
#   CALL_HEALTH_ATTEMPTS=30 CALL_HEALTH_SLEEP_SECS=2 ./scripts/check-call-service-health.sh
#   CALL_SERVICE_URL=http://168.144.155.162:3005 ./scripts/check-call-service-health.sh

set -euo pipefail

BASE_URL="${CALL_SERVICE_URL:-http://127.0.0.1:3005}"
URL="${BASE_URL%/}/health"
ATTEMPTS="${CALL_HEALTH_ATTEMPTS:-1}"
SLEEP_SECS="${CALL_HEALTH_SLEEP_SECS:-2}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 2
fi

json_get_status() {
  local payload="$1"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$payload" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("status") or "unknown")
except Exception:
    print("invalid")
'
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r '.status // "invalid"' 2>/dev/null || echo "invalid"
    return
  fi
  # Last-resort regex (droplets without python3/jq)
  local status
  status="$(printf '%s' "$payload" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  if [ -n "$status" ]; then
    printf '%s\n' "$status"
  else
    printf 'invalid\n'
  fi
}

print_health_hints() {
  local payload="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  printf '%s' "$payload" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for warning in data.get("warnings") or []:
    print(f"warning: {warning}", file=sys.stderr)
if data.get("turnConfigured") is False:
    print("hint: set TURN_URL / TURN_USERNAME / TURN_CREDENTIAL for production NAT traversal", file=sys.stderr)
if data.get("announcedIpConfigured") is False:
    print("hint: set MEDIASOUP_ANNOUNCED_IP to this host public IP", file=sys.stderr)
'
}

response=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  response="$(curl -fsS --max-time 5 "$URL" 2>/dev/null || true)"
  if [ -n "$response" ]; then
    break
  fi
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    echo "waiting for call-service health (attempt ${attempt}/${ATTEMPTS})..." >&2
    sleep "$SLEEP_SECS"
  fi
done

if [ -z "$response" ]; then
  echo "call-service health check failed: no response from $URL" >&2
  exit 1
fi

status="$(json_get_status "$response")"
echo "$response"
print_health_hints "$response"

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
