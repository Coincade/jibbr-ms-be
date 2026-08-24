# Staging / production environment files

## Layout

| Path | Purpose |
|------|---------|
| `.env` | Local development only |
| `.env.staging` / `.env.production` | Filled secrets (gitignored) |
| `.env.staging.example` / `.env.production.example` | Templates (committed) |
| `services/*/.env.staging(.example)` | Per-service App Platform / droplet config |
| `services/call-service/.env.*` | Droplet only (not App Platform) |

## Shared secrets within one environment

These must be **identical** across auth, upload, messaging, socket, and call **for that environment**:

- `JWT_SECRET`
- `DATABASE_URL` (Neon for that env)
- `INTERNAL_SERVICE_SECRET` (call + socket only)
- Prefer the same Redis instance (or clearly separate staging vs prod)

Staging values must **not** equal production values.

Desktop version policy (same on every service in that environment):

- `JIBBR_DESKTOP_LATEST_VERSION` / `JIBBR_DESKTOP_MIN_VERSION` (+ optional `UPDATE_URL`, `FORCE_UPDATE`, `REQUIRE_VERSION`)
- `JIBBR_MOBILE_LATEST_VERSION` / `JIBBR_MOBILE_MIN_VERSION` (+ optional same flags) — React Native
- `JIBBR_WEB_LATEST_VERSION` / `JIBBR_WEB_MIN_VERSION` (+ optional same flags) — jibbr-website
- Keep `*_REQUIRE_VERSION=false` until all supported builds of that client send version headers
- Policies are independent per client (`desktop` / `mobile` / `web`)

See [desktop-versioning.md](./desktop-versioning.md).

## How to fill

```bash
# Root checklist for GitHub Environments
cp .env.staging.example .env.staging
cp .env.production.example .env.production

# Each service
cp services/auth-service/.env.staging.example services/auth-service/.env.staging
# …repeat for upload, messaging, socket, call

# Replace every REPLACE_ME_* with real values from Neon / DO / 1Password
```

On DigitalOcean App Platform, paste the staging or production file contents into that app’s Environment Variables (don’t rely on the file in the image).

On the call droplet:

```bash
# staging box
cp services/call-service/.env.staging /opt/jibbr-ms-be/services/call-service/.env

# production box
cp services/call-service/.env.production /opt/jibbr-ms-be/services/call-service/.env
```

## Public URLs (already filled in templates)

| Service | Staging | Production |
|---------|---------|------------|
| Auth | `jibbr-dev-auth-6ib5s` | `jibbr-prod-auth-ircsh` |
| Upload | `jibbr-dev-upload-6yets` | `jibbr-prod-fileupload-nbvgv` |
| Messaging | `jibbr-dev-messaging-jgk48` | `jibbr-prod-messaging-cv5ss` |
| Socket | `jibbr-dev-socket-emtnf` | `jibbr-prod-socket-rq392` |
| Call | `https://call.jibbr.in` (or staging droplet IP) | separate prod droplet / domain |

## GitHub Environment secrets

Use the root env files as a checklist, then paste values into GitHub Environments.

### Staging

- `DIGITALOCEAN_ACCESS_TOKEN`
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `DOCKERHUB_NAMESPACE`
- `STAGING_DATABASE_URL`
- `STAGING_DO_AUTH_APP_ID`
- `STAGING_DO_UPLOAD_APP_ID`
- `STAGING_DO_MESSAGING_APP_ID`
- `STAGING_DO_SOCKET_APP_ID`
- `STAGING_AUTH_URL`
- `STAGING_UPLOAD_URL`
- `STAGING_MESSAGING_URL`
- `STAGING_SOCKET_URL`
- `STAGING_CALL_URL`
- `STAGING_CALL_DROPLET_HOST`
- `STAGING_CALL_DROPLET_USER`
- `STAGING_CALL_DROPLET_SSH_KEY`
- `STAGING_CALL_SERVICE_ENV` (full contents of `services/call-service/.env.staging`)

### Production

- `DIGITALOCEAN_ACCESS_TOKEN`
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `DOCKERHUB_NAMESPACE`
- `PRODUCTION_DATABASE_URL`
- `PRODUCTION_DO_AUTH_APP_ID`
- `PRODUCTION_DO_UPLOAD_APP_ID`
- `PRODUCTION_DO_MESSAGING_APP_ID`
- `PRODUCTION_DO_SOCKET_APP_ID`
- `PRODUCTION_AUTH_URL`
- `PRODUCTION_UPLOAD_URL`
- `PRODUCTION_MESSAGING_URL`
- `PRODUCTION_SOCKET_URL`
- `PRODUCTION_CALL_URL`
- `PRODUCTION_CALL_DROPLET_HOST`
- `PRODUCTION_CALL_DROPLET_USER`
- `PRODUCTION_CALL_DROPLET_SSH_KEY`
- `PRODUCTION_CALL_SERVICE_ENV` (full contents of `services/call-service/.env.production`)

## Electron

Use `jibbr-electron-fe/.env.staging` and `.env.production` so `VITE_*` URLs match the table above. Never point a staging Electron build at `jibbr-prod-*`.
