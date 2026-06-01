# Debian slim (glibc): mediasoup prebuilt worker does not run on Alpine (exit 127).
# No apt-get — Debian HTTP mirrors often return 403 in Docker; curl/openssl come from the Node base image.
FROM node:22-bookworm-slim AS builder

ARG MEDIASOUP_VERSION=3.20.0
ARG MEDIASOUP_WORKER_TAR=mediasoup-worker-${MEDIASOUP_VERSION}-linux-x64-kernel6.tgz

WORKDIR /app

COPY package*.json turbo.json ./
COPY packages/auth-middleware/package*.json packages/auth-middleware/
COPY packages/database/package*.json           packages/database/
COPY packages/database/prisma/                 packages/database/prisma/
COPY packages/logger/package*.json             packages/logger/
COPY packages/shared-types/package*.json       packages/shared-types/
COPY services/call-service/package*.json       services/call-service/

RUN npm ci --workspace=call-service --include-workspace-root --ignore-scripts

RUN mkdir -p node_modules/mediasoup/worker/out/Release \
  && node --input-type=module -e " \
    import { execSync } from 'node:child_process'; \
    import fs from 'node:fs'; \
    const v = '${MEDIASOUP_VERSION}'; \
    const tar = '${MEDIASOUP_WORKER_TAR}'; \
    const url = \`https://github.com/versatica/mediasoup/releases/download/\${v}/\${tar}\`; \
    const res = await fetch(url); \
    if (!res.ok) throw new Error(\`mediasoup worker download failed: \${res.status}\`); \
    fs.writeFileSync('/tmp/mediasoup-worker.tgz', Buffer.from(await res.arrayBuffer())); \
    execSync('tar -xzf /tmp/mediasoup-worker.tgz -C node_modules/mediasoup/worker/out/Release'); \
    fs.chmodSync('node_modules/mediasoup/worker/out/Release/mediasoup-worker', 0o755); \
    fs.unlinkSync('/tmp/mediasoup-worker.tgz'); \
  "

COPY packages/ packages/
COPY services/call-service/ services/call-service/

RUN npx turbo run db:generate --filter=call-service
RUN npx turbo run build --filter=call-service

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules                      ./node_modules
COPY --from=builder /app/packages                          ./packages
COPY --from=builder /app/services/call-service/dist         ./services/call-service/dist
COPY --from=builder /app/services/call-service/package.json ./services/call-service/

EXPOSE 3005
EXPOSE 40000-49999/udp

CMD ["node", "services/call-service/dist/index.js"]
