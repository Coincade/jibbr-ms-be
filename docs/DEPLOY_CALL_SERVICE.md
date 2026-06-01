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

## DigitalOcean App Platform

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
