# TelestackSEC Security Documentation

## 🔐 Cryptographic Architecture

TelestackSEC implements **X3DH Key Agreement** + **Symmetric Ratchet (KDF Chain)** for 1-to-1 messaging, **Sender Keys Protocol** for group messaging, and **AES-CTR with HKDF** for real-time encrypted calls.

---

## ✅ Security Properties Provided

### 1. **Forward Secrecy** ✅
**Status:** GUARANTEED

Each message is encrypted with a unique key derived via HMAC-based chain key ratcheting. Once a message key is used, the chain key is ratcheted forward and the old key is permanently deleted.

**Impact:** Even if an attacker compromises the session state today, they **cannot decrypt past messages** because the keys no longer exist.

```
Message 1: chainKey_0 → messageKey_1 + chainKey_1 (delete chainKey_0)
Message 2: chainKey_1 → messageKey_2 + chainKey_2 (delete chainKey_1)
Message 3: chainKey_2 → messageKey_3 + chainKey_3 (delete chainKey_2)
```

---

### 2. **Authentication** ✅
**Status:** GUARANTEED

Uses X3DH (Extended Triple Diffie-Hellman) with signed prekeys:
- Identity keys authenticate both parties
- Signed prekeys prevent MITM attacks on prekey bundles
- 4 DH operations provide mutual authentication:
  - DH1 = DH(sender_identity, recipient_signed_prekey)
  - DH2 = DH(sender_ephemeral, recipient_identity)
  - DH3 = DH(sender_ephemeral, recipient_signed_prekey)
  - DH4 = DH(sender_ephemeral, recipient_onetime_prekey) [optional]

**Impact:** Recipients can verify messages authentically came from the claimed sender.

---

### 3. **Integrity & Authenticity** ✅
**Status:** GUARANTEED

- **AES-256-GCM** provides authenticated encryption with integrity protection
- Each message has a 128-bit authentication tag
- AAD (Additional Authenticated Data) binding prevents context tampering

**Impact:** Any modification to ciphertext is detected and rejected during decryption.

---

### 4. **Confidentiality** ✅
**Status:** GUARANTEED

- **AES-256-GCM** provides IND-CCA2 security
- Per-message keys ensure each message is independently secure
- Master keys protected with **scrypt** (GPU-resistant, N=16384, 16MB memory)

**Impact:** Messages are computationally infeasible to decrypt without the session keys.

---

### 5. **Out-of-Order Message Support & DoS Protection** ✅
**Status:** SUPPORTED (with MAX_SKIP=2000 limit)

Messages can arrive out of order (e.g., due to network issues):
- System derives and stores keys for "skipped" messages.
- **Maximum 2000 skipped keys** per session or group sender key (prevents Resource Exhaustion / DoS attacks).
- If gap exceeds 2000 messages, session/key reset is required.

**Impact:** Robust against unreliable network delivery while immune to CPU/Memory exhaustion attacks.


---

## ⚠️ Security Limitations

### 1. **Post-Compromise Security** ❌
**Status:** NOT PROVIDED

**What this means:**
If an attacker compromises the session state (e.g., steals `rootKey` from the database), they can decrypt **ALL future messages** by ratcheting the chain key forward.

**Why:**
The `rootKey` is established once during X3DH and **never updated**. This is a Symmetric Ratchet, not the full Double Ratchet protocol.

**To achieve Post-Compromise Security:**
Would require implementing the **Asymmetric (DH) Ratchet**:
- Periodically generate new ephemeral key pairs
- Perform new DH agreements to derive fresh root keys
- This breaks the chain even if previous state was compromised

**Mitigation:**
- Strong database security (encrypted at rest, strict access control)
- Regular session rotation (e.g., every 7 days)
- Monitoring for unauthorized database access

---

### 2. **Metadata Protection** ⚠️
**Status:** PARTIAL

**What's protected:**
- Message content is encrypted
- AAD context binding prevents message replay across sessions

**What's NOT protected:**
- Message counter is sent in plaintext (reveals message ordering)
- Session IDs are stored in database (can be enumerated)
- Timing metadata (when messages are sent)

**Mitigation:**
- Use TLS/HTTPS for transport encryption
- Consider padding messages to constant size
- Implement rate limiting and traffic analysis resistance

---

## 🏗️ Architecture Decision: Symmetric Ratchet

TelestackSEC uses a **Symmetric Ratchet (KDF Chain)** instead of the full **Double Ratchet** protocol.

### **Why?**

**Pros:**
- ✅ Simpler implementation (fewer edge cases)
- ✅ Better performance (no expensive DH operations per message)
- ✅ Deterministic message ordering (easier debugging)
- ✅ Smaller state size (no ephemeral key pairs in session)

**Cons:**
- ❌ No post-compromise security (rootKey is static)
- ❌ Not standard Signal Protocol (no interoperability)

### **When is this acceptable?**

✅ **Good fit:**
- Corporate environments with strong database security
- Low-risk applications (not whistleblower/activist use cases)
- Applications where performance matters (IoT, mobile)
- Trust model: Database security >> endpoint security

❌ **Bad fit:**
- High-risk environments (state actors, targeted attacks)
- Whistleblower/journalist communications
- Zero-trust architectures
- Long-lived sessions (years)

---

## 📞 Call & Group Security Architecture

### **Group Messaging (Sender Keys)**
- Uses the **Signal Sender Keys** protocol for O(1) encryption efficiency.
- Each member maintains a unique Chain Key per group.
- Forward Secrecy is preserved via continuous ratcheting, but **Post-Compromise Security is not provided** since sender keys are static until a member leaves.
- ✅ **Replay Protection:** Group messages are protected against replay attacks via a database-level strict uniqueness constraint on their `ciphertextHash` (SHA-256).

### **Encrypted Calls (AES-CTR Streams)**
- Call Streams are encrypted frame-by-frame using `AES-256-CTR`.
- Stream keys are securely derived (`HKDF`) from the 1-to-1 E2EE session between the caller and callee.
- ✅ **IV Reuse Prevention:** The `frameCounter` is periodically synced to the database. If the server crashes and restarts, encryption resumes safely from the last persisted checkpoint, preventing catastrophic AES-CTR IV reuse.


---

## 🔧 Implementation Details

### Key Derivation Functions

**Master Key Derivation (scrypt):**
```typescript
scrypt(masterKeyString, salt, 32, { N: 16384, r: 8, p: 1 })
```
- N=16384: Memory cost = 16 MB (GPU-resistant)
- r=8, p=1: CPU cost parameters
- Purpose: Derive encryption keys from master key string

**Session Key Derivation (HKDF):**
```typescript
hkdf('sha256', masterSecret, salt, info, 64)
```
- Standard RFC 5869 HKDF-Expand
- 64 bytes output: 32 for rootKey + 32 for initial chainKey
- Info string: 'TelestackSEC-Double-Ratchet'

**Chain Key Ratcheting (HMAC):**
```typescript
messageKey = HMAC-SHA256(chainKey, 'TelestackSEC-message-key')
nextChainKey = HMAC-SHA256(chainKey, 'TelestackSEC-chain-key')
```
- Industry standard: HMAC-based KDF
- Separate constants prevent domain confusion

---

## 📊 Threat Model

### **Attacker Capabilities Assumed:**

| Attack Vector | Protected | Notes |
|---------------|-----------|-------|
| **Network eavesdropping** | ✅ Yes | TLS + E2EE prevents passive monitoring |
| **MITM on initial exchange** | ✅ Yes | Signed prekeys authenticate bundles |
| **Compromised past message keys** | ✅ Yes | Forward secrecy (keys deleted) |
| **Tampered ciphertext** | ✅ Yes | GCM authentication tags |
| **Replayed messages** | ✅ Yes | Counter (1-to-1) + Unique Ciphertext Hash (Groups) |
| **Database READ access (past)** | ⚠️ Partial | Can't decrypt past messages (keys deleted) |
| **Database READ access (present)** | ❌ No | Can decrypt future messages (rootKey static) |
| **Database WRITE access** | ❌ No | Can inject malicious state |

### **Out of Scope:**

- ❌ Endpoint compromise (malware on client)
- ❌ Side-channel attacks (timing, power analysis)
- ❌ Social engineering / phishing
- ❌ Quantum computers (ECC vulnerable)

---

## 🔄 Session Lifecycle

1. **Initialization:** X3DH establishes `rootKey` + initial `chainKey`
2. **Message Exchange:** Each message ratchets `chainKey` forward
3. **Session Persistence:** State stored in database (encrypted with master key)
4. **Session Expiry:** No automatic expiry (consider implementing rotation)

**Recommendation:** Rotate sessions every 7-30 days for defense-in-depth.

---

## 🚀 Production Deployment Checklist

### Database Security
- [ ] PostgreSQL encryption at rest (LUKS/dm-crypt or cloud provider encryption)
- [ ] Strict network firewall (only app servers can connect)
- [ ] Database authentication with strong passwords/certs
- [ ] Regular backups (encrypted)
- [ ] Audit logging enabled

### Application Security
- [ ] Master key stored in HSM or secrets manager (not in code)
- [ ] TLS 1.3 for all connections + WebSockets (WSS)
- [ ] Relay Hub explicitly protected with `RELAY_API_SECRET`
- [ ] Rate limiting on API endpoints
- [ ] Session rotation every 7-30 days
- [ ] Monitoring for suspicious database queries

### Infrastructure
- [ ] Node.js v15.12.0+ (required for `crypto.hkdf`)
- [ ] Memory limits configured (prevent OOM from large skipped keys)
- [ ] Load balancing for horizontal scaling
- [ ] Monitoring and alerting

---

## 📚 References

- [Signal Protocol Specification](https://signal.org/docs/)
- [RFC 5869: HMAC-based Key Derivation Function (HKDF)](https://tools.ietf.org/html/rfc5869)
- [X3DH Key Agreement Protocol](https://signal.org/docs/specifications/x3dh/)
- [scrypt: A Password-Based Key Derivation Function](https://tools.ietf.org/html/rfc7914)
- [AES-GCM Security Analysis](https://csrc.nist.gov/publications/detail/sp/800-38d/final)

---

## 📞 Security Contact

For security vulnerabilities, please contact: [Your Security Email]

**Please DO NOT open public GitHub issues for security vulnerabilities.**

---

## 📄 License

This security documentation is part of the TelestackSEC project.
