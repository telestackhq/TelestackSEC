# TelestackSEC - Design Document

## 1. Overview

**What is this?**
A TypeScript library that makes it dead simple to add military-grade encrypted messaging to any application. Users just provide a database URL, and the SDK handles everything - key generation, encryption, decryption, and secure storage.

**Why?**
Developers shouldn't have to understand cryptography to build secure apps. This SDK abstracts all complexity away.

---

## 2. Quick Concept (For Non-Developers)

Think of it like this:
- **Without SDK**: You manually lock/unlock every message, manage keys manually = complexity + errors
- **With SDK**: You hand over a message → SDK locks it → sends it → recipient's SDK unlocks it. Automatic. Secure. Done.

The SDK keeps all secret keys in an encrypted database and uses battle-tested Signal Protocol for encryption.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
│                  (Express, Next.js, etc)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │      TelestackSEC (JavaScript)       │
        │  ┌──────────────────────────────┐  │
        │  │  Encrypt / Decrypt Methods   │  │◄── User calls these
        │  └──────────────────────────────┘  │
        │  ┌──────────────────────────────┐  │
        │  │  Session & Relays            │  │
        │  │  (Auto-handled WebSockets)   │  │
        │  └──────────────────────────────┘  │
        │  ┌──────────────────────────────┐  │
        │  │  Groups & Calls (Signaling)  │  │
        │  │  (Sender Keys + AES-CTR)     │  │
        │  └──────────────────────────────┘  │
        │  ┌──────────────────────────────┐  │
        │  │  Key Storage + Rotation      │  │
        │  │  (Auto-handled)              │  │
        │  └──────────────────────────────┘  │
        └────────────────────┬────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────┐
        │    libsignal (Official Library)    │
        │    [Cryptography + Protocol]       │
        └────────────────────┬────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────┐
        │       PostgreSQL Database          │
        │   [Encrypted Keys + Sessions]      │
        └────────────────────────────────────┘
```

---

## 4. Core Concepts

### Identity Key
- **What**: Unique master secret for each user
- **How it works**: Never leaves the database, proves who you are
- **Generated**: Automatically on first use

### Pre-Keys
- **What**: One-time keys used for new sessions
- **How it works**: Like getting new locks before each conversation
- **Generated**: Auto-rotated (50 available at all times)

### Session
- **What**: Encrypted conversation between 2 users
- **How it works**: Established once, then messages auto-encrypt/decrypt
- **Managed**: Completely automatic

---

## 5. API Design - Developer Friendly

### Initialize SDK

```typescript
import { TelestackSEC } from '@telestack/telestacksec';

const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,  // That's it!
});

// Optional: Custom master key (defaults to env var)
const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,
  masterKey: process.env.MASTER_KEY,
});
```

### User Setup (First Time)

```typescript
// User A registers and gets their identity
const userA = await signal.user.register('alice@example.com');
// Returns: { userId: 'alice-uuid', publicKey: '...' }

// User B does the same
const userB = await signal.user.register('bob@example.com');
```

### Encryption - Super Simple

```typescript
// Alice encrypts a message to Bob
const encrypted = await signal.encrypt({
  from: 'alice-uuid',
  to: 'bob-uuid',
  message: 'Hello Bob! This is secret.',
});
// Returns: { ciphertext: '...base64...', sessionId: '...' }

// Send this to Bob over any channel (network, file, etc)
```

### Decryption - Just as Simple

```typescript
// Bob receives and decrypts
const decrypted = await signal.decrypt({
  to: 'bob-uuid',
  ciphertext: encrypted.ciphertext,
  sessionId: encrypted.sessionId,
});
// Returns: { message: 'Hello Bob! This is secret.', from: 'alice-uuid' }
```

---

## 6. Full Example - Start to Finish

```typescript
import { TelestackSEC } from '@telestack/telestacksec';

// 1. Initialize
const signal = new TelestackSEC({
  databaseUrl: 'postgresql://user:pass@localhost/signals',
});

// 2. Register two users
const alice = await signal.user.register('alice@example.com');
const bob = await signal.user.register('bob@example.com');

// 3. Alice encrypts and sends message to Bob
const encrypted = await signal.encrypt({
  from: alice.userId,
  to: bob.userId,
  message: 'Secret message!',
});

// 4. Send encrypted message to Bob (via API, websocket, etc)
sendToClient(bob.userId, encrypted);

// 5. Bob receives and decrypts
const received = await signal.decrypt({
  to: bob.userId,
  ciphertext: encrypted.ciphertext,
  sessionId: encrypted.sessionId,
});

console.log(received.message); // "Secret message!"
console.log(received.from);    // alice.userId

// 6. Continue chatting (session auto-renewed each message)
const reply = await signal.encrypt({
  from: bob.userId,
  to: alice.userId,
  message: 'Got it! Still secure.',
});
```

---

## 7. Database Schema (PostgreSQL)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Identity Keys (encrypted)
CREATE TABLE identity_keys (
  user_id UUID PRIMARY KEY,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- PreKeys (encrypted)
CREATE TABLE prekeys (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sessions (one per user pair)
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_a_id UUID NOT NULL,
  user_b_id UUID NOT NULL,
  encrypted_state TEXT NOT NULL,
  last_message_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_a_id, user_b_id),
  FOREIGN KEY (user_a_id) REFERENCES users(id),
  FOREIGN KEY (user_b_id) REFERENCES users(id)
);

-- Message History (optional, for audit/replay)
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  from_user_id UUID NOT NULL,
  to_user_id UUID NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id)
);
```

---

## 8. Under the Hood - What Happens Automatically

### Message Encryption Flow
```
1. User calls: signal.encrypt(from, to, message)
   ↓
2. SDK checks if session exists between from/to
   ↓
3. If NO session:
   - Fetch Bob's public keys from DB
   - Run X3DH key agreement
   - Create new session
   - Store session (encrypted) in DB
   ↓
4. Use Double Ratchet to encrypt message
   ↓
5. Return encrypted message + sessionId
```

### Message Decryption Flow
```
1. User calls: signal.decrypt(to, ciphertext, sessionId)
   ↓
2. SDK loads session from DB
   ↓
3. Use Double Ratchet to decrypt message
   ↓
4. Update session state (auto-ratchet)
   ↓
5. Return decrypted message + sender info
```

### Key Management (Automatic)
```
Every 24 hours (configurable):
- Check prekey count
- If < 50 prekeys available
  - Generate new prekeys
  - Encrypt with master key
  - Store in DB
  - Old used prekeys auto-cleaned
```

---

## 9. Security Features Built-In

| Feature | What it does |
|---------|-------------|
| **Forward Secrecy** | Even if key is stolen tomorrow, old messages stay safe |
| **Key Rotation** | Session keys change with every message |
| **Prekey Rotation** | Old prekeys auto-cleaned, new ones auto-generated |
| **Master Key Encryption** | All stored keys encrypted at rest |
| **Message Integrity** | Detects if message was tampered with |
| **Replay Protection** | Can't replay old messages |

---

## 10. Configuration Options

```typescript
const signal = new TelestackSEC({
  // Required
  databaseUrl: string;

  // Optional - Defaults below
  masterKey?: string;                    // Auto from env if not provided
  maxPrekeys?: number;                   // Default: 50
  prekeysThreshold?: number;             // Rotate when < 20
  messageHistoryEnabled?: boolean;       // Default: true
  sessionExpiryDays?: number;            // Default: 90 (no expiry if null)
  logLevel?: 'debug' | 'info' | 'warn'; // Default: 'info'
});
```

---

## 11. API Reference Summary

### User Management
```typescript
signal.user.register(email: string)           // Create new user
signal.user.delete(userId: string)            // Remove user
signal.user.getPublicKey(userId: string)      // Get public key
```

### Messaging
```typescript
signal.encrypt(options: {
  from: string;
  to: string;
  message: string;
})

signal.decrypt(options: {
  to: string;
  ciphertext: string;
  sessionId: string;
})
```

### Session Management
```typescript
signal.session.reset(userId1: string, userId2: string)  // Reset session
signal.session.getStatus(userId1: string, userId2: string)
signal.session.list(userId: string)                     // All sessions for user
```

### Admin/Debug
```typescript
signal.admin.rotatePrekeys(userId: string)
signal.admin.getMasterKey()
signal.admin.health()  // Check DB connection & state
```

---

## 12. Error Handling

```typescript
import { SignalError, SignalErrorCode } from '@telestack/telestacksec';

try {
  const encrypted = await signal.encrypt({
    from: 'alice',
    to: 'bob',
    message: 'Secret',
  });
} catch (error) {
  if (error instanceof SignalError) {
    switch (error.code) {
      case SignalErrorCode.USER_NOT_FOUND:
        console.log('User does not exist');
        break;
      case SignalErrorCode.SESSION_INIT_FAILED:
        console.log('Could not establish session');
        break;
      case SignalErrorCode.DECRYPTION_FAILED:
        console.log('Message tampered or corrupted');
        break;
      default:
        console.log('Unknown error:', error.message);
    }
  }
}
```

---

## 13. Integration Patterns

### With Express
```typescript
app.post('/api/messages', async (req, res) => {
  const { from, to, message } = req.body;
  
  const encrypted = await signal.encrypt({ from, to, message });
  
  // Store encrypted message in your DB
  await db.messages.create(encrypted);
  
  res.json({ success: true, sessionId: encrypted.sessionId });
});

app.get('/api/messages/:id', async (req, res) => {
  const msg = await db.messages.findById(req.params.id);
  
  const decrypted = await signal.decrypt({
    to: req.user.id,
    ciphertext: msg.ciphertext,
    sessionId: msg.sessionId,
  });
  
  res.json(decrypted);
});
```

### With WebSocket
```typescript
const io = require('socket.io')(server);

io.on('connection', (socket) => {
  socket.on('send-message', async (data) => {
    const encrypted = await signal.encrypt(data);
    io.to(data.to).emit('message', encrypted);
  });

  socket.on('receive-message', async (data) => {
    const decrypted = await signal.decrypt(data);
    console.log('Message:', decrypted.message);
  });
});
```

---

## 14. What's Next - Roadmap

### Phase 1 (Now)
- ✅ Core encryption/decryption
- ✅ Session management
- ✅ Key storage (encrypted)

### Phase 2 (Completed)
- ✅ Group messages (2+ users via Sender Keys)
- ✅ Real-time message delivery (WebSocket RelayHub)
- ✅ Encrypted Calls (SDP Signaling & Stream Encryption)

### Phase 3 (Future / Nice to Have)
- [ ] Message scheduling
- [ ] Key backup/recovery
- [ ] Permission models
- [ ] Rate limiting
- [ ] React hooks
- [ ] Full WebRTC DataChannel integration
- [ ] Audit logging

---

## 15. Why This Design?

| Goal | How we achieve it |
|------|------------------|
| **Simple for devs** | 3 lines to encrypt, 3 lines to decrypt |
| **Secure by default** | Keys auto-encrypted, sessions auto-managed |
| **Production-ready** | Uses libsignal (proven), prekey rotation, etc |
| **Scalable** | DB-backed, no in-memory state |
| **Non-dev friendly** | Abstracts all crypto complexity |

---

## Summary

**What users do:**
1. `new TelestackSEC({ databaseUrl })`
2. `signal.encrypt(...)`
3. `signal.decrypt(...)`
4. Done. Secure.

**What SDK does under the hood:**
1. Key generation & management
2. Session establishment (X3DH)
3. Message encryption (Double Ratchet)
4. State storage (encrypted)
5. Automatic housekeeping

That's it! Ready to build? 🚀


