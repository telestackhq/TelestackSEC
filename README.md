# TelestackSEC

Military-grade end-to-end encrypted messaging for any application. Just plug in your database URL and you're done.

## Features

✅ **Dead Simple API** - 3 lines to encrypt, 3 lines to decrypt  
✅ **Production Ready** - Uses official libsignal library  
✅ **Secure by Default** - All keys encrypted at rest  
✅ **Automatic Key Management** - Generates, rotates, stores securely  
✅ **Session Management** - Auto-established and maintained  
✅ **Forward Secrecy** - Ratcheting keys for all communications  
✅ **Group Messaging** - Highly efficient Sender Keys protocol
✅ **Encrypted Calls** - Audio/Video signaling and stream encryption
✅ **Real-Time Delivery** - Sub-millisecond WebSocket push notifications
✅ **Zero Configuration** - Just provide database URL and master key

---

## Quick Start

### 1. Install

```bash
npm install @telestack/telestacksec
```

### 2. Set Up Environment

Create a `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/signal_db"
MASTER_KEY="your-secure-master-key-min-32-chars"
```

**Important:** Load environment variables in your application before initializing TelestackSEC:

```typescript
import dotenv from 'dotenv';

// Load .env file (this is your responsibility, not handled by TelestackSEC)
dotenv.config();

import { TelestackSEC } from '@telestack/telestacksec';
// ... rest of code
```

Note: TelestackSEC does **not** call `dotenv.config()` internally. This follows library best practices and allows you to manage environment variables according to your application's needs (e.g., via Docker, CI/CD secrets, or environment injection).

### 3. Initialize

```typescript
import { TelestackSEC } from '@telestack/telestacksec';

const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,
  masterKey: process.env.MASTER_KEY,
});

// Initialize database connection
await signal.initialize();
```

**Important:** Create the SDK instance **once per application lifecycle** and reuse it. TelestackSEC internally manages a single Prisma Client connection to prevent database exhaustion ("too many connections" errors).

Recommended pattern:

```typescript
// app.ts - Create SDK once at startup
const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,
  masterKey: process.env.MASTER_KEY,
});
await signal.initialize();

// Export and reuse across your application
export { signal };

// In other modules:
import { signal } from './app';
const encrypted = await signal.encrypt({ from, to, message });

// On shutdown:
process.on('SIGTERM', async () => {
  await signal.disconnect();
  process.exit(0);
});
```

**Note:** Do **not** create a new `TelestackSEC` instance per request (e.g., in serverless functions or request handlers). This will exhaust database connections. Instead, use connection pooling at the database level or create the SDK at the application root and share it.

### 4. Register Users

```typescript
// User A registers
const alice = await signal.user.register('alice@example.com');
console.log('Alice ID:', alice.userId);

// User B registers
const bob = await signal.user.register('bob@example.com');
console.log('Bob ID:', bob.userId);
```

### 5. Encrypt & Decrypt

```typescript
// Alice sends encrypted message to Bob
const encrypted = await signal.encrypt({
  from: alice.userId,
  to: bob.userId,
  message: 'Secret message!',
});

console.log('Encrypted:', encrypted.ciphertext);
console.log('Session ID:', encrypted.sessionId);

// Bob receives and decrypts
const decrypted = await signal.decrypt({
  to: bob.userId,
  ciphertext: encrypted.ciphertext,
  sessionId: encrypted.sessionId,
});

console.log('Message:', decrypted.message); // "Secret message!"
console.log('From:', decrypted.from); // alice.userId
```

### 6. Real-Time Listening (WebSocket)

Configure `relayUrl` and `relayAuthKey` and listen for instant push notifications:

```typescript
// Bob listens for incoming E2EE messages in real-time
signal.on('message', (msg) => {
    console.log(`Received real-time message from ${msg.from}:`, msg.message);
});

await signal.listen(bob.userId);
```

---

## API Reference

### User Management

```typescript
// Register a new user
const user = await signal.user.register('email@example.com');
// {
//   userId: 'uuid',
//   email: 'email@example.com',
//   publicKey: 'base64...',
//   createdAt: Date
// }

// Delete a user
await signal.user.delete(userId);

// Get user's public key
const publicKey = await signal.user.getPublicKey(userId);
```

### Messaging

```typescript
// Encrypt message
const encrypted = await signal.encrypt({
  from: senderUserId,
  to: recipientUserId,
  message: 'Your message here',
});

// Decrypt message
const decrypted = await signal.decrypt({
  to: recipientUserId,
  ciphertext: encrypted.ciphertext,
  sessionId: encrypted.sessionId,
});
```

### Group Messaging

```typescript
// Create a new group
const group = await signal.group.createGroup({
    name: 'Secret Team',
    creatorId: alice.userId,
    memberIds: [bob.userId, charlie.userId]
});

// Send message to group
const msg = await signal.group.sendGroupMessage({
    groupId: group.groupId,
    senderId: alice.userId,
    message: 'Hello team!'
});

// Receive group message
const decryptedContent = await signal.group.receiveGroupMessage({
    groupId: group.groupId,
    senderId: alice.userId,
    recipientId: bob.userId,
    ciphertext: msg.ciphertext
});
```

### Encrypted Calls

```typescript
// Initiate an encrypted call (sends SDP offer)
const callOffer = await signal.call.initiateCall({
    callerId: alice.userId,
    calleeId: bob.userId,
    callType: 'VIDEO',
    sdpOffer: '...' // From your WebRTC RTCPeerConnection
});

// Answer a call
const answer = await signal.call.answerCall({
    callId: callOffer.callId,
    calleeId: bob.userId,
    sdpAnswer: '...' 
});

// Encrypt media streams using derived keys
const encryptedFrame = await signal.call.encryptFrame(
    callOffer.callId,
    Buffer.from('video-frame-data')
);


### Session Management

```typescript
// Get session status
const status = await signal.session.getStatus(userId1, userId2);

// List all sessions for a user
const sessions = await signal.session.list(userId);

// Reset/delete a session (forgets encryption state)
await signal.session.reset(userId1, userId2);
```

### Admin & Maintenance

```typescript
// Check system health
const health = await signal.admin.health();
// { status, database, timestamp, message }

// Rotate user's prekeys
const rotated = await signal.admin.rotatePrekeys(userId);
// { userId, newPrekeysGenerated, oldPrekeysRemoved, timestamp }

// Get full diagnostics
const diag = await signal.admin.getDiagnostics();
```

---

## Configuration

```typescript
const signal = new TelestackSEC({
  // Required
  databaseUrl: 'postgresql://...',

  // Optional (with defaults)
  masterKey: 'your-key',              // Required in env if not provided
  maxPrekeys: 50,                     // Number of prekeys to maintain
  prekeysThreshold: 20,               // Regenerate when below this
  messageHistoryEnabled: true,        // Store encrypted messages in DB
  sessionExpiryDays: 90,              // null = no expiry
  logLevel: 'info',                   // 'debug' | 'info' | 'warn' | 'error'
});
```

---

## Security Architecture

### How It Works

1. **Identity Keys** - Unique master secret per user (stored encrypted)
2. **PreKeys** - One-time keys for session initiation (auto-rotated)
3. **X3DH** - Key agreement protocol (ECDH-based)
4. **Double Ratchet** - Message encryption & key derivation per message
5. **Master Key Encryption** - All database keys encrypted at rest

### What's Secure

- ✅ Messages encrypted in transit
- ✅ Keys encrypted at rest (AES-256-GCM)
- ✅ Forward secrecy (old messages safe even if key stolen)
- ✅ Break-in recovery (compromised key doesn't leak old messages)
- ✅ Replay protection (can't replay old messages)
- ✅ Message authenticity (detects tampering)

---

## Database Setup

The SDK manages the database schema automatically using Prisma.

### Supported Databases

- PostgreSQL (recommended)
- MySQL (experimental)
- SQLite (development only)

### Manual Migration

```bash
# From SDK directory
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate
```

### Schema Overview

```
Users ──→ IdentityKeys (1-to-1)
   ├──→ PreKeys (1-to-many)
   ├──→ Sessions (many-to-many)
   └──→ Messages (many-to-many)
```

---

## Examples

### Express.js Integration

```typescript
import express from 'express';
import { TelestackSEC } from '@telestack/telestacksec';

const app = express();
const signal = new TelestackSEC({ databaseUrl: process.env.DATABASE_URL });

app.use(express.json());

// Initialize on startup
app.listen(3000, async () => {
  await signal.initialize();
});

// Send encrypted message
app.post('/messages', async (req, res) => {
  const { from, to, message } = req.body;

  try {
    const encrypted = await signal.encrypt({ from, to, message });
    res.json({ success: true, ...encrypted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Receive encrypted message
app.post('/messages/decrypt', async (req, res) => {
  const { to, ciphertext, sessionId } = req.body;

  try {
    const decrypted = await signal.decrypt({ to, ciphertext, sessionId });
    res.json(decrypted);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

### WebSocket Chat

```typescript
import { Server } from 'socket.io';
import { TelestackSEC } from '@telestack/telestacksec';

const io = new Server(server);
const signal = new TelestackSEC({ databaseUrl: process.env.DATABASE_URL });

await signal.initialize();

io.on('connection', (socket) => {
  // User sends encrypted message
  socket.on('message', async (data) => {
    const encrypted = await signal.encrypt(data);
    io.to(data.to).emit('message', encrypted);
  });

  // Receive and decrypt
  socket.on('receive', async (data) => {
    const decrypted = await signal.decrypt(data);
    console.log('Received:', decrypted.message);
  });
});
```

---

## Error Handling

```typescript
import { SignalError, SignalErrorCode } from '@telestack/telestacksec';

try {
  const encrypted = await signal.encrypt({ from, to, message });
} catch (error) {
  if (error instanceof SignalError) {
    switch (error.code) {
      case SignalErrorCode.USER_NOT_FOUND:
        console.log('User does not exist');
        break;
      case SignalErrorCode.SESSION_INIT_FAILED:
        console.log('Could not establish secure session');
        break;
      case SignalErrorCode.DECRYPTION_FAILED:
        console.log('Message corrupted or tampered');
        break;
      default:
        console.log('Error:', error.message);
    }
  }
}
```

---

## Best Practices

1. **Always call `initialize()`** before using the SDK
2. **Store master key securely** - Use environment variables or key vaults
3. **Rotate prekeys regularly** - SDK auto-rotates, but you can trigger manually
4. **Close connections on shutdown** - Call `await signal.disconnect()`
5. **Don't share userId** - Use it only internally; send public keys for auth
6. **Validate senders** - Verify user identity at application level
7. **Use HTTPS/WSS** - Encrypt transport layer too
8. **Monitor prekey availability** - Check health regularly

---

## Troubleshooting

### "Master key must be at least 32 characters"

Add a longer master key to `.env`:

```env
MASTER_KEY="your-very-secure-key-at-least-32-chars"
```

### "Failed to connect to database"

Check your `DATABASE_URL`:

```bash
# Test connection
psql $DATABASE_URL
```

### "No unused prekeys available"

Run prekey rotation:

```typescript
await signal.admin.rotatePrekeys(userId);
```

### "Session not found"

Session is deleted or expired. Request sender to establish a new session (just encrypt again).

---

## Performance

- **Latency**: 10-50ms per encrypt/decrypt (DB + crypto)
- **Throughput**: 1000+ messages/second (depends on DB)
- **Storage**: ~2KB per session, ~1KB per message

---

## License

MIT

---

## Support & Connect With Us

📧 Email: [hello@telestack.dev](mailto:hello@telestack.dev)

[![GitHub](https://img.shields.io/badge/GitHub-codeforgebyaravinth--dev-black?style=for-the-badge&logo=github)](https://github.com/codeforgebyaravinth-dev)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-BuildWithAravinth-blue?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/buildwitharavinth/)
[![X](https://img.shields.io/badge/X-TelestackCloud-black?style=for-the-badge&logo=twitter)](https://x.com/telestackcloud)

---

**Ready to add military-grade encryption to your app?** 🚀

```typescript
const signal = new TelestackSEC({ databaseUrl });
await signal.initialize();
```

That's it!


