# Medium Article — TelestackSEC
# Author: Aravinth V
# Publication targets: Better Programming, The Startup, Level Up Coding, JavaScript in Plain English
# Reading time: ~8 minutes
# TIP: Submit to a publication for 5–10x reach vs self-publishing

---

# I Added Signal Protocol to My App in 10 Minutes (And You Can Too)

**TL;DR**: I built TelestackSEC — an open-source SDK that gives any developer Signal Protocol encryption with just a database URL. Here's how it works and why I built it.

---

## The Problem With "Just Add Encryption"

Every developer eventually hits this moment.

You're building a product. Users will share sensitive data — messages, health records, financial information. You think: *"I should encrypt this."*

Then reality sets in.

Signal Protocol — the gold standard for end-to-end encryption used by WhatsApp, Signal, and iMessage — is notoriously complex. It involves:

- **X3DH** (Extended Triple Diffie-Hellman) for initial key agreement
- **Double Ratchet Algorithm** for per-message key derivation
- **Sender Keys** for efficient group messaging
- Prekey management, rotation, storage, and distribution

Most developers look at this list and do one of three things:
1. Ship without encryption (dangerous)
2. Use a managed service that doesn't actually do E2EE
3. Spend 3–6 months implementing it from scratch

I decided to build a fourth option.

---

## Introducing TelestackSEC

TelestackSEC is an open-source TypeScript SDK that implements the Signal Protocol. You bring a database URL. We bring five thousand lines of cryptographic engineering.

```bash
npm install @telestack/telestacksec
```

### The Full Implementation

Here's everything you need to add Signal Protocol to your app:

```typescript
import { TelestackSEC } from '@telestack/telestacksec';

const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,
  masterKey: process.env.MASTER_KEY,
});

await signal.initialize();

// Register users
const alice = await signal.user.register('alice@example.com');
const bob   = await signal.user.register('bob@example.com');

// Alice sends an encrypted message to Bob
const encrypted = await signal.encrypt({
  from: alice.userId,
  to:   bob.userId,
  message: 'Hello from the encrypted world!',
});

// Bob decrypts it
const decrypted = await signal.decrypt({
  to:        bob.userId,
  ciphertext: encrypted.ciphertext,
  sessionId:  encrypted.sessionId,
});

console.log(decrypted.message); // "Hello from the encrypted world!"
```

That's it. Behind those 3 lines, the SDK:

1. Checked if a session existed between Alice and Bob
2. If not, fetched Bob's prekey bundle and performed X3DH (4 Diffie-Hellman operations)
3. Established a unique session and derived a chain key
4. Ratcheted the chain key forward and derived a message key
5. Encrypted with AES-256-GCM using that message key
6. Stored the encrypted message and session state in your database

---

## What's Under the Hood

### X3DH Key Exchange

When two users communicate for the first time, the SDK performs Extended Triple Diffie-Hellman:

```
Alice's Identity Key   +  Bob's Signed PreKey   → DH1
Alice's Ephemeral Key  +  Bob's Identity Key    → DH2
Alice's Ephemeral Key  +  Bob's Signed PreKey   → DH3
Alice's Ephemeral Key  +  Bob's One-Time PreKey → DH4 (if available)

Master Secret = KDF(DH1 || DH2 || DH3 || DH4)
```

This gives you **mutual authentication** (both parties confirmed) and **forward secrecy** (compromise today doesn't reveal past messages).

### Symmetric Ratchet

After session establishment, the SDK uses a KDF chain ratchet for each message:

```
ChainKey_n → HMAC-SHA256 → MessageKey_n (used to encrypt message n)
ChainKey_n → HMAC-SHA256 → ChainKey_n+1 (used for next message)
```

Each message gets a completely unique key. Compromise one key and you only expose one message.

---

## Group Messaging: Sender Keys Protocol

Group messaging is architecturally different from 1-to-1. With 100 members, you don't want to send 99 separate encrypted messages. That's O(n) complexity.

Sender Keys solve this with O(1) encryption:

```typescript
// Create a group
const group = await signal.group.createGroup({
  name:      'Engineering Team',
  creatorId: alice.userId,
  memberIds: [bob.userId, charlie.userId],
});

// Alice sends ONE encrypted message — SDK handles fan-out
const result = await signal.group.sendGroupMessage({
  groupId:   group.groupId,
  senderId:  alice.userId,
  message:   'Deploy to production?',
});

console.log(`Delivered to ${result.deliveredTo} members`);
// "Delivered to 2 members"

// Bob decrypts it
const content = await signal.group.receiveGroupMessage({
  groupId:     group.groupId,
  senderId:    alice.userId,
  recipientId: bob.userId,
  ciphertext:  result.ciphertext,
  messageNumber: result.messageNumber,
});

console.log(content.message); // "Deploy to production?"
```

**Replay attack protection is built-in.** Every group message gets a `ciphertextHash` stored in the database. Duplicate ciphertexts are rejected at the database constraint level — even under race conditions.

---

## Encrypted Calls: AES-CTR Stream Encryption

For audio/video calls, the SDK uses AES-CTR mode for efficient frame-by-frame encryption:

```typescript
// Alice initiates a call (encrypted SDP offer via existing session)
const call = await signal.call.initiateCall({
  callerId: alice.userId,
  calleeId: bob.userId,
  callType: 'VIDEO',
  sdpOffer: rtcPeerConnection.localDescription,
});

// Bob answers (encrypted SDP answer)
await signal.call.answerCall({
  callId:    call.callId,
  calleeId:  bob.userId,
  sdpAnswer: rtcPeerConnection.localDescription,
});

// Both parties derive the same stream key from their shared session
const aliceKey = await signal.call.getStreamKey(call.callId, alice.userId);
const bobKey   = await signal.call.getStreamKey(call.callId, bob.userId);
// aliceKey.key === bobKey.key (mathematically identical from X3DH)

// Encrypt frames (AES-CTR with frame counter as IV)
const encrypted = signal.call.encryptFrame(videoFrame, aliceKey);

// Bob decrypts — works even if frames arrive out of order (UDP jitter)
const decrypted = signal.call.decryptFrame(encrypted, bobKey, frameNumber);
```

The out-of-order decryption is deliberate. In WebRTC over UDP, packets arrive out of sequence. Since we use the frame number as the IV directly (not a stream position), Bob can decrypt frame 47 before frame 46 arrives with no issues.

---

## Multi-Device Architecture

The SDK implements device-specific key isolation, matching Signal's own approach:

```typescript
// Register Bob's laptop as a separate device
const device = await signal.device.registerDevice({
  userId: bob.userId,
  name: 'MacBook Pro',
  identityPublicKey: devicePublicKey,
  registrationId: 1,
  isPrimary: false,
});

// Alice sends to Bob's laptop specifically
await signal.device.sendEnvelope({
  senderUserId:     alice.userId,
  senderDeviceId:   alice.device.id,
  recipientUserId:  bob.userId,
  recipientDeviceId: device.deviceId,
  ciphertext:       encryptedPayload,
  envelopeType:     'message',
});

// Bob's laptop fetches pending envelopes
const envelopes = await signal.device.fetchPendingEnvelopes(device.deviceId);

// ACK to remove from queue (prevents "zombie notifications")
await signal.device.ackEnvelope(device.deviceId, envelopes[0].id);
```

Each device has its own identity key pair. Losing one device doesn't compromise others.

---

## The Honest Security Model

I want to be transparent about the trade-offs:

| Property | TelestackSEC (Open Source) |
|---|---|
| Forward Secrecy | ✅ Full |
| MITM Protection | ✅ Via X3DH |
| Replay Protection | ✅ Built-in |
| Per-Message Keys | ✅ Yes |
| Post-Compromise Security | ⚠️ Limited (KDF chain only) |

The SDK uses a **Symmetric Ratchet** (KDF chain), not the full **Double Ratchet** (which also performs a Diffie-Hellman operation every message).

This means: if an attacker compromises your session state today, they can read future messages until the session is reset. The full Double Ratchet prevents this with a DH ratchet per message.

For most applications — consumer chat, internal tools, healthcare data — the Symmetric Ratchet is more than sufficient. Your database is encrypted at rest, access is controlled, and the KDF chain provides strong forward secrecy.

**TelestackSEC Pro** (coming soon) provides full Double Ratchet with managed infrastructure — we run the database, relay, and key management. Post-compromise security included.

---

## What You Get For Free

When you call `signal.user.register()`, here's what the SDK generates and encrypts in your database:

- 1 identity key pair (Ed25519 signing + X25519 exchange)
- 1 signed prekey (signed by identity key for authentication)
- 50 one-time prekeys (consumed on first contact to prevent replay)

All private keys are encrypted with AES-256-GCM using your master key before database storage. **Your database never sees plaintext private keys.**

---

## Try It Now

```bash
npm install @telestack/telestacksec
```

Set up your database schema:
```bash
npx prisma migrate dev
```

Then run the [comprehensive demo](https://github.com/telestackhq/TelestackSEC/blob/main/examples/comprehensive-demo.ts) to see all features verified end-to-end.

---

## What's Coming

**TelestackSEC Pro** — Managed infrastructure with full Double Ratchet:
- We run the database (encrypted, geo-redundant)
- We run the global relay network
- Full post-compromise security
- SOC2 and HIPAA compliance
- Same API — swap your DB URL for an API key

Join the waitlist: [hello@telestack.dev](mailto:hello@telestack.dev)

---

## Connect

⭐ [GitHub](https://github.com/telestackhq/TelestackSEC) — Star and contribute  
📦 [npm](https://www.npmjs.com/package/@telestack/telestacksec) — Install and use  
🐦 [@TelestackCloud](https://x.com/telestackcloud) on X  
💼 [LinkedIn — BuildWithAravinth](https://www.linkedin.com/in/buildwitharavinth/)  
📧 [hello@telestack.dev](mailto:hello@telestack.dev)

---

*Aravinth V — Founder, Telestack. Building security infrastructure so developers can focus on their actual products.*
