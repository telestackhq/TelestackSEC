# TelestackSEC - Setup Guide

Complete step-by-step guide to set up and run the TelestackSEC.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Database Setup](#database-setup)
4. [Environment Configuration](#environment-configuration)
5. [Build & Development](#build--development)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** 16+ ([Download](https://nodejs.org/))
- **npm** 7+ or **yarn** 1.22+
- **PostgreSQL** 12+ ([Download](https://www.postgresql.org/))
- **Git** (optional)

Verify installations:

```bash
node --version      # v16.0.0 or higher
npm --version       # 7.0.0 or higher
psql --version      # psql (PostgreSQL) 12.0 or higher
```

---

## Installation

### Step 1: Clone/Download Project

```bash
# If using git
git clone <repository-url>
cd TelestackSEC

# Or just download and extract the folder
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install:
- TypeScript
- Prisma ORM
- libsignal (cryptography library)
- Express (if using examples)
- Dev dependencies

---

## Database Setup

### Step 1: Create Database

Using PostgreSQL CLI:

```bash
# Create database user (optional)
createuser signal_user -P  # Enter password when prompted

# Create database
createdb -O signal_user signal_sdk_db
```

Or using pgAdmin GUI (if installed).

### Step 2: Configure Connection

Update `.env` file:

```env
DATABASE_URL="postgresql://signal_user:your_password@localhost:5432/signal_sdk_db"
```

Or if using default postgres user:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/signal_sdk_db"
```

### Step 3: Run Migrations

The SDK will auto-create tables on first initialization, or run manually:

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# View database (optional)
npm run prisma:studio
```

### Step 4: Verify Connection

```bash
psql $DATABASE_URL -l  # List databases
psql $DATABASE_URL -c "SELECT version();"  # Check connection
```

---

## Environment Configuration

### Step 1: Copy Environment Template

```bash
cp .env.example .env
```

### Step 2: Update Required Variables

Edit `.env`:

```env
# Database (required)
DATABASE_URL="postgresql://user:password@localhost:5432/signal_sdk_db"

# Master encryption key (required)
# Must be at least 16 characters, 32+ recommended
MASTER_KEY="your-super-secret-key-here-min-32-chars"

# Optional configuration
LOG_LEVEL="info"           # debug, info, warn, error
MAX_PREKEYS=50             # Max prekeys per user
PREKEYS_THRESHOLD=20       # Regenerate when below
SESSION_EXPIRY_DAYS=90     # null = infinite

# Relay Hub (Required for Real-Time production)
RELAY_API_SECRET="your-secure-relay-secret-for-production"

```

### Step 3: Validate Configuration

```bash
# Test database connection
npm run test:db-connection

# Check master key format
npm run validate:config
```

---

## Build & Development

### Development Mode

```bash
# Watch mode - auto-recompile on changes
npm run dev

# In another terminal, run examples
npm run example:basic
```

### Production Build

```bash
# Compile TypeScript to JavaScript
npm run build

# Output goes to ./dist directory
# Use dist/index.js in production
```

### Verify Build

```bash
# Check build output
ls -la dist/

# Test import
node -e "const { TelestackSEC } = require('./dist/index'); console.log('✓ Build OK')"
```

---

## Testing

### Run All Tests

```bash
npm test
```

### Watch Mode

```bash
npm run test:watch
```

### Coverage Report

```bash
npm test -- --coverage
```

---

## Quick Start Example

### 1. Build the SDK

```bash
npm run build
```

### 2. Create a Test Script (`test-sdk.js`)

```javascript
const { TelestackSEC } = require('./dist/index');

async function test() {
  const signal = new TelestackSEC({
    databaseUrl: process.env.DATABASE_URL,
    masterKey: process.env.MASTER_KEY,
  });

  await signal.initialize();

  const alice = await signal.user.register('alice@test.com');
  const bob = await signal.user.register('bob@test.com');

  const encrypted = await signal.encrypt({
    from: alice.userId,
    to: bob.userId,
    message: 'Hello Bob!',
  });

  const decrypted = await signal.decrypt({
    to: bob.userId,
    ciphertext: encrypted.ciphertext,
    sessionId: encrypted.sessionId,
  });

  console.log('Message:', decrypted.message);
  await signal.disconnect();
}

test().catch(console.error);
```

### 3. Run Test Script

```bash
NODE_OPTIONS="--require dotenv/config" node test-sdk.js
```

---

## Deployment

### Prepare for Production

```bash
# 1. Build
npm run build

# 2. Remove dev dependencies
npm ci --omit=dev  # Or: npm ci --production

# 3. Set production environment
export NODE_ENV=production

# 4. Set database URL, master key, and relay secret via environment
export DATABASE_URL="production-db-url"
export MASTER_KEY="production-master-key"
export RELAY_API_SECRET="production-relay-secret"

```

### Use with Express.js

```bash
npm install express

# Build the provided example
npm run build

# Run Express server
node -r dotenv/config dist/examples/express-api.js
```

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY node_modules ./node_modules

EXPOSE 3000

CMD ["node", "-r", "dotenv/config", "dist/examples/express-api.js"]
```

Build and run:

```bash
npm run build
docker build -t TelestackSEC .
docker run -p 3000:3000 --env-file .env TelestackSEC
```

---

## Project Structure

```
TelestackSEC/
├── src/
│   ├── index.ts              # Main SDK class
│   ├── types/                # TypeScript interfaces
│   │   └── index.ts
│   ├── crypto/               # Encryption logic
│   │   ├── crypto-manager.ts
│   │   └── signal-protocol.ts
│   ├── db/                   # Database layer
│   │   └── database-service.ts
│   └── services/             # Business logic
│       ├── user-service.ts
│       ├── messaging-service.ts
│       ├── session-service.ts
│       ├── admin-service.ts
│       └── index.ts
├── prisma/
│   └── schema.prisma         # Database schema
├── examples/
│   ├── basic.ts
│   └── express-api.ts
├── dist/                     # Compiled output (after build)
├── package.json
├── tsconfig.json
├── .env                      # Environment variables
└── README.md
```

---

## Troubleshooting

### "Cannot find module '@prisma/client'"

```bash
npm install
npm run prisma:generate
```

### "Failed to connect to database"

1. Check PostgreSQL is running:
   ```bash
   sudo service postgresql status    # Linux
   brew services list | grep postgres # macOS
   ```

2. Verify connection string:
   ```bash
   psql $DATABASE_URL
   ```

3. Create database if missing:
   ```bash
   createdb signal_sdk_db
   ```

### "Master key must be at least 16 characters"

Update `.env` with longer key:

```env
MASTER_KEY="at-least-16-chars-preferably-32-or-more"
```

### TypeScript compilation errors

```bash
# Check TypeScript version
npx tsc --version

# Ensure tsconfig is correct
npm run build

# Clear cache and rebuild
rm -rf dist node_modules/.cache
npm run build
```

### Port already in use (when running examples)

Change port in code or use:

```bash
PORT=3001 node script.js
```

### libsignal build issues

```bash
# Ensure build tools installed
# macOS:
xcode-select --install

# Ubuntu:
sudo apt-get install build-essential python3

# Then reinstall
npm ci
npm run prisma:generate
```

---

## Success Checklist

- [x] Node.js and npm installed
- [x] PostgreSQL installed and running
- [x] Project dependencies installed (`npm install`)
- [x] Database created and configured
- [x] `.env` file configured with DATABASE_URL and MASTER_KEY
- [x] Prisma client generated (`npm run prisma:generate`)
- [x] Tests passing (`npm test`)
- [x] Build successful (`npm run build`)
- [x] Example runs without errors (`npm run example:basic`)

---

## Next Steps

1. **Read** [README.md](./README.md) for API documentation
2. **Explore** [examples/](./examples/) for usage patterns
3. **Review** [DESIGN.md](./DESIGN.md) for architecture details
4. **Start building** your encrypted messaging application!

---

## Support

For issues:

1. Check this troubleshooting guide
2. Review error messages carefully
3. Check [README.md](./README.md)
4. Open an issue on GitHub with:
   - Error message
   - Steps to reproduce
   - Environment (Node version, OS, etc)

---

**You're all set! 🚀 Start building secure applications.**


