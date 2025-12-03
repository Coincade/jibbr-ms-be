# Next Steps - Setup Guide

## ✅ Completed

1. ✅ All code files migrated
2. ✅ Middleware files created
3. ✅ Database config files created
4. ✅ Prisma schemas created
5. ✅ Package.json files updated with dependencies

## 📋 Required Next Steps

### 1. Create Environment Files

Create `.env` files in each service directory (they're gitignored, so create manually):

**`services/auth-service/.env`:**
```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/jibbr?schema=public
JWT_SECRET=your-super-secret-jwt-key-change-in-production
APP_URL=http://localhost:3001
CLIENT_APP_URL=http://localhost:3000
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
FROM_EMAIL=noreply@jibbr.com
GMAIL_HOST=smtp.gmail.com
GMAIL_USER=your-gmail@gmail.com
GMAIL_PASS=your-gmail-app-password
REDIS_URL=redis://localhost:6379
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
DELETE_PASS=your-admin-delete-password
```

**`services/upload-service/.env`:**
```env
PORT=3002
NODE_ENV=development
JWT_SECRET=your-super-secret-jwt-key-change-in-production
DO_SPACES_KEY=your-do-spaces-key
DO_SPACES_SECRET=your-do-spaces-secret
DO_SPACES_BUCKET=your-bucket-name
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

**`services/messaging-service/.env`:**
```env
PORT=3003
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/jibbr?schema=public
JWT_SECRET=your-super-secret-jwt-key-change-in-production
REDIS_URL=redis://localhost:6379
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
MENTION_CHANNEL_ENABLED=true
MENTION_EVERYONE_ENABLED=true
MENTION_CHANNEL_MAX_TOKENS=1
MENTION_CHANNEL_RATE_WINDOW_SEC=120
DELETE_PASS=your-admin-delete-password
EXPO_ACCESS_TOKEN=your-expo-access-token
```

### 2. Install Dependencies

```bash
# From root directory
npm install
```

This will install all dependencies for all services and packages.

### 3. Generate Prisma Clients

```bash
# Generate Prisma client for auth-service
npm run db:generate --workspace=auth-service

# Generate Prisma client for messaging-service
npm run db:generate --workspace=messaging-service
```

### 4. Run Database Migrations

**Important:** Since both services share the same database, you only need to run migrations once. Run from messaging-service (it has the full schema):

```bash
# Run migrations from messaging-service
npm run db:migrate --workspace=messaging-service
```

The auth-service schema only has the User model, so it won't conflict.

### 5. Start Services

```bash
# Start all services in development mode
npm run dev

# Or start individual services:
npm run dev:auth      # Auth service only
npm run dev:upload    # Upload service only
npm run dev:messaging # Messaging service only
```

### 6. Verify Services

- **Auth Service**: http://localhost:3001/health
- **Upload Service**: http://localhost:3002/health
- **Messaging Service**: http://localhost:3003/health

## 🔧 Important Notes

### Database Strategy

Both `auth-service` and `messaging-service` use the **same database** but have different Prisma schemas:
- **auth-service**: Only User model (owns user management)
- **messaging-service**: Full schema including User (for relations)

This is a **shared database** approach. The User model is managed by auth-service, but messaging-service needs it for relations.

### JWT Secret

**CRITICAL**: The `JWT_SECRET` must be **identical** across all services. If they differ, authentication will fail.

### Redis

Both auth-service (for email queue) and messaging-service (for WebSocket scaling) use Redis. Make sure Redis is running:

```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or using local Redis
redis-server
```

### Prisma Client Output

The Prisma schemas are configured to output clients to `../node_modules/.prisma/client` to avoid conflicts. This is normal.

## 🐛 Troubleshooting

### Prisma Client Not Found

If you get "Prisma Client not found" errors:
```bash
npm run db:generate --workspace=auth-service
npm run db:generate --workspace=messaging-service
```

### TypeScript Errors

If you see TypeScript errors:
1. Make sure all dependencies are installed: `npm install`
2. Generate Prisma clients (step 3 above)
3. Check that all imports are correct

### Database Connection Errors

1. Verify PostgreSQL is running
2. Check `DATABASE_URL` in `.env` files
3. Ensure database exists: `createdb jibbr` (if using PostgreSQL)

### Port Already in Use

If ports 3001, 3002, or 3003 are in use:
- Change `PORT` in respective `.env` files
- Or stop the process using those ports

## 📚 Additional Resources

- See `MIGRATION_SUMMARY.md` for migration details
- See `SETUP.md` for Turborepo setup
- See individual service READMEs for service-specific docs

