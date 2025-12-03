# Migration Guide: Moving to Turborepo

This guide helps you migrate your existing services to the new Turborepo structure.

## Current Structure → New Structure

### Auth Service
- **Current**: `jibbr-auth-microservice/`
- **New**: `jibbr-turbo-repo/services/auth-service/`

**What to migrate:**
1. Copy `src/controllers/auth.controller.ts`
2. Copy `src/routes/auth.route.ts` and `src/routes/verify.route.ts`
3. Copy `src/middleware/Auth.middleware.ts` (or use shared `@jibbr/auth-middleware`)
4. Copy `src/validation/auth.validations.ts`
5. Copy `src/config/mail.ts`
6. Copy `src/helper.ts` (or move shared parts to `@jibbr/shared-utils`)
7. Copy `src/views/` directory for email templates
8. Copy Prisma schema (already created)

### Upload Service
- **Current**: `jibbr-upload-microservice/`
- **New**: `jibbr-turbo-repo/services/upload-service/`

**What to migrate:**
1. Copy `src/controllers/upload.controller.ts`
2. Copy `src/routes/upload.route.ts`
3. Copy `src/middleware/Auth.middleware.ts` (or use shared `@jibbr/auth-middleware`)
4. Copy `src/config/upload.ts`

### Messaging Service
- **Current**: `jibbr-backend/` (messaging parts)
- **New**: `jibbr-turbo-repo/services/messaging-service/`

**What to migrate:**
1. Copy `src/controllers/message.controller.ts`
2. Copy `src/routes/message.route.ts`
3. Copy `src/controllers/channel.controller.ts` and `src/routes/channel.route.ts`
4. Copy `src/controllers/conversation.controller.ts` and `src/routes/conversation.route.ts`
5. Copy `src/controllers/workspace.controller.ts` and `src/routes/workspace.route.ts`
6. Copy `src/websocket/` directory (entire WebSocket implementation)
7. Copy `src/config/redis.ts` (already created, may need updates)
8. Copy `src/services/` (mention.service.ts, notification.service.ts, etc.)
9. Copy Prisma schema (already created, but needs User model removed)

## Step-by-Step Migration

### Step 1: Install Dependencies

```bash
cd jibbr-turbo-repo
npm install
```

### Step 2: Migrate Auth Service

```bash
# Copy files
cp -r ../jibbr-auth-microservice/src/controllers/* services/auth-service/src/controllers/
cp -r ../jibbr-auth-microservice/src/routes/* services/auth-service/src/routes/
cp -r ../jibbr-auth-microservice/src/validation/* services/auth-service/src/validation/
cp -r ../jibbr-auth-microservice/src/config/* services/auth-service/src/config/
cp -r ../jibbr-auth-microservice/src/views services/auth-service/src/
cp ../jibbr-auth-microservice/src/helper.ts services/auth-service/src/
```

Update `services/auth-service/src/index.ts` to import routes:
```typescript
import authRoutes from './routes/auth.route.js';
import verifyRoutes from './routes/verify.route.js';

app.use('/api/auth', authRoutes);
app.use('/api/verify', verifyRoutes);
```

### Step 3: Migrate Upload Service

```bash
# Copy files
cp -r ../jibbr-upload-microservice/src/controllers/* services/upload-service/src/controllers/
cp -r ../jibbr-upload-microservice/src/routes/* services/upload-service/src/routes/
cp -r ../jibbr-upload-microservice/src/config/* services/upload-service/src/config/
```

Update `services/upload-service/src/index.ts` to import routes:
```typescript
import uploadRoutes from './routes/upload.route.js';

app.use('/api/upload', uploadRoutes);
```

### Step 4: Migrate Messaging Service

```bash
# Copy controllers and routes
cp -r ../jibbr-backend/src/controllers/message.controller.ts services/messaging-service/src/controllers/
cp -r ../jibbr-backend/src/controllers/channel.controller.ts services/messaging-service/src/controllers/
cp -r ../jibbr-backend/src/controllers/conversation.controller.ts services/messaging-service/src/controllers/
cp -r ../jibbr-backend/src/controllers/workspace.controller.ts services/messaging-service/src/controllers/
cp -r ../jibbr-backend/src/controllers/user.controller.ts services/messaging-service/src/controllers/
cp -r ../jibbr-backend/src/controllers/notification.controller.ts services/messaging-service/src/controllers/
cp -r ../jibbr-backend/src/controllers/presence.controller.ts services/messaging-service/src/controllers/

cp -r ../jibbr-backend/src/routes/message.route.ts services/messaging-service/src/routes/
cp -r ../jibbr-backend/src/routes/channel.route.ts services/messaging-service/src/routes/
cp -r ../jibbr-backend/src/routes/conversation.route.ts services/messaging-service/src/routes/
cp -r ../jibbr-backend/src/routes/workspace.route.ts services/messaging-service/src/routes/
cp -r ../jibbr-backend/src/routes/user.route.ts services/messaging-service/src/routes/
cp -r ../jibbr-backend/src/routes/notification.route.ts services/messaging-service/src/routes/
cp -r ../jibbr-backend/src/routes/presence.route.ts services/messaging-service/src/routes/

# Copy WebSocket
cp -r ../jibbr-backend/src/websocket services/messaging-service/src/

# Copy services
cp -r ../jibbr-backend/src/services services/messaging-service/src/

# Copy validation
cp -r ../jibbr-backend/src/validation/message.validations.ts services/messaging-service/src/validation/
cp -r ../jibbr-backend/src/validation/workspace.validations.ts services/messaging-service/src/validation/

# Copy helper (or move shared parts)
cp ../jibbr-backend/src/helper.ts services/messaging-service/src/
```

### Step 5: Update Imports

All services need to update imports to use shared packages:

**Before:**
```typescript
import authMiddleware from '../middleware/Auth.middleware.js';
```

**After:**
```typescript
import { authMiddleware } from '@jibbr/auth-middleware';
```

**Before:**
```typescript
import { formatError } from '../helper.js';
```

**After (if moved to shared-utils):**
```typescript
import { formatError } from '@jibbr/shared-utils';
```

### Step 6: Update Database References

Since User model is in auth-service, messaging-service should:
- Remove User foreign key constraints
- Use userId as String (already done in schema)
- Call auth-service API to verify users when needed

### Step 7: Set Up Environment Variables

Create `.env` files for each service based on `.env.example` files.

### Step 8: Build and Test

```bash
# Build all packages
npm run build

# Start infrastructure
docker-compose up -d

# Run database migrations
cd services/auth-service && npx prisma migrate dev
cd ../messaging-service && npx prisma migrate dev

# Start services
npm run dev:all
```

## Important Notes

1. **User Model**: Users are only in auth-service. Messaging-service references users by ID only.

2. **Inter-Service Communication**: Messaging-service may need to call auth-service to verify users. Use `@jibbr/shared-utils` HttpClient.

3. **Shared Code**: Move common utilities to `@jibbr/shared-utils` package.

4. **JWT Secret**: Must be the same across all services.

5. **Ports**: 
   - Auth: 3001
   - Upload: 3002
   - Messaging: 3003

## Testing Migration

1. Test auth endpoints: Register, login, verify
2. Test upload endpoints: Upload files
3. Test messaging: Send messages, WebSocket connections
4. Test inter-service communication

## Rollback Plan

Keep original services running until new Turborepo setup is fully tested and deployed.

