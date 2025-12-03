# Jibbr Microservices Monorepo

A Turborepo monorepo containing microservices for the Jibbr application.

## Services

- **auth-service** - Authentication & authorization
- **upload-service** - File upload & storage
- **messaging-service** - Real-time messaging with WebSockets

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
```

## Development

Each service runs independently and can be developed/deployed separately.

### Service Ports

- Auth Service: `http://localhost:3001`
- Upload Service: `http://localhost:3002`
- Messaging Service: `http://localhost:3003`

## Project Structure

```
jibbr-turbo-repo/
├── services/          # Microservices
├── packages/          # Shared packages
└── apps/              # Applications (optional)
```

## Environment Variables

Copy `.env.example` to `.env` and configure your environment variables.

Each service has its own `.env.example` file with service-specific variables.

## Documentation

See `MICROSERVICES_TURBOREPO_SETUP.md` for detailed setup and architecture guide.

