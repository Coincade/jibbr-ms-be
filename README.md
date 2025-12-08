# Jibbr Microservices Monorepo

A Turborepo monorepo containing microservices for the Jibbr application.

## Services

- **auth-service** - Authentication & authorization
- **upload-service** - File upload & storage
- **messaging-service** - REST API for messaging operations
- **socket-service** - Real-time WebSocket service for live messaging

## Quick Start

```bash
# Install dependencies
npm install

# Start all services in development mode
npm run dev:all

# Start specific service
npm run dev:auth
npm run dev:upload
npm run dev:messaging

# Build all services
npm run build

# Run tests
npm run test

# Database operations
npm run db:generate
npm run db:migrate
```

## Development

Each service runs independently and can be developed/deployed separately.

### Service Ports

- Auth Service: `http://localhost:3001`
- Upload Service: `http://localhost:3002`
- Messaging Service: `http://localhost:3003`
- Socket Service: `http://localhost:3004` (WebSocket: `ws://localhost:3004`)

## Project Structure

```
jibbr-turbo-repo/
├── services/          # Microservices
│   ├── auth-service/
│   ├── upload-service/
│   ├── messaging-service/
│   └── socket-service/
├── packages/          # Shared packages
│   ├── auth-middleware/
│   ├── database/
│   ├── logger/
│   ├── shared-types/
│   └── shared-utils/
└── apps/              # Applications (optional)
```

## Shared Packages

- **@jibbr/auth-middleware** - Authentication middleware
- **@jibbr/database** - Prisma database client and schema
- **@jibbr/logger** - Shared logging utility
- **@jibbr/shared-types** - Shared TypeScript types
- **@jibbr/shared-utils** - Shared utility functions

## Environment Variables

Each service has its own `.env` file with service-specific variables. See `ENV_VARIABLES.md` for detailed environment variable documentation.

## Documentation

- `SETUP.md` - Detailed setup and architecture guide
- `ENV_VARIABLES.md` - Environment variables documentation
- `MIGRATION_GUIDE.md` - Migration guide for existing projects

