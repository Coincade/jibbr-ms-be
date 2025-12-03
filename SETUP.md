# Setup Guide

## Prerequisites

- Node.js >= 18.0.0
- npm >= 7.0.0 (or pnpm/yarn)
- Docker & Docker Compose (for local databases)

## Initial Setup

### 1. Install Dependencies

```bash
cd jibbr-turbo-repo
npm install
```

This will install all dependencies for the root workspace and all packages/services.

### 2. Set Up Environment Variables

Create `.env` files for each service:

```bash
# Copy example files (you'll need to create these manually)
cp services/auth-service/.env.example services/auth-service/.env
cp services/upload-service/.env.example services/upload-service/.env
cp services/messaging-service/.env.example services/messaging-service/.env
```

Update the `.env` files with your actual values.

### 3. Start Local Infrastructure

Start PostgreSQL and Redis using Docker Compose:

```bash
docker-compose up -d
```

This will start:
- PostgreSQL for auth-service (port 5432)
- PostgreSQL for messaging-service (port 5433)
- Redis (port 6379)

### 4. Set Up Databases

```bash
# Generate Prisma client for auth-service
cd services/auth-service
npx prisma generate
npx prisma migrate dev --name init

# Generate Prisma client for messaging-service
cd ../messaging-service
npx prisma generate
npx prisma migrate dev --name init

# Return to root
cd ../..
```

### 5. Build Shared Packages

```bash
npm run build
```

This will build all shared packages first, then the services.

### 6. Start Development

```bash
# Start all services
npm run dev:all

# Or start individual services
npm run dev:auth
npm run dev:upload
npm run dev:messaging
```

## Service URLs

- Auth Service: http://localhost:3001
- Upload Service: http://localhost:3002
- Messaging Service: http://localhost:3003

## Health Checks

Test that services are running:

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

## Next Steps

1. Implement routes and controllers for each service
2. Set up Prisma schemas for databases
3. Add authentication logic
4. Implement file upload functionality
5. Set up Socket.IO for real-time messaging

## Troubleshooting

### Port Already in Use

If a port is already in use, update the `PORT` in the service's `.env` file.

### Database Connection Issues

Make sure Docker containers are running:
```bash
docker-compose ps
```

### Build Errors

Clear cache and rebuild:
```bash
npm run clean
npm run build
```

