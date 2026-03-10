import * as libsignal from 'libsignal';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { SignalError, SignalErrorCode } from '../types';

// Type assertion for libsignal keyhelper and curve (no official types available)
const keyhelper = (libsignal as any).keyhelper;
const curve = (libsignal as any).curve;

// Promisify HKDF for async usage (Node 15.12.0+)
const hkdf = promisify(crypto.hkdf);

// Maximum number of skipped message keys to store (prevents DoS via large gaps)
const MAX_SKIP = 2000;

/**
 * Symmetric Ratchet Protocol with X3DH Key Agreement
 * 
 * IMPORTANT: This implementation uses a KDF Chain (Symmetric Ratchet), NOT the full
 * Double Ratchet protocol. The root key is established once during X3DH and never updated.
 * 
 * Security Properties:
 * ✅ Forward Secrecy: Past message keys are deleted and cannot be recovered
 * ✅ Authentication: X3DH with signed prekeys prevents MITM attacks  
 * ✅ Per-Message Keys: Each message encrypted with unique key via HMAC-based chain ratcheting
 * ✅ Out-of-Order Delivery: Supports delayed/reordered messages via skipped key storage
 * 
 * ❌ Post-Compromise Security: NOT PROVIDED
 *    If an attacker compromises the session state (steals rootKey from database),
 *    they can decrypt ALL future messages by running the chain ratchet forward.
 *    
 * For true Post-Compromise Security, implement the Asymmetric (DH) Ratchet where:
 * - Parties periodically generate new ephemeral key pairs
 * - Perform new DH agreements to derive fresh root keys
 * - This breaks the chain even if previous state was compromised
 * 
 * Architecture Decision: Symmetric Ratchet chosen for simplicity and performance.
 * Suitable for applications where database security is strong and state compromise is unlikely.
 * 
 * Requirements: Node.js v15.12.0+ (for crypto.hkdf)
 * Cryptography: X3DH + HMAC-SHA256 KDF Chain + AES-256-GCM
 */

export class SignalProtocol {
  /**
   * Generate identity key pair for a new user
   */
  static async generateIdentityKeyPair(): Promise<{
    publicKey: string;
    privateKey: string;
  }> {
    try {
      const keyPair = keyhelper.generateIdentityKeyPair();

      return {
        publicKey: keyPair.pubKey.toString('base64'),
        privateKey: keyPair.privKey.toString('base64'),
      };
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        'Failed to generate identity key pair',
        { originalError: error }
      );
    }
  }

  /**
   * Generate PreKeys for session establishment
   * Returns array of prekey objects with public and private keys
   */
  static async generatePreKeys(
    count: number = 50,
    startId: number = 1
  ): Promise<
    Array<{
      id: number;
      publicKey: string;
      privateKey: string;
    }>
  > {
    try {
      const preKeys = [];
      for (let i = 0; i < count; i++) {
        const preKey = keyhelper.generatePreKey(startId + i);
        preKeys.push({
          id: preKey.keyId,
          publicKey: preKey.keyPair.pubKey.toString('base64'),
          privateKey: preKey.keyPair.privKey.toString('base64'),
        });
      }
      return preKeys;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        'Failed to generate prekeys',
        { originalError: error }
      );
    }
  }

  /**
   * Generate signed prekey  (for better security)
   */
  static async generateSignedPreKey(
    identityKeyPair: { publicKey: string; privateKey: string },
    signedPreKeyId: number
  ): Promise<{
    id: number;
    publicKey: string;
    privateKey: string;
    signature: string;
  }> {
    try {
      const keyPair = {
        privKey: Buffer.from(identityKeyPair.privateKey, 'base64'),
        pubKey: Buffer.from(identityKeyPair.publicKey, 'base64'),
      };
      
      const signedPreKey = keyhelper.generateSignedPreKey(
        keyPair,
        signedPreKeyId
      );

      return {
        id: signedPreKey.keyId,
        publicKey: signedPreKey.keyPair.pubKey.toString('base64'),
        privateKey: signedPreKey.keyPair.privKey.toString('base64'),
        signature: signedPreKey.signature.toString('base64'),
      };
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        'Failed to generate signed prekey',
        { originalError: error }
      );
    }
  }

  /**
   * Initialize sender session using X3DH-style key agreement
   * 
   * Performs 4 Diffie-Hellman operations to derive a master secret, then uses HKDF
   * to derive the initial root key and chain key.
   * 
   * IMPORTANT: The root key established here is STATIC for the lifetime of this session.
   * It is never updated via DH ratcheting. This provides Forward Secrecy (past messages secure)
   * but NOT Post-Compromise Security (stealing root key compromises all future messages).
   * 
   * Called once per session during initial message exchange.
   */
  static async initiateSenderSession(
    senderIdentityPrivateKeyBase64: string,
    senderEphemeralPrivateKeyBase64: string,
    recipientIdentityPublicKeyBase64: string,
    recipientSignedPreKeyPublicKeyBase64: string,
    recipientPreKeyPublicKeyBase64?: string
  ): Promise<{
    sessionState: string;
    sharedSecret: string;
  }> {
    try {
      // Convert keys from base64 to Buffer
      const senderIdentityPrivKey = Buffer.from(senderIdentityPrivateKeyBase64, 'base64');
      const senderEphemeralPrivKey = Buffer.from(senderEphemeralPrivateKeyBase64, 'base64');
      const recipientIdentityPubKey = Buffer.from(recipientIdentityPublicKeyBase64, 'base64');
      const recipientSignedPreKeyPubKey = Buffer.from(recipientSignedPreKeyPublicKeyBase64, 'base64');
      const recipientPreKeyPubKey = recipientPreKeyPublicKeyBase64 
        ? Buffer.from(recipientPreKeyPublicKeyBase64, 'base64')
        : null;

      // Perform X3DH-style key agreement (multiple ECDH operations)
      // Each DH operation provides a different security property
      
      // DH1 = DH(sender_identity, recipient_signed_prekey)
      // - Authenticate sender's long-term identity
      const dh1 = curve.calculateAgreement(recipientSignedPreKeyPubKey, senderIdentityPrivKey);
      
      // DH2 = DH(sender_ephemeral, recipient_identity)  
      // - Authenticate recipient's long-term identity
      const dh2 = curve.calculateAgreement(recipientIdentityPubKey, senderEphemeralPrivKey);
      
      // DH3 = DH(sender_ephemeral, recipient_signed_prekey)
      // - Provides mutual authentication
      const dh3 = curve.calculateAgreement(recipientSignedPreKeyPubKey, senderEphemeralPrivKey);
      
      // DH4 = DH(sender_ephemeral, recipient_onetime_prekey) - if available
      // - Provides forward secrecy (one-time key ensures this key is never used again)
      let dh4 = Buffer.alloc(0);
      if (recipientPreKeyPubKey) {
        dh4 = curve.calculateAgreement(recipientPreKeyPubKey, senderEphemeralPrivKey);
      }

      // Combine all DH outputs into master secret
      // Order match Signal Protocol specification: DH1 || DH2 || DH3 || DH4
      const masterSecret = Buffer.concat([dh1, dh2, dh3, dh4]);
      
      // Derive session keys using standard HKDF (RFC 5869)
      // HKDF-Expand with separate info strings for different key types
      const info = Buffer.from('TelestackSEC-Double-Ratchet');
      
      // Derive 64 bytes: 32 for root key + 32 for initial chain key
      // Use empty salt which defaults to HMAC(zeros)
      const sessionKeyMaterialArrayBuffer = await hkdf(
        'sha256',
        masterSecret,
        Buffer.alloc(0), // Empty salt = use default (HMAC with zero key)
        info,
        64
      );
      
      // Convert ArrayBuffer to Buffer
      const sessionKeyMaterial = Buffer.from(sessionKeyMaterialArrayBuffer);
      const rootKey = sessionKeyMaterial.slice(0, 32).toString('base64');
      const chainKey = sessionKeyMaterial.slice(32, 64).toString('base64');

      // Create initial session state
      // Stores both sending and receiving chain keys (for potential bidirectional messages)
      const sessionState = {
        version: 1,
        rootKey, // Master key for ratcheting (never used directly for encryption)
        sendingChainKey: chainKey, // KDF input for sending messages
        receivingChainKey: chainKey, // KDF input for receiving messages
        sendingCounter: 0, // Message counter for sender
        receivingCounter: 0, // Message counter for receiver
        skippedMessageKeys: {}, // Store keys for out-of-order messages
        createdAt: new Date().toISOString(),
      };

      return {
        sessionState: JSON.stringify(sessionState),
        sharedSecret: sessionKeyMaterial.toString('base64'),
      };
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.SESSION_INIT_FAILED,
        'Failed to initiate sender session',
        { originalError: error }
      );
    }
  }

  /**
   * Derive message key from chain key using HMAC (Signal Protocol standard)
   * Returns both the message key and the next chain key for forward secrecy
   */
  private static deriveMessageKey(
    chainKey: Buffer
  ): { messageKey: Buffer; nextChainKey: Buffer } {
    // Message key: HMAC-SHA256(chain_key, constant "message-key")
    const messageKey = crypto
      .createHmac('sha256', chainKey)
      .update('TelestackSEC-message-key')
      .digest();

    // Chain key ratchet: HMAC-SHA256(chain_key, constant "chain-key")
    const nextChainKey = crypto
      .createHmac('sha256', chainKey)
      .update('TelestackSEC-chain-key')
      .digest();

    return { messageKey, nextChainKey };
  }

  /**
   * Encrypt message using Symmetric Ratchet (KDF Chain)
   * 
   * Each message is encrypted with a unique key derived from HMAC-based chain key ratcheting.
   * Provides Forward Secrecy: Past messages cannot be decrypted because old chain keys are discarded.
   * 
   * Does NOT provide Post-Compromise Security: If session state is stolen, all future messages
   * can be decrypted by ratcheting the chain key forward.
   */
  static async encryptMessage(
    message: string,
    sessionStateStr: string
  ): Promise<{
    ciphertext: string;
    updatedSessionState: string;
  }> {
    try {
      const sessionState = JSON.parse(sessionStateStr);

      // Derive message key from sending chain key
      const { messageKey, nextChainKey } = this.deriveMessageKey(
        Buffer.from(sessionState.sendingChainKey, 'base64')
      );

      // Encrypt message with AES-256-GCM
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', messageKey, iv);

      const plaintext = Buffer.from(message, 'utf8');
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Ciphertext format: version(1) + counter(4) + iv(12) + authTag(16) + encrypted
      const ciphertext = Buffer.concat([
        Buffer.from([1]), // version
        Buffer.alloc(4),  // counter placeholder
        iv,
        authTag,
        encrypted,
      ]);
      ciphertext.writeUInt32BE(sessionState.sendingCounter, 1);

      // Ratchet sending chain key forward for next message
      const updatedState = {
        ...sessionState,
        sendingChainKey: nextChainKey.toString('base64'),
        sendingCounter: sessionState.sendingCounter + 1,
      };

      return {
        ciphertext: ciphertext.toString('base64'),
        updatedSessionState: JSON.stringify(updatedState),
      };
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.ENCRYPTION_FAILED,
        'Failed to encrypt message',
        { originalError: error }
      );
    }
  }

  /**
   * Decrypt message using Symmetric Ratchet (KDF Chain)
   * 
   * Supports out-of-order message delivery by storing skipped message keys (up to MAX_SKIP limit).
   * If a message with counter N > currentCounter + 1 arrives, we derive and store
   * keys for counters currentCounter+1 to N-1 before decrypting message N.
   * 
   * Security: Throws error if message gap exceeds MAX_SKIP (prevents DoS via unbounded key storage).
   */
  static async decryptMessage(
    ciphertextBase64: string,
    sessionStateStr: string
  ): Promise<{
    message: string;
    updatedSessionState: string;
  }> {
    try {
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');
      const sessionState = JSON.parse(sessionStateStr);

      // Parse ciphertext format: version(1) + counter(4) + iv(12) + authTag(16) + encrypted
      if (ciphertext.length < 33) {
        throw new Error('Invalid ciphertext format');
      }

      const version = ciphertext[0];
      if (version !== 1) {
        throw new Error('Unsupported ciphertext version');
      }

      const messageCounter = ciphertext.readUInt32BE(1);
      const iv = ciphertext.slice(5, 17);
      const authTag = ciphertext.slice(17, 33);
      const encrypted = ciphertext.slice(33);

      let messageKey: Buffer;
      let receivingChainKeyBuffer: Buffer = Buffer.from(
        sessionState.receivingChainKey,
        'base64'
      );

      // Check if this is a skipped message (out-of-order delivery)
      const skippedKeyStr = (sessionState.skippedMessageKeys as Record<number, string>)[messageCounter];
      if (skippedKeyStr) {
        // Use stored key for out-of-order message
        messageKey = Buffer.from(skippedKeyStr, 'base64');
        delete (sessionState.skippedMessageKeys as Record<number, string>)[messageCounter];
      } else {
        // Handle in-order or delayed messages
        if (messageCounter > sessionState.receivingCounter + 1) {
          // Check for excessive message gap (prevents DoS via unbounded key storage)
          const numSkipped = messageCounter - sessionState.receivingCounter - 1;
          if (numSkipped > MAX_SKIP) {
            throw new SignalError(
              SignalErrorCode.DECRYPTION_FAILED,
              `Too many skipped messages (${numSkipped} > ${MAX_SKIP}). Session reset required.`,
              { messageCounter, receivingCounter: sessionState.receivingCounter }
            );
          }
          
          // Messages skipped: derive and store their keys for later
          for (let i = sessionState.receivingCounter + 1; i < messageCounter; i++) {
            const { messageKey: skippedKey, nextChainKey } = this.deriveMessageKey(
              receivingChainKeyBuffer
            );
            (sessionState.skippedMessageKeys as Record<number, string>)[i] = skippedKey.toString('base64');
            receivingChainKeyBuffer = nextChainKey as Buffer;
          }
        }

        // Derive message key for current message
        const { messageKey: currentKey, nextChainKey: nextChain } = this.deriveMessageKey(
          receivingChainKeyBuffer
        );
        messageKey = currentKey;
        receivingChainKeyBuffer = nextChain as Buffer;
        sessionState.receivingChainKey = receivingChainKeyBuffer.toString('base64');
        sessionState.receivingCounter = Math.max(
          sessionState.receivingCounter,
          messageCounter + 1
        );
      }

      // Decrypt with AES-256-GCM
      const decipher = crypto.createDecipheriv('aes-256-gcm', messageKey, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return {
        message: decrypted.toString('utf8'),
        updatedSessionState: JSON.stringify(sessionState),
      };
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DECRYPTION_FAILED,
        'Failed to decrypt message',
        { originalError: error }
      );
    }
  }
}
