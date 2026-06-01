# Deploying call-service (mediasoup)

## Requirements

- **HTTP** port (default `3005`) for REST signaling
- **UDP** ports `40000–49999` (or your `MEDIASOUP_RTC_*` range) for WebRTC media
- Same `JWT_SECRET` as auth/socket/messaging services
- `DATABASE_URL` (membership checks + `HuddleSession` history)

## Environment variables

See `services/call-service/.env.example`.

| Variable | Description |
|----------|-------------|
| `MEDIASOUP_ANNOUNCED_IP` | Public IP or hostname clients use to send media |
| `MEDIASOUP_LISTEN_IP` | Bind address (`0.0.0.0` in production) |
| `MEDIASOUP_RTC_MIN_PORT` / `MAX` | UDP port range (open in firewall) |
| `MEDIASOUP_NUM_WORKERS` | CPU cores for mediasoup workers |
| `TURN_*` | ExpressTURN or coturn for strict NAT |
| `ALLOWED_ORIGINS` | Electron/web origins (CORS) |

## Database migration

After pulling, run from `packages/database`:

```bash
npx prisma migrate dev --name huddle_sessions
```

## Droplet + Docker Hub (recommended for small Droplets)

Build on your Mac (more RAM), run on the Droplet (no `docker compose build` on the server).

### 1. On your Mac

```bash
cd jibbr-ms-be
docker login
chmod +x scripts/publish-call-image.sh
export DOCKERHUB_NAMESPACE=atharvad24   # your Docker Hub username
./scripts/publish-call-image.sh           # tags: atharvad24/jibbr-call-service:webrtc-ms
```

Or manually:

```bash
docker build --platform linux/amd64 -f services/call-service/Dockerfile \
  -t atharvad24/jibbr-call-service:webrtc-ms .
docker push atharvad24/jibbr-call-service:webrtc-ms
```

Use `--platform linux/amd64` so the image runs on DigitalOcean (not arm64 from Apple Silicon).

The image uses **Debian bookworm-slim** (glibc). Mediasoup’s `npm postinstall` is skipped (`--ignore-scripts`); the official **linux-x64** worker binary is downloaded in the Dockerfile.

### 2. On the Droplet

Clone the repo (for `.env` only) or copy `services/call-service/.env` to the server.

```bash
cd /opt/jibbr-ms-be
nano services/call-service/.env   # NODE_ENV=production, MEDIASOUP_ANNOUNCED_IP=<public IPv4>

docker login
docker pull atharvad24/jibbr-call-service:webrtc-ms

export CALL_IMAGE=atharvad24/jibbr-call-service:webrtc-ms
docker compose -f docker-compose.call-image.yml up -d
docker compose -f docker-compose.call-image.yml logs -f call-service
curl -s http://localhost:3005/health
```

`docker-compose.call-image.yml` uses **`network_mode: host`** so mediasoup can use UDP 40000–49999 without Docker mapping 10k ports (that pattern times out with `userland proxy` errors).

Open firewall: **TCP 3005**, **UDP 40000–49999**.

### 3. Updates

After code changes: run `./scripts/publish-call-image.sh` on Mac again, then on the Droplet:

```bash
docker pull atharvad24/jibbr-call-service:webrtc-ms
docker compose -f docker-compose.call-image.yml up -d --force-recreate
```

## DigitalOcean App Platform

App Platform is **not** suitable for mediasoup UDP. Use a Droplet for call-service; keep auth/messaging/socket on App Platform.

1. Create an app from `services/call-service/Dockerfile` (or monorepo docker-compose service).
2. Add **HTTP** route to port 3005.
3. Configure **UDP** passthrough for ports 40000–49999 on the droplet/load balancer (App Platform UDP support varies; a Droplet + Docker is often simpler for mediasoup).
4. Set env vars above; use the Droplet’s **public IPv4** for `MEDIASOUP_ANNOUNCED_IP`.

## Electron / web clients

In `jibbr-electron-fe/.env`:

```env
VITE_CALL_API_URL=https://your-call-service.example.com
```

Update CSP in `electron.vite.config.ts` and `src/main/index.ts` (already reads `VITE_CALL_API_URL`).

## Health check

`GET /health` returns `{ status, activeRooms, mediasoupWorkers, uptime }`.

## TURN (production)

Use ExpressTURN or self-hosted coturn. Do not wrap `TURN_CREDENTIAL` in quotes in `.env`.

For scale, use ExpressTURN **premium shared-secret** to mint short-lived credentials per session (see ExpressTURN docs).
