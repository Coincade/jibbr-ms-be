# Alpine: skip mediasoup postinstall (it cannot validate glibc prebuilts on musl during npm ci).
# Install the official linux-x64 worker binary manually; libc6-compat runs it at runtime.
FROM node:22-alpine AS builder

ARG MEDIASOUP_VERSION=3.20.0
ARG MEDIASOUP_WORKER_TAR=mediasoup-worker-${MEDIASOUP_VERSION}-linux-x64-kernel6.tgz

RUN apk add --no-cache openssl libc6-compat curl

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

FROM node:22-alpine AS runner

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules                      ./node_modules
COPY --from=builder /app/packages                          ./packages
COPY --from=builder /app/services/call-service/dist         ./services/call-service/dist
COPY --from=builder /app/services/call-service/package.json ./services/call-service/

EXPOSE 3005
EXPOSE 40000-49999/udp

CMD ["node", "services/call-service/dist/index.js"]
