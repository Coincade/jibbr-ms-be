# ── Stage 1: install & build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json turbo.json ./
COPY packages/auth-middleware/package*.json packages/auth-middleware/
COPY packages/database/package*.json           packages/database/
COPY packages/database/prisma/                 packages/database/prisma/
COPY packages/logger/package*.json             packages/logger/
COPY packages/rate-limit/package*.json         packages/rate-limit/
COPY packages/shared-types/package*.json       packages/shared-types/
COPY packages/shared-utils/package*.json       packages/shared-utils/
COPY services/socket-service/package*.json     services/socket-service/

RUN npm ci

COPY packages/ packages/
COPY services/socket-service/ services/socket-service/

RUN npx turbo run db:generate --filter=socket-service
RUN npx turbo run build --filter=socket-service

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules                      ./node_modules
COPY --from=builder /app/packages                          ./packages
COPY --from=builder /app/services/socket-service/dist      ./services/socket-service/dist
COPY --from=builder /app/services/socket-service/package.json ./services/socket-service/

EXPOSE 3004

CMD ["node", "services/socket-service/dist/index.js"]
