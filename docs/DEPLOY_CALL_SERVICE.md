# Call-service deployment notes (mediasoup on DigitalOcean Droplet)

Use this as a runbook for staging/production. Build the image on your Mac or in GitHub Actions; run it on a Droplet with **host networking** (required for UDP).

---

## Architecture (quick reference)

| Piece | Where | Port / protocol |
|-------|--------|-----------------|
| call-service REST | Droplet | TCP **3005** |
| WebRTC media (mediasoup) | Droplet | UDP **40000–49999** |
| Huddle signaling | App Platform socket-service | HTTPS (not on Droplet) |
| Auth / messaging | App Platform | HTTPS |
| Image registry | Docker Hub | `atharvad24/jibbr-call-service:webrtc-ms` |

**Do not** use App Platform for call-service (UDP/WebRTC).

---

## One-time setup

### DigitalOcean Droplet

- [ ] Ubuntu 22.04+ (1 GB+ RAM recommended)
- [ ] SSH key added in DO account
- [ ] Note **public IPv4** → used as `MEDIASOUP_ANNOUNCED_IP`
- [ ] Hostname example: `webrtc`

### Firewall (DO control panel)

- [ ] Inbound **TCP** `3005`
- [ ] Inbound **UDP** `40000–49999`
- [ ] Inbound **TCP** `22` (SSH, restrict by IP if possible)

### Droplet software (first time only)

```bash
ssh root@<DROPLET_PUBLIC_IP>

apt-get update && apt-get install -y docker.io docker-compose-v2 git
systemctl enable docker && systemctl start docker

mkdir -p /opt/jibbr-ms-be && cd /opt/jibbr-ms-be
git clone -b webrtc-ms https://github.com/Coincade/jibbr-ms-be.git .
```

### Server env file

Edit `services/call-service/.env` (see `.env.example`):

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` — **same** as auth, socket, messaging
- [ ] `DATABASE_URL` — Neon Postgres
- [ ] `MEDIASOUP_LISTEN_IP=0.0.0.0`
- [ ] `MEDIASOUP_ANNOUNCED_IP=<DROPLET_PUBLIC_IPV4>` (not private IP)
- [ ] `MEDIASOUP_RTC_MIN_PORT=40000` / `MAX=49999`
- [ ] Optional: `MEDIASOUP_NUM_WORKERS` — defaults to `min(4, cpus-1)` with least-loaded room assignment (single-node only; multi-droplet SFU not supported yet)
- [ ] `ALLOWED_ORIGINS` — staging/prod DO app URLs + `http://localhost:5173`
- [ ] **Recommended for prod:** `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` (no quotes on credential)
- [ ] Optional: `CALL_REQUIRE_NAT_CONFIG=1` — marks `/health` as `degraded` when TURN or announced IP is missing
- [ ] **Producer lifecycle (Phase C+):** same `INTERNAL_SERVICE_SECRET` on **call-service** and **socket-service**; `SOCKET_SERVICE_INTERNAL_URL` on call-service → socket HTTP (e.g. `https://<socket-app-url>` or `http://localhost:3004` locally). Startup log should show `ICE: STUN + TURN` or `STUN only` warning.
- [ ] **Huddles product (Phase D):** workspace fan-out + huddle-ended chat messages use the same internal secret. See [HUDDLES.md](./HUDDLES.md).

### Database (Neon)

- [ ] Migration applied (`HuddleSession` table exists)

```bash
cd packages/database && npx prisma migrate deploy
```

### Docker Hub

- [ ] Account / namespace: `atharvad24` (or set `DOCKERHUB_NAMESPACE`)

---

## Deploy / update image (Mac)

**When to rebuild & push:** call-service code, Dockerfile, or `package-lock.json` changes.

**When git push only is enough:** `docker-compose.call-image.yml` or docs (no new image).

```bash
cd jibbr-ms-be

docker login
export DOCKERHUB_NAMESPACE=atharvad24
./scripts/publish-call-image.sh
# optional custom tag: ./scripts/publish-call-image.sh v1.0.0
```

- Builds `linux/amd64` for DigitalOcean (Apple Silicon Mac).
- Image: **Debian bookworm-slim** (glibc). Mediasoup worker installed in Dockerfile (no Alpine — worker exits with code 127 on Alpine).
- No `apt-get` in Dockerfile (avoids Debian HTTP 403 in Docker builds).

Commit & push code when needed:

```bash
git add -A && git commit -m "..." && git push origin webrtc-ms
```

---

## Deploy / update on Droplet

```bash
ssh root@<DROPLET_PUBLIC_IP>
cd /opt/jibbr-ms-be

git pull origin webrtc-ms          # compose file + docs
docker login                       # first time or expired
docker pull atharvad24/jibbr-call-service:webrtc-ms

export CALL_IMAGE=atharvad24/jibbr-call-service:webrtc-ms
docker compose -f docker-compose.call-image.yml up -d --force-recreate

docker compose -f docker-compose.call-image.yml logs --tail=30 call-service
curl -s http://localhost:3005/health
```

## Deploy from GitHub Actions

The repo CD workflow can deploy `call-service` automatically:

1. Build/push `docker.io/<namespace>/jibbr-call-service:${sha}`
2. Copy `STAGING_CALL_SERVICE_ENV` or `PRODUCTION_CALL_SERVICE_ENV` to `/opt/jibbr-ms-be/services/call-service/.env`
3. SSH to the droplet
4. Run `scripts/deploy-call-service-remote.sh`
5. Verify `/health`

Required GitHub Environment secrets:

- `*_CALL_DROPLET_HOST`
- `*_CALL_DROPLET_USER`
- `*_CALL_DROPLET_SSH_KEY`
- `*_CALL_SERVICE_ENV`
- `*_CALL_URL`

**Success signals in logs:**

- `[mediasoup] 1 worker(s) started`
- `Call service running on port 3005`

**Health (on droplet or Mac):**

```bash
curl -s http://<DROPLET_PUBLIC_IP>:3005/health
# expect: "status":"healthy", "mediasoupWorkers":1
```

During an active huddle, `activeRooms` should be > 0.

---

## Electron client (staging)

In `jibbr-electron-fe/.env`:

```env
VITE_API_URL=https://jibbr-dev-messaging-jgk48.ondigitalocean.app
VITE_AUTH_API_URL=https://jibbr-dev-auth-6ib5s.ondigitalocean.app
VITE_UPLOAD_API_URL=https://jibbr-dev-upload-6yets.ondigitalocean.app
VITE_SOCKET_URL=https://jibbr-dev-socket-emtnf.ondigitalocean.app
VITE_CALL_API_URL=http://<DROPLET_PUBLIC_IP>:3005
```

Restart Electron after changing `.env`.

---

## Important gotchas (learned from production)

| Issue | Cause | Fix |
|-------|--------|-----|
| `userland proxy` timeout on `up` | Mapping UDP 40000–49999 in compose | Use `network_mode: host` in `docker-compose.call-image.yml` |
| mediasoup `code:127` | Alpine + glibc worker | Use **bookworm-slim** image (current Dockerfile) |
| `apt-get` 403 during build | Debian HTTP mirrors in Docker | Current Dockerfile uses Node `fetch` — no apt |
| Health empty / crash loop | Wrong image or worker failed | `docker pull` latest; check logs |
| No audio, health OK | Wrong announced IP or UDP blocked | `MEDIASOUP_ANNOUNCED_IP` = public IPv4; open UDP range |
| 401 on call API | JWT mismatch | Align `JWT_SECRET` with auth service |
| Huddle UI stuck | Socket down / wrong URL | `VITE_SOCKET_URL` → dev socket app |

**Do not** map `40000-49999:40000-49999/udp` in compose.

**Do not** use Alpine for the runtime image with mediasoup prebuilt workers.

---

## Rollback

```bash
docker pull atharvad24/jibbr-call-service:<previous-tag>
export CALL_IMAGE=atharvad24/jibbr-call-service:<previous-tag>
docker compose -f docker-compose.call-image.yml up -d --force-recreate
```

---

## Files reference

| File | Purpose |
|------|---------|
| `services/call-service/Dockerfile` | Image build |
| `scripts/publish-call-image.sh` | Mac: build + push |
| `docker-compose.call-image.yml` | Droplet: run image (`network_mode: host`) |
| `services/call-service/.env` | Server secrets (not in image) |
| `services/call-service/.env.example` | Template |

---

## Optional later

- HTTPS reverse proxy (Caddy/nginx) for call REST
- Fix Prisma OpenSSL warning in Dockerfile (cosmetic if health is OK)
- `kernel5` mediasoup worker tarball only if droplet kernel is 5.x (`uname -r`)

---

## Health & TURN

- `GET /health` → `{ status, activeRooms, mediasoupWorkers, uptime, turnConfigured, announcedIpConfigured, warnings }`
- `/health.warnings` lists missing TURN / announced IP without forcing unhealthy (unless `CALL_REQUIRE_NAT_CONFIG=1`)
- TURN: ExpressTURN or coturn; no quotes around `TURN_CREDENTIAL`
- Clients toast when join reports `turnConfigured: false`
