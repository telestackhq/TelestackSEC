# Hacker News — Show HN Post
# Author: Aravinth V
# Format: Show HN submission + opening comment
# TIP: Submit Monday–Wednesday 8–10 AM EST (6:30–8:30 PM IST) for peak HN traffic.
# WARNING: HN hates marketing language. Be technical, honest, humble. Let the code speak.

---

## SUBMISSION TITLE (choose one — keep it factual, not salesy):

**Option A (recommended):**
Show HN: TelestackSEC – Signal Protocol as an npm package (TypeScript, MIT)

**Option B:**
Show HN: Open-source SDK implementing X3DH + Sender Keys + AES-CTR call encryption in TypeScript

**Option C (if doing self-promo angle):**
Show HN: I implemented Signal Protocol as a library so developers don't have to

---

## SUBMISSION URL:
https://github.com/telestackhq/TelestackSEC

---

## OPENING COMMENT (post this as your first comment immediately after submitting):

Hi HN,

I'm Aravinth. I built TelestackSEC, an open-source TypeScript SDK that implements the Signal Protocol cryptographic primitives.

**Why I built it:**
Every developer building a messaging feature faces the same choice: ship without proper encryption, or spend 3–6 months implementing Signal Protocol from scratch. Most choose the former. I wanted a third option.

**What it does:**
- X3DH key agreement using Node.js native crypto (no native bindings)
- Symmetric KDF ratchet for per-message key derivation
- Sender Keys protocol for group messaging (O(1) encryption for n members)
- AES-CTR media frame encryption for WebRTC calls
- Device-specific envelope routing (multi-device isolation)
- WebSocket relay for real-time push delivery

**The honest trade-off:**
This uses a Symmetric Ratchet (KDF chain), not the full Double Ratchet. The difference: full Double Ratchet performs a DH operation per message, providing post-compromise security — if session state is stolen, healing happens automatically after the next message exchange. The KDF-only approach means that if an attacker gets your session state, they can decrypt future messages until the session is manually reset.

I made this trade-off deliberately for two reasons:
1. Performance — no DH op every message
2. Simplicity — fewer moving parts means fewer implementation bugs

Post-compromise security is on the roadmap via a managed service that will run full Double Ratchet infrastructure.

**Technical implementation notes:**
- Uses Node.js `crypto` module throughout (no libsodium, no wasm)
- Prisma ORM for database portability (PostgreSQL / MySQL / SQLite)
- All private keys encrypted at rest with AES-256-GCM using a user-supplied master key derived via scrypt
- The `RelayHub` is a standalone WebSocket server using `ws` library
- Replay attack protection via SHA-256 ciphertext hashes with DB unique constraints

**What I'd like feedback on:**
1. Is the security model properly disclosed? Am I missing any risks in the README?
2. The AES-CTR IV scheme for calls uses `baseIV || frameCounter`. Is there a better approach for WebRTC?
3. Should the open-source version ship with the Symmetric Ratchet or is this too dangerous because developers might not read the disclaimer?

GitHub: https://github.com/telestackhq/TelestackSEC
npm: https://www.npmjs.com/package/@telestack/telestacksec

Happy to answer any cryptographic or architectural questions.

---

## ANTICIPATED HN QUESTIONS — PREPARE YOUR ANSWERS:

**Q: Why not use libsignal directly?**
A: libsignal requires native bindings (C++) which adds complexity, binary build steps, and platform-specific issues. Pure Node.js crypto means no native dependencies, works everywhere Node runs, and the implementation is fully auditable without understanding C++.

**Q: How is this different from existing JS Signal Protocol implementations?**
A: Most existing implementations are protocol-only (no key storage, no database, no relay). TelestackSEC is a complete SDK — key generation, storage, session management, group messaging, call encryption, and real-time delivery all in one package.

**Q: Your "Symmetric Ratchet" is just HKDF, not the Double Ratchet at all. Isn't that misleading?**
A: Fair criticism. I've been explicit in the README and docs that this is a KDF chain, not a full Double Ratchet, and what that means for security. The X3DH component is a full implementation. The missing piece is the per-message DH ratchet.

**Q: What's the threat model?**
A: The primary threat model addresses: passive network adversaries, compromised transport layer, database breaches where plaintext keys are exposed, and replay attacks. It does not address: post-compromise active attackers with live session state, metadata analysis, timing attacks.

**Q: No audit?**
A: Correct, no third-party security audit has been performed. This is explicitly noted in SECURITY.md. The codebase is open for community review. An audit is on the roadmap if/when commercial adoption warrants the investment.

**Q: Why npm? Why not a protocol spec or a reference implementation?**
A: Because the goal is to make E2EE accessible to developers who would otherwise ship without it. An npm package with a 3-line quickstart reaches that audience. A protocol spec does not.

---

## DO NOT DO ON HN:
- Don't reply to every comment instantly (looks desperate)
- Don't get defensive about security critiques — thank them and engage substantively
- Don't use marketing language in comments ("game-changing", "revolutionary")
- Don't ask for upvotes
