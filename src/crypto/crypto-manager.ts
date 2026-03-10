import crypto from 'crypto';
import { SignalError, SignalErrorCode } from '../types';

/**
 * Handles encryption/decryption of sensitive data (keys) using a master key
 * Uses AES-256-GCM for authenticated encryption
 */

export class CryptoManager {
  private activeVersion: string;
  private keyring: Map<string, Buffer>;
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly IV_LENGTH = 16; // 128 bits
  private readonly AUTH_TAG_LENGTH = 16;
  private readonly VERSION_PREFIX = 'v';

  constructor(
    masterKeyString: string,
    activeVersion: string = '1',
    previousMasterKeys: Record<string, string> = {}
  ) {
    this.activeVersion = activeVersion;
    this.keyring = new Map<string, Buffer>();

    const activeKey = this.deriveKey(masterKeyString);
    this.keyring.set(this.activeVersion, activeKey);

    for (const [version, key] of Object.entries(previousMasterKeys)) {
      this.keyring.set(version, this.deriveKey(key));
    }

    if (!this.keyring.has(this.activeVersion)) {
      throw new SignalError(
        SignalErrorCode.INVALID_CONFIG,
        'Active master key version is not configured'
      );
    }
  }

  private deriveKey(masterKeyString: string): Buffer {
    // Use scrypt (memory-hard KDF) instead of SHA-256 for stronger key derivation
    // scrypt is resistant to GPU/ASIC attacks and suitable for password-based keys
    const derived = crypto.scryptSync(
      masterKeyString,
      'telestack-secure-salt', // Static salt (KDF for encryption keys, not password hashing)
      this.KEY_LENGTH,
      { N: 16384, r: 8, p: 1 } // Memory cost: 16 MB, CPU cost optimized
    );
    if (derived.length !== this.KEY_LENGTH) {
      throw new SignalError(
        SignalErrorCode.INVALID_CONFIG,
        'Master key derivation failed'
      );
    }
    return derived;
  }

  /**
   * Encrypt data (keys) with master key
   * Returns base64 string: iv + authTag + ciphertext
   */
  encryptData(data: string, aad?: string): string {
    try {
      const iv = crypto.randomBytes(this.IV_LENGTH);
      const masterKey = this.keyring.get(this.activeVersion)!;
      const cipher = crypto.createCipheriv(
        this.ALGORITHM,
        masterKey,
        iv
      );

      if (aad) {
        cipher.setAAD(Buffer.from(aad, 'utf8'));
      }

      let ciphertext = cipher.update(data, 'utf8', 'binary');
      ciphertext += cipher.final('binary');

      const authTag = cipher.getAuthTag();

      // Combine: iv (16 bytes) + authTag (16 bytes) + ciphertext
      const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(ciphertext, 'binary'),
      ]);

      return `${this.VERSION_PREFIX}${this.activeVersion}:${combined.toString('base64')}`;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        'Encryption failed',
        { originalError: error }
      );
    }
  }

  /**
   * Decrypt data with master key
   * Expects base64 string: iv + authTag + ciphertext
   */
  decryptData(encryptedData: string, aad?: string): string {
    try {
      const parsed = this.parseEncryptedPayload(encryptedData);
      const combined = Buffer.from(parsed.ciphertextBase64, 'base64');

      if (combined.length < this.IV_LENGTH + this.AUTH_TAG_LENGTH) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = combined.slice(0, this.IV_LENGTH);
      const authTag = combined.slice(
        this.IV_LENGTH,
        this.IV_LENGTH + this.AUTH_TAG_LENGTH
      );
      const ciphertext = combined.slice(
        this.IV_LENGTH + this.AUTH_TAG_LENGTH
      );

      const masterKey = this.resolveDecryptKey(parsed.version);
      const decipher = crypto.createDecipheriv(this.ALGORITHM, masterKey, iv);

      if (aad) {
        decipher.setAAD(Buffer.from(aad, 'utf8'));
      }
      decipher.setAuthTag(authTag);

      let plaintext = decipher.update(ciphertext);
      plaintext = Buffer.concat([plaintext, decipher.final()]);

      return plaintext.toString('utf8');
    } catch (error) {
      // Backward-compatible fallback for legacy data that had no AAD binding.
      if (aad) {
        try {
          // Attempt legacy decryption (payload encrypted without AAD context)
          return this.decryptData(encryptedData);
        } catch (legacyError) {
          // Both AAD-bound and legacy decryption failed
          // Log this for observability (data corruption or tampering suspected)
          const debugInfo = {
            hadAAD: true,
            primaryError: String(error),
            legacyFallbackError: String(legacyError),
            timestamp: new Date().toISOString(),
          };
          console.warn(
            '[TelestackSEC] Decryption failed for both AAD-bound and legacy formats:',
            debugInfo
          );
        }
      }
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        'Decryption failed',
        { originalError: error }
      );
    }
  }

  private parseEncryptedPayload(
    encryptedData: string
  ): { version?: string; ciphertextBase64: string } {
    const versionedPrefix = `${this.VERSION_PREFIX}`;

    if (encryptedData.startsWith(versionedPrefix) && encryptedData.includes(':')) {
      const delimiterIndex = encryptedData.indexOf(':');
      const version = encryptedData.slice(1, delimiterIndex);
      const ciphertextBase64 = encryptedData.slice(delimiterIndex + 1);
      return { version, ciphertextBase64 };
    }

    // Legacy format had no version prefix.
    return { ciphertextBase64: encryptedData };
  }

  private resolveDecryptKey(version?: string): Buffer {
    if (!version) {
      return this.keyring.get(this.activeVersion)!;
    }

    const versionedKey = this.keyring.get(version);
    if (!versionedKey) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        `Unknown master key version: ${version}`
      );
    }
    return versionedKey;
  }

  /**
   * Verify/validate master key format
   */
  static validateMasterKey(key: string): boolean {
    const isValid = key && key.length >= 32; // Minimum 32 characters for production safety
    return isValid ? true : false;
  }
}
