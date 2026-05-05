# ── Stage 1: install & build ────────────────────────────────────────────────
FROM node:18-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json turbo.json ./
COPY packages/auth-middleware/package*.json packages/auth-middleware/
COPY packages/database/package*.json           packages/database/
COPY packages/logger/package*.json             packages/logger/
COPY packages/rate-limit/package*.json         packages/rate-limit/
COPY packages/shared-types/package*.json       packages/shared-types/
COPY packages/shared-utils/package*.json       packages/shared-utils/
COPY services/messaging-service/package*.json  services/messaging-service/

RUN npm ci

COPY packages/ packages/
COPY services/messaging-service/ services/messaging-service/

RUN npx turbo run db:generate --filter=messaging-service
RUN npx turbo run build --filter=messaging-service

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:18-alpine AS runner

RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules                         ./node_modules
COPY --from=builder /app/packages                             ./packages
COPY --from=builder /app/services/messaging-service/dist      ./services/messaging-service/dist
COPY --from=builder /app/services/messaging-service/package.json ./services/messaging-service/

EXPOSE 3003

CMD ["node", "services/messaging-service/dist/index.js"]
