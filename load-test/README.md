# Load testing all microservices

Load tests use [Artillery](https://www.artillery.io/) and target the **health** endpoints of all four services (no auth). Use this to validate that every service stays responsive under load.

## Prerequisites

- All four services running on default ports (or set env vars below):
  - **Auth:** 3001  
  - **Upload:** 3002  
  - **Messaging:** 3003  
  - **Socket:** 3004  

Start everything (from repo root):

```bash
# Start infra (Postgres, Redis)
docker-compose up -d

# Start all services
npm run dev:all
```

## Run load tests

From the **monorepo root** (`jibbr-turbo-repo`):

```bash
# Health endpoints only (recommended first run)
npm run load-test

# Same, explicit config
npx artillery run load-test/artillery-health.yml

# Mixed load: each virtual user hits all four services
npm run load-test:all
```

## Override ports

If your services run on different ports, set env vars:

```powershell
# PowerShell
$env:AUTH_PORT="3001"; $env:UPLOAD_PORT="3002"; $env:MESSAGING_PORT="3003"; $env:SOCKET_PORT="3004"
npx artillery run load-test/artillery-health.yml
```

Then add the processor to the config (in the yml):

```yaml
config:
  processor: "./load-test/processor.js"
  # ... rest of config
```

Or edit the `variables` section in `load-test/artillery-health.yml` directly.

## What is being tested?

| Config                    | What it does                                                                 |
|---------------------------|-------------------------------------------------------------------------------|
| `artillery-health.yml`    | Four scenarios (one per service); each request hits one service’s `/health`.  |
| `artillery-all-services.yml` | One scenario; each virtual user hits all four `/health` endpoints in sequence. |

Reports print at the end: requests/sec, latency (p95, p99), and failure rate.

## Testing authenticated endpoints

Health checks do not use auth. To load test protected routes (e.g. `/api/auth/user`, `/api/messages/...`):

1. Get a JWT (e.g. login via Postman or your app).
2. Use Artillery’s `beforeScenario` or a processor to set a header:
   - `Authorization: Bearer <token>`
3. Add a new scenario in a new yml file that calls your API with that header.

Example (add to a new `artillery-auth.yml`):

```yaml
config:
  target: "http://localhost:3001"
  processor: "./load-test/processor.js"
  variables:
    token: "YOUR_JWT_HERE"  # or set via env in processor
scenarios:
  - name: "Get current user"
    flow:
      - get:
          url: "/api/auth/user"
          headers:
            Authorization: "Bearer {{ token }}"
```

## WebSocket (socket-service)

The current config only hits the HTTP **health** endpoint on the socket service. To load test WebSocket connections (connect, join room, send message), use Artillery’s WebSocket support or a dedicated tool (e.g. [k6 WebSocket](https://k6.io/docs/using-k6-websocket/), or a small Node script with `ws`).
