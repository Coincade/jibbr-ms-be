FROM node:22-alpine AS builder

RUN apk add --no-cache openssl python3 make g++

WORKDIR /app

COPY package*.json turbo.json ./
COPY packages/auth-middleware/package*.json packages/auth-middleware/
COPY packages/database/package*.json           packages/database/
COPY packages/database/prisma/                 packages/database/prisma/
COPY packages/logger/package*.json             packages/logger/
COPY packages/shared-types/package*.json       packages/shared-types/
COPY services/call-service/package*.json       services/call-service/

RUN npm ci

COPY packages/ packages/
COPY services/call-service/ services/call-service/

RUN npx turbo run db:generate --filter=call-service
RUN npx turbo run build --filter=call-service

FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules                      ./node_modules
COPY --from=builder /app/packages                          ./packages
COPY --from=builder /app/services/call-service/dist        ./services/call-service/dist
COPY --from=builder /app/services/call-service/package.json ./services/call-service/
COPY --from=builder /app/services/call-service/node_modules ./services/call-service/node_modules

EXPOSE 3005
EXPOSE 40000-49999/udp

CMD ["node", "services/call-service/dist/index.js"]
