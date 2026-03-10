# DEV.to Post — TelestackSEC
# Author: Aravinth V
# Format: DEV.to markdown with frontmatter
# Tags: maximum 4
# TIP: Post Monday morning. Add a cover image (1000x420px). DEV.to favors "Show DEV" posts.

---

## FRONTMATTER (paste at top of DEV.to editor in raw mode):

```
---
title: I Added Signal Protocol to My Node.js App in 10 Minutes
published: true
description: TelestackSEC is an open-source SDK that gives you WhatsApp/Signal-level encryption with just a database URL. Here's how it works.
tags: security, typescript, opensource, webdev
cover_image: https://raw.githubusercontent.com/telestackhq/TelestackSEC/main/assets/cover.png
---
```

---

## ARTICLE BODY (paste after frontmatter):

## The Setup

You're building a chat feature. You know you need encryption. You open your browser and search "Signal Protocol implementation TypeScript."

Three hours later you're deep in HKDF derivation diagrams and questioning your life choices.

Been there. I built the escape hatch.

**TelestackSEC** — Signal Protocol as an npm package.

```bash
npm install @telestack/telestacksec
```

---

## The Simplest Demo

```typescript
import { TelestackSEC } from '@telestack/telestacksec';

const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,
  masterKey:   process.env.MASTER_KEY,
});

await signal.initialize();

const alice = await signal.user.register('alice@example.com');
const bob   = await signal.user.register('bob@example.com');

// Encrypted with X3DH + Symmetric Ratchet
const encrypted = await signal.encrypt({
  from:    alice.userId,
  to:      bob.userId,
  message: 'Hello!',
});

const decrypted = await signal.decrypt({
  to:         bob.userId,
  ciphertext: encrypted.ciphertext,
  sessionId:  encrypted.sessionId,
});

console.log(decrypted.message); // "Hello!"
```

That's the entire integration for a secure 1-to-1 chat. ✅

---

## What Happens Behind That .encrypt() Call

This runs automatically:

```
1. Check if Alice ↔ Bob session exists
2. If not → Fetch Bob's prekey bundle from DB
3. Perform X3DH (4 Diffie-Hellman operations)
4. Derive shared master secret
5. Initialise symmetric ratchet chain
6. Derive message key from chain key
7. AES-256-GCM encrypt with message key
8. Ratchet chain key forward
9. Persist session state (encrypted in DB)
10. Return ciphertext
```

You wrote 1 line. The SDK wrote all 10 steps.

---

## Group Chats: Sender Keys

With groups, naive encryption is O(n) — one encrypted message per member. That doesn't scale.

Sender Keys solve this with O(1):

```typescript
// Create group — SDK distributes keys to each member
const group = await signal.group.createGroup({
  name:      'Team Alpha',
  creatorId:  alice.userId,
  memberIds:  [bob.userId, charlie.userId],
});

// Encrypt ONCE — SDK handles fan-out internally  
const msg = await signal.group.sendGroupMessage({
  groupId:  group.groupId,
  senderId: alice.userId,
  message:  'Standup in 5?',
});

// Each member decrypts with their own session
const content = await signal.group.receiveGroupMessage({
  groupId:       group.groupId,
  senderId:      alice.userId,
  recipientId:   bob.userId,
  ciphertext:    msg.ciphertext,
  messageNumber: msg.messageNumber,
});

console.log(content.message); // "Standup in 5?"
```

**Bonus**: Replay attack protection is built in. Each message has a SHA-256 hash stored in the DB. Duplicate ciphertexts are rejected at the database constraint level — no code needed on your side.

---

## Encrypted Video Calls: AES-CTR Frame Encryption

```typescript
// Initiate call — SDP offer encrypted via existing session
const call = await signal.call.initiateCall({
  callerId: alice.userId,
  calleeId: bob.userId,
  callType: 'VIDEO',
  sdpOffer: peerConnection.localDescription,
});

// Both parties get the same stream key (derived from X3DH)
const aliceKey = await signal.call.getStreamKey(call.callId, alice.userId);
const bobKey   = await signal.call.getStreamKey(call.callId, bob.userId);

// Alice encrypts video frames
const encFrame = signal.call.encryptFrame(videoFrame, aliceKey);

// Bob decrypts — works out-of-order (UDP jitter safe!)
const decFrame = signal.call.decryptFrame(encFrame, bobKey, frameNumber);
```

I tested decrypting Frame 2, then Frame 0, then Frame 1. All worked. AES-CTR with a frame-counter IV handles UDP jitter natively.

---

## Multi-Device

```typescript
// Register a secondary device
const device = await signal.device.registerDevice({
  userId: bob.userId,
  name:   'iPad',
  identityPublicKey: deviceKey,
  registrationId: 2,
  isPrimary: false,
});

// Send to that specific device
await signal.device.sendEnvelope({
  senderUserId:     alice.userId,
  senderDeviceId:   aliceDevice.id,
  recipientUserId:  bob.userId,
  recipientDeviceId: device.deviceId,
  ciphertext:       encrypted,
  envelopeType:     'message',
});

// Bob's iPad fetches and ACKs
const pending = await signal.device.fetchPendingEnvelopes(device.deviceId);
await signal.device.ackEnvelope(device.deviceId, pending[0].id);
```

Each device has its own key isolation. Lose your iPad → your laptop is unaffected.

---

## Real-Time Delivery (WebSocket)

```typescript
const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL,
  relayUrl: 'wss://your-relay.com',
  relayAuthKey: process.env.RELAY_API_SECRET,
});

await signal.listen(bob.userId);

signal.on('message', (msg) => {
  console.log(`New message from ${msg.from}:`, msg.message);
});
```

Sub-millisecond WebSocket push. No polling. The included `RelayHub` is a standalone WebSocket server you can deploy anywhere:

```typescript
import { RelayHub } from '@telestack/telestacksec';

const hub = new RelayHub({ 
  port: 4000,
  relayAuthKey: process.env.RELAY_API_SECRET 
});
hub.start();
```

---

## The Honest Trade-offs

I want to be clear about the security model:

✅ **Forward Secrecy** — past messages safe even if keys stolen  
✅ **X3DH Authentication** — no MITM possible  
✅ **Per-message keys** — AES-256-GCM, unique key per message  
✅ **Replay protection** — ciphertext hash DB enforcement  
⚠️ **Post-Compromise Security** — limited (KDF chain, not full Double Ratchet)

The difference: Full Double Ratchet does a Diffie-Hellman operation every message. If someone steals your state today, healing happens automatically on the next DH ratchet. With KDF-only, healing requires a manual session reset.

For most apps — chat, internal tools, healthcare — KDF chain is more than enough. If you need journalist-level security with post-compromise guarantees, **TelestackSEC Pro** is coming with full Double Ratchet + managed infrastructure.

---

## Project Links

{% github telestackhq/TelestackSEC %}

📦 npm: `npm install @telestack/telestacksec`  
📧 Email: [hello@telestack.dev](mailto:hello@telestack.dev)  
🐦 X: [@TelestackCloud](https://x.com/telestackcloud)

---

## What I'd Love From the DEV Community

1. **Try it.** Run `npx ts-node examples/comprehensive-demo.ts` and tell me what broke.
2. **Roast the security model.** Cryptographers, come at me. I want the hard questions.
3. **Suggest use cases.** What app are you building where this would be useful?

Drop a comment or open a GitHub issue. Open source is only as good as its community.

---

*Built by Aravinth V — [LinkedIn](https://www.linkedin.com/in/buildwitharavinth/) | [GitHub](https://github.com/codeforgebyaravinth-dev) | [X](https://x.com/telestackcloud)*
