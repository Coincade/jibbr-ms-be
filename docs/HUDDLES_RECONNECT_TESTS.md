# Huddle reconnect & resilience test matrix

Manual checklist for local/staging. Run with **two users** (A = starter, B = joiner) in the same workspace.

Prerequisites:

- `call-service` on `:3005`, `socket-service` on `:3004`
- Electron apps pointed at local env (`VITE_CALL_API_URL`, `VITE_SOCKET_URL`)
- Optional: `REDIS_URL` set on call-service to verify degraded health when Redis drops

---

## 1. Socket reconnect (presence plane)

| # | Steps | Expected |
|---|--------|----------|
| 1.1 | A and B in an active huddle | Both hear/see each other |
| 1.2 | B: disable Wi‑Fi for ~5s, re-enable | Toast “Connection interrupted…” then clears; B still in huddle; A sees B rejoin presence within ~30s |
| 1.3 | B reconnects | B’s mic/camera still work; no duplicate ghost participant |
| 1.4 | Restart `socket-service` while both in huddle | Clients reconnect; live strip still accurate; in-call users re-announce producers |

**Pass criteria:** No forced leave; `syncRemoteParticipants` recovers missed producers within 30s.

---

## 2. mediasoup transport reconnect (media plane)

| # | Steps | Expected |
|---|--------|----------|
| 2.1 | A and B in huddle with audio | Baseline OK |
| 2.2 | B: brief network blip (airplane mode 3–8s) | “Reconnecting to huddle… (1/3)” toast; audio resumes without manual rejoin |
| 2.3 | B: three consecutive failures (airplane >30s) | “Could not reconnect — please rejoin the huddle”; leave + rejoin works |

**Pass criteria:** Up to 3 automatic transport reconnect attempts with exponential backoff (1s → 2s → 4s, cap 8s).

---

## 3. Mid-call navigation & focus

| # | Steps | Expected |
|---|--------|----------|
| 3.1 | A in huddle, minimizes overlay (docked bar) | Audio continues |
| 3.2 | B switches to a different channel tab while in huddle | Still in huddle; docked bar visible |
| 3.3 | B backgrounds Electron 60s | On focus, audio/video still active or reconnects per §2 |

---

## 4. Join failure rollback

| # | Steps | Expected |
|---|--------|----------|
| 4.1 | A starts huddle; deny mic permission on join | A sees error toast; B does **not** see phantom live huddle |
| 4.2 | A starts huddle in `#general`; B on `#random` | B gets incoming ring/banner (workspace fan-out) |

---

## 5. Stats & health (Phase 3 observability)

| # | Steps | Expected |
|---|--------|----------|
| 5.1 | In huddle 15s+ | call-service logs JSON lines with `"message":"huddle.stats"` every ~5s per user |
| 5.2 | Simulate poor network (Chrome devtools throttle) | `"message":"huddle.stats.degraded"` at most once per 30s per user+room |
| 5.3 | `curl http://localhost:3005/health` | JSON with `status`, `activeRooms`, `mediasoupWorkers.running`, `redis`, `turnConfigured` |
| 5.4 | `./scripts/check-call-service-health.sh` | Exit 0 when healthy/degraded; exit 1 when unhealthy |
| 5.5 | Stop all mediasoup workers (kill process) | `/health` returns HTTP 503, `"status":"unhealthy"` if rooms were active |

### Example stats log line

```json
{
  "timestamp": "2026-06-08T12:00:00.000Z",
  "service": "call-service",
  "level": "info",
  "message": "huddle.stats",
  "event": "huddle.stats",
  "userId": "…",
  "roomId": "…",
  "rttMs": 42,
  "packetsLostPct": 0,
  "outboundBitrateKbps": 64,
  "quality": "good",
  "participantCount": 2
}
```

### Example health response

```json
{
  "status": "healthy",
  "service": "call-service",
  "uptime": 3600,
  "activeRooms": 1,
  "mediasoupWorkers": { "expected": 1, "running": 1, "pids": [12345] },
  "redis": { "configured": true, "connected": true },
  "turnConfigured": false,
  "announcedIpConfigured": false,
  "timestamp": "2026-06-08T12:00:00.000Z"
}
```

---

## Sign-off

| Area | Tester | Date | Pass? |
|------|--------|------|-------|
| Socket reconnect | | | |
| Transport reconnect | | | |
| Navigation/focus | | | |
| Join rollback | | | |
| Stats & health | | | |
