# Environment Variables Guide

This document maps all environment variables to their usage across services.

## 📋 Variable Mapping

### **Auth Service** (`services/auth-service/.env`)

Required variables:
```env
PORT=3001
APP_URL=http://localhost:3001
# For production, use your deployed website URL:
CLIENT_APP_URL=https://jibbr-website.vercel.app
# For local development:
# CLIENT_APP_URL=http://localhost:3000
JWT_SECRET=your-super-secret-jwt-key
DATABASE_URL=postgresql://user:password@host:port/database
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
FROM_EMAIL=noreply@jibbr.com
GMAIL_HOST=smtp.gmail.com
GMAIL_USER=your-gmail@gmail.com
GMAIL_PASS=your-gmail-app-password
REDIS_URL=redis://localhost:6379
# OR use separate Redis config:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
DELETE_PASS=your-admin-delete-password
```

**Usage:**
- `PORT` - Service port (default: 3001)
- `APP_URL` - Base URL for email verification links
- `CLIENT_APP_URL` - Frontend URL for redirects (password reset, email verification links). **IMPORTANT:** Set this to your deployed website URL in production (e.g., `https://jibbr-website.vercel.app`)
- `JWT_SECRET` - JWT token signing secret
- `DATABASE_URL` - PostgreSQL connection string
- `SMTP_USER`, `SMTP_PASSWORD` - SMTP credentials (Brevo/SendGrid)
- `FROM_EMAIL` - Sender email address
- `GMAIL_HOST`, `GMAIL_USER`, `GMAIL_PASS` - Gmail SMTP fallback
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` - Redis for email queue
- `DELETE_PASS` - Admin password for user deletion

---

### **Upload Service** (`services/upload-service/.env`)

Required variables:
```env
PORT=3002
JWT_SECRET=your-super-secret-jwt-key
DO_SPACES_KEY=your-digital-ocean-spaces-key
DO_SPACES_SECRET=your-digital-ocean-spaces-secret
DO_SPACES_BUCKET=your-bucket-name
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
```

**Usage:**
- `PORT` - Service port (default: 3002)
- `JWT_SECRET` - JWT token validation
- `DO_SPACES_*` - Digital Ocean Spaces configuration for file storage

---

### **Messaging Service** (`services/messaging-service/.env`)

Required variables:
```env
PORT=3003
JWT_SECRET=your-super-secret-jwt-key
DATABASE_URL=postgresql://user:password@host:port/database
REDIS_URL=redis://localhost:6379
# OR use separate Redis config:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
DO_SPACES_KEY=your-digital-ocean-spaces-key
DO_SPACES_SECRET=your-digital-ocean-spaces-secret
DO_SPACES_BUCKET=your-bucket-name
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
DELETE_PASS=your-admin-delete-password
EXPO_ACCESS_TOKEN=your-expo-access-token
EXPO_PUBLIC_API_URL=http://localhost:3003
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

**Usage:**
- `PORT` - Service port (default: 3003)
- `JWT_SECRET` - JWT token validation
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` - Redis for Socket.IO adapter
- `DO_SPACES_*` - Digital Ocean Spaces for message attachments
- `DELETE_PASS` - Admin password for workspace/channel deletion
- `EXPO_ACCESS_TOKEN` - Expo push notification service token
- `EXPO_PUBLIC_API_URL` - Public API URL for Expo notifications
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)

---

### **Socket Service** (`services/socket-service/.env`)

Required variables:
```env
PORT=3004
REDIS_URL=redis://localhost:6379
# OR use separate Redis config:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Valkey Streams (optional overrides)
STREAMS_GROUP=socket-service-group
STREAMS_CONSUMER=socket-1
STREAMS_DEDUPE_TTL_SECONDS=86400
STREAMS_CLAIM_IDLE_MS=60000
STREAMS_READ_COUNT=20
STREAMS_BLOCK_MS=5000
```

**Usage:**
- `PORT` - Service port (default: 3004)
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` - Redis for Socket.IO adapter + Streams
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)
- `STREAMS_*` - Tuning for Valkey Streams consumer behavior

---

## 🔧 Setup Options

### Option 1: Individual Service `.env` Files (Recommended)

Create separate `.env` files in each service directory:

```bash
# Copy your root .env to each service
cp .env services/auth-service/.env
cp .env services/upload-service/.env
cp .env services/messaging-service/.env
```

Then remove unused variables from each file.

### Option 2: Root `.env` with Service-Specific Overrides

Keep a root `.env` file and create service-specific `.env` files that only contain service-specific variables. The services will load their local `.env` first, then fall back to root if needed.

### Option 3: Single Root `.env` (Not Recommended)

If you want to use a single root `.env` file, you'll need to modify each service's `index.ts` to load from the root:

```typescript
// In each service's index.ts
const envPath = path.join(__dirname, '../../.env'); // Go up to root
dotenv.config({ path: envPath });
```

---

## ✅ Quick Setup Script

Create a PowerShell script to copy your root `.env` to all services:

```powershell
# setup-env.ps1
$rootEnv = ".env"
$services = @("auth-service", "upload-service", "messaging-service")

foreach ($service in $services) {
    $target = "services\$service\.env"
    if (Test-Path $rootEnv) {
        Copy-Item $rootEnv $target -Force
        Write-Host "✅ Copied .env to $target" -ForegroundColor Green
    } else {
        Write-Host "❌ Root .env not found!" -ForegroundColor Red
    }
}
```

Run: `.\setup-env.ps1`

---

## 🔍 Variable Checklist

Use this checklist to ensure all required variables are set:

### Auth Service
- [ ] `PORT`
- [ ] `APP_URL`
- [ ] `CLIENT_APP_URL`
- [ ] `JWT_SECRET`
- [ ] `DATABASE_URL`
- [ ] `SMTP_USER`
- [ ] `SMTP_PASSWORD`
- [ ] `FROM_EMAIL`
- [ ] `GMAIL_HOST` (optional, for fallback)
- [ ] `GMAIL_USER` (optional, for fallback)
- [ ] `GMAIL_PASS` (optional, for fallback)
- [ ] `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
- [ ] `DELETE_PASS`

### Upload Service
- [ ] `PORT`
- [ ] `JWT_SECRET`
- [ ] `DO_SPACES_KEY`
- [ ] `DO_SPACES_SECRET`
- [ ] `DO_SPACES_BUCKET`
- [ ] `DO_SPACES_ENDPOINT`

### Messaging Service
- [ ] `PORT`
- [ ] `JWT_SECRET`
- [ ] `DATABASE_URL`
- [ ] `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
- [ ] `DO_SPACES_KEY`
- [ ] `DO_SPACES_SECRET`
- [ ] `DO_SPACES_BUCKET`
- [ ] `DO_SPACES_ENDPOINT`
- [ ] `DELETE_PASS`
- [ ] `EXPO_ACCESS_TOKEN`
- [ ] `EXPO_PUBLIC_API_URL`
- [ ] `ALLOWED_ORIGINS`

---

## 🚨 Common Issues

### Redis Connection Errors
If you see `ECONNREFUSED` errors for Redis:
1. Check if Redis is running: `docker-compose up -d redis`
2. Verify `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` are correct
3. Check if `REDIS_PASSWORD` is required

### Missing Environment Variables
If a service fails to start:
1. Check the service's `.env` file exists
2. Verify all required variables are set
3. Check for typos in variable names
4. Ensure no extra spaces around `=` in `.env` file

### Database Connection Issues
1. Verify `DATABASE_URL` format: `postgresql://user:password@host:port/database`
2. Check database is accessible
3. Ensure SSL mode if required: `?sslmode=require`

---

## 📝 Notes

- All `.env` files are gitignored by default
- Never commit `.env` files to version control
- Use `.env.example` files as templates (without sensitive data)
- In production, use environment variable management (AWS Secrets Manager, Vercel env vars, etc.)

