# Debian slim: mediasoup's prebuilt glibc worker does not run on Alpine (exit 127 at runtime).
# Skip postinstall during npm ci; install the official linux-x64 worker binary manually.
FROM node:22-bookworm-slim AS builder

ARG MEDIASOUP_VERSION=3.20.0
ARG MEDIASOUP_WORKER_TAR=mediasoup-worker-${MEDIASOUP_VERSION}-linux-x64-kernel6.tgz

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/*

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
  && curl -fsSL -o /tmp/mediasoup-worker.tgz \
    "https://github.com/versatica/mediasoup/releases/download/${MEDIASOUP_VERSION}/${MEDIASOUP_WORKER_TAR}" \
  && tar -xzf /tmp/mediasoup-worker.tgz -C node_modules/mediasoup/worker/out/Release \
  && chmod +x node_modules/mediasoup/worker/out/Release/mediasoup-worker \
  && rm /tmp/mediasoup-worker.tgz

COPY packages/ packages/
COPY services/call-service/ services/call-service/

RUN npx turbo run db:generate --filter=call-service
RUN npx turbo run build --filter=call-service

FROM node:22-bookworm-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules                      ./node_modules
COPY --from=builder /app/packages                          ./packages
COPY --from=builder /app/services/call-service/dist         ./services/call-service/dist
COPY --from=builder /app/services/call-service/package.json ./services/call-service/

EXPOSE 3005
EXPOSE 40000-49999/udp

CMD ["node", "services/call-service/dist/index.js"]
