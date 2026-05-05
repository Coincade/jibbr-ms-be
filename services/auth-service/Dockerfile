# ── Stage 1: install & build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package*.json turbo.json ./
COPY packages/auth-middleware/package*.json packages/auth-middleware/
COPY packages/database/package*.json           packages/database/
COPY packages/database/prisma/                 packages/database/prisma/
COPY packages/logger/package*.json             packages/logger/
COPY packages/rate-limit/package*.json         packages/rate-limit/
COPY packages/shared-types/package*.json       packages/shared-types/
COPY packages/shared-utils/package*.json       packages/shared-utils/
COPY services/auth-service/package*.json       services/auth-service/

RUN npm ci

# Copy full source
COPY packages/ packages/
COPY services/auth-service/ services/auth-service/

# Generate Prisma client then build
RUN npx turbo run db:generate --filter=auth-service
RUN npx turbo run build --filter=auth-service

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

# Copy only what is needed at runtime
COPY --from=builder /app/node_modules                    ./node_modules
COPY --from=builder /app/packages                        ./packages
COPY --from=builder /app/services/auth-service/dist      ./services/auth-service/dist
COPY --from=builder /app/services/auth-service/package.json ./services/auth-service/

EXPOSE 3001

CMD ["node", "services/auth-service/dist/index.js"]
