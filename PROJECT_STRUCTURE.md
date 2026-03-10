# Project Structure Overview

Complete breakdown of the TelestackSEC project structure and what each file does.

---

## Root Level Files

```
TelestackSEC/
├── DESIGN.md              # Complete design document with architecture
├── README.md              # User-facing documentation and quick start
├── SETUP.md               # Detailed setup and installation guide
├── package.json           # Project dependencies and scripts
├── tsconfig.json          # TypeScript compilation settings
├── jest.config.js         # Jest testing configuration
├── .env                   # Development environment variables
├── .env.example           # Example environment variables template
├── .gitignore             # Git ignore patterns
```

---

## Source Code (`/src`)

### Main Entry Point

```
src/
├── index.ts               # Main TelestackSEC class - exported public API
│   
│   Exports:
│   - TelestackSEC (main class)
│   - User management API (signal.user.*)
│   - Messaging API (signal.encrypt/decrypt)
│   - Session management API (signal.session.*)
│   - Admin API (signal.admin.*)
│   - Group messaging API (signal.group.*)
│   - Encrypted calls API (signal.call.*)
│   - All types and error codes
```

### Types (`/src/types`)

```
src/types/
├── index.ts               # All TypeScript interfaces and enums
│
│   Defines:
│   - TelestackSECConfig (SDK initialization options)
│   - EncryptOptions, EncryptResponse
│   - DecryptOptions, DecryptResponse
│   - UserRegisterResponse, UserInfo
│   - SessionStatus, SessionListResponse
│   - HealthStatus, AdminPrekeyRotationResponse
│   - SignalError, SignalErrorCode enum
```

### Cryptography (`/src/crypto`)

```
src/crypto/
├── crypto-manager.ts      # Master key encryption/decryption
│   - AES-256-GCM encryption for data at rest
│   - Master key validation and derivation
│   - Encrypt/decrypt sensitive keys
│
├── signal-protocol.ts     # libsignal wrapper
│   - Key generation (identity, prekeys, signed prekeys)
│   - X3DH key agreement implementation
│   - Double Ratchet encryption/decryption
│   - Message encryption/decryption
│   - Session establishment
```

### Database (`/src/db`)

```
src/db/
├── database-service.ts    # Prisma ORM wrapper
│   
│   User operations:
│   - createUser, getUserById, deleteUser
│   
│   Identity key operations:
│   - storeIdentityKey, getIdentityKey
│   
│   PreKey operations:
│   - storePreKeys, getUnusedPreKey
│   - markPreKeyAsUsed, deleteUsedPreKeys
│   
│   Session operations:
│   - storeSession, getSession, deleteSession
│   - getUserSessions
│   
│   Group operations:
│   - createGroup, getGroup, addGroupMembers
│   - storeGroupMessage
│   
│   Call operations:
│   - createCall, updateCallStatus
│   - getCallById
│
│   Admin:
│   - healthCheck, disconnect
```

### Relay Hub (`/src/relay`)

```
src/relay/
├── hub.ts                 # Real-time WebSocket Relay Server
│   - Connects users, authenticated push notifications
│   - Emits instant messages directly to SDK listeners
```

### Services (`/src/services`)

```
src/services/
├── user-service.ts        # User management logic
│   - register(email)
│   - getUser(userId)
│   - getPublicKey(userId)
│   - deleteUser(userId)
│   - rotatePreKeysIfNeeded(userId)
│   - Internal: getIdentityKeyPair()
│
├── messaging-service.ts   # Encryption/decryption logic
│   - encrypt(from, to, message)
│   - decrypt(to, ciphertext, sessionId)
│   - Private: establishSession() - X3DH negotiation
│
├── session-service.ts     # Session management
│   - getStatus(userId1, userId2)
│   - listUserSessions(userId)
│   - resetSession(userId1, userId2)
│
├── group-service.ts       # Group Messaging via Sender Keys
│   - createGroup, addMembers
│   - generateAndDistributeSenderKey
│   - sendGroupMessage, receiveGroupMessage
│
├── call-service.ts        # Encrypted Calls
│   - initiateCall, answerCall, handleIceCandidate
│   - encryptFrame, decryptFrame (AES-CTR)
│
├── admin-service.ts       # Admin/maintenance operations
│   - health() - Database health check
│   - rotatePrekeys(userId) - Force prekey rotation
│   - getDiagnostics() - Full diagnostics
│
└── index.ts              # Export all services
```

---

## Prisma (`/prisma`)

```
prisma/
├── schema.prisma          # Database schema definition
│
│   Tables:
│   - User (users table)
│   - IdentityKey (identity_keys table)
│   - PreKey (prekeys table)
│   - Session (sessions table)
│   - Message (messages table)
│
│   Relationships:
│   - User 1-to-1 IdentityKey
│   - User 1-to-many PreKey
│   - User many-to-many Session
│   - User many-to-many Message
```

---

## Examples (`/examples`)

```
examples/
├── basic.ts               # Complete encrypt/decrypt flow demo
│   Shows:
│   - Initialize SDK
│   - Register users
│   - Encrypt message
│   - Decrypt message
│   - Health check
│
├── express-api.ts         # REST API example
│   Endpoints:
│   - POST   /users/register - Register user
│   - DELETE /users/:userId - Delete user
│   - POST   /messages/encrypt - Encrypt message
│   - POST   /messages/decrypt - Decrypt message
│   - GET    /sessions/:userId - List sessions
│   - DELETE /sessions/:id - Reset session
│   - GET    /admin/health - Health check
```

---

## Data Flow

### User Registration
```
register(email)
    ↓
User created in DB
    ↓
Generate identity key pair
    ↓
Encrypt private key with master key
    ↓
Store encrypted identity key
    ↓
Generate 50 prekeys
    ↓
Encrypt prekey private keys
    ↓
Store prekeys
    ↓
Return user with public key
```

### Message Encryption
```
encrypt(from, to, message)
    ↓
Check if session exists
    ↓
If NO:
  - Get recipient's public keys
  - Generate ephemeral key
  - Get recipient's prekey
  - Run X3DH key agreement
  - Create session
    ↓
Load session from DB
    ↓
Decrypt session state
    ↓
Use Double Ratchet to encrypt message
    ↓
Update session state in DB
    ↓
Store message in history
    ↓
Return ciphertext + sessionId
```

### Message Decryption
```
decrypt(to, ciphertext, sessionId)
    ↓
Get session from DB
    ↓
Decrypt session state
    ↓
Use Double Ratchet to decrypt
    ↓
Update session state in DB
    ↓
Return plaintext message + sender info
```

---

## File Size Reference

```
Typical file sizes after build:

src/index.ts                    ~8KB
src/services/*.ts              ~20KB total
src/crypto/*.ts                ~15KB total
src/db/database-service.ts     ~12KB
src/types/index.ts             ~4KB

dist/ (compiled)               ~80KB
node_modules/                  ~500MB+ (dependencies)
```

---

## Import Map

```typescript
// Main SDK class
import { TelestackSEC } from './src'

// Types
import { 
  TelestackSECConfig,
  EncryptOptions,
  EncryptResponse,
  SignalError,
  SignalErrorCode,
  // ... all types
} from './src'

// Individual services (usually not needed)
import { UserService } from './src/services'
import { MessagingService } from './src/services'
import { DatabaseService } from './src/db'
import { CryptoManager } from './src/crypto'
```

---

## Configuration Files Explained

### `tsconfig.json`
- Compiles TypeScript to ES2020 JavaScript
- Strict mode enabled for type safety
- Output to `dist/` directory
- Source maps for debugging

### `package.json`
- Lists all dependencies (production)
- Lists dev dependencies (testing, build)
- Defines scripts for build, dev, test
- Defines library exports

### `.env`
- Local development configuration
- Database URL
- Master encryption key
- Optional settings

### `jest.config.js`
- Testing configuration
- Uses ts-jest for TypeScript
- Coverage thresholds
- Test file patterns

---

## Build Output

After running `npm run build`:

```
dist/
├── index.js                   # Main SDK class (compiled)
├── index.d.ts                 # TypeScript definitions
├── types/
│   ├── index.js
│   └── index.d.ts
├── crypto/
│   ├── crypto-manager.js
│   ├── crypto-manager.d.ts
│   ├── signal-protocol.js
│   └── signal-protocol.d.ts
├── db/
│   ├── database-service.js
│   └── database-service.d.ts
└── services/
    ├── user-service.js
    ├── messaging-service.js
    ├── session-service.js
    ├── admin-service.js
    ├── index.js
    └── *.d.ts (all type definitions)
```

Files ending in `.d.ts` are TypeScript type definitions, allowing users to have full IDE autocomplete.

---

## Development vs Production

### Development
- Source files in `src/`
- TypeScript with strict type checking
- Source maps for debugging
- Nodemon watch mode

### Production
- Compiled files in `dist/`
- Regular JavaScript
- Optimized and minified
- No source maps
- No dev dependencies

To prepare for production:
```bash
npm run build
rm -rf node_modules
npm ci --omit=dev
```

---

## Key Concepts

### Single Responsibility
- Each file handles one kind of responsibility
- Services coordinate between layers
- Clean separation of concerns

### Type Safety
- Strict TypeScript with no-any rule
- All interfaces exported
- IDE autocomplete support

### Error Handling
- Custom SignalError class
- Specific error codes for each failure
- Proper error propagation

### Security
- Master key encryption for stored keys
- AES-256-GCM for at-rest encryption
- libsignal for all cryptography
- No secrets in logs

---

## Adding Features

### To add a new feature:

1. **Define types** → `src/types/index.ts`
2. **Implement logic** → Create service or add to existing
3. **Add database operations** → `src/db/database-service.ts` (if needed)
4. **Add to SDK** → Expose in `src/index.ts` public API
5. **Add example** → Create in `examples/`
6. **Add tests** → Create in `src/__tests__/`

---

That's the complete project structure! 🏗️


