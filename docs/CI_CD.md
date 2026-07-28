# CI/CD Runbook

This repo deploys by branch:

- `dev` -> `staging`
- `main` -> `production`

Production deploys should use GitHub Environment approval.

## Workflows

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  - Lint + type-check
  - Vitest unit tests (`npm run test:unit`)
  - Supertest / service-backed integration tests (`npm run test:integration`)
  - Build
- [`.github/workflows/cd.yml`](../.github/workflows/cd.yml)
  - Detect changed services
  - Build/push Docker images
  - Run Prisma migrations
  - Deploy App Platform services
  - Deploy `call-service` to the droplet over SSH
  - Run smoke tests, including `call-service`

## Test Layers

| Command | What it runs | Intended scope |
|--------|---------------|----------------|
| `npm run test:unit` | `turbo run test:unit --filter='./services/*'` | Vitest module-isolated tests with mocks |
| `npm run test:integration` | `turbo run test:e2e --filter='./services/*'` | Supertest app-level tests with Postgres/Redis available |
| `npm run test` | `turbo run test` | Legacy service-level Jest entrypoints |

## GitHub Environments

### `staging`

Required secrets:

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
- `STAGING_CALL_SERVICE_ENV`

### `production`

Required secrets:

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
- `PRODUCTION_CALL_SERVICE_ENV`

## `call-service` droplet deploy

`cd.yml` deploys the media service by:

1. pushing `docker.io/<namespace>/jibbr-call-service:${sha}`
2. copying the env file payload from `*_CALL_SERVICE_ENV`
3. SSHing to the droplet
4. running [`scripts/deploy-call-service-remote.sh`](../scripts/deploy-call-service-remote.sh)
5. checking health via [`scripts/check-call-service-health.sh`](../scripts/check-call-service-health.sh)

The remote host must already contain:

- `/opt/jibbr-ms-be`
- `docker-compose.call-image.yml`
- `scripts/check-call-service-health.sh`

## Rollback

### App Platform

Re-run deployment with an earlier image tag by editing the app spec or triggering a deployment from a previous image.

### `call-service`

On the droplet:

```bash
export CALL_IMAGE=docker.io/<namespace>/jibbr-call-service:<previous-sha-or-tag>
cd /opt/jibbr-ms-be
./scripts/deploy-call-service-remote.sh
```
