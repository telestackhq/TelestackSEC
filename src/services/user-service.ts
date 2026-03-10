import { DatabaseService } from '../db/database-service';
import { CryptoManager } from '../crypto/crypto-manager';
import { SignalProtocol } from '../crypto/signal-protocol';
import { UserRegisterResponse, UserInfo, SignalError, SignalErrorCode } from '../types';

/**
 * User management service - registration, key generation, deletion
 */

export class UserService {
  constructor(
    private db: DatabaseService,
    private cryptoManager: CryptoManager,
    private maxPrekeys: number = 50
  ) {}

  /**
   * Register a new user
   * Generates identity key and initial prekeys
   */
  async register(email: string): Promise<UserRegisterResponse> {
    try {
      if (!email || !email.trim()) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'Email is required'
        );
      }

      // Create user in database
      const userId = await this.db.createUser(email.trim().toLowerCase());

      // Generate identity key pair
      const identityKeyPair = await SignalProtocol.generateIdentityKeyPair();

      // Encrypt private key with master key
      const encryptedPrivateKey = this.cryptoManager.encryptData(
        identityKeyPair.privateKey,
        `identity:${userId}`
      );

      // Store identity key
      await this.db.storeIdentityKey(userId, identityKeyPair.publicKey, encryptedPrivateKey);

      // Generate initial prekeys
      const preKeys = await SignalProtocol.generatePreKeys(this.maxPrekeys, 1);

      // Encrypt prekey private keys
      const encryptedPreKeys = preKeys.map((pk) => ({
        id: pk.id,
        publicKey: pk.publicKey,
        encryptedPrivateKey: this.cryptoManager.encryptData(
          pk.privateKey,
          `prekey:${userId}:${pk.id}`
        ),
      }));

      // Store prekeys
      await this.db.storePreKeys(userId, encryptedPreKeys);

      // Generate signed prekey (used in X3DH for authentication)
      const signedPreKey = await SignalProtocol.generateSignedPreKey(
        identityKeyPair, // Pass full key pair
        1 // First signed prekey ID
      );

      // Encrypt signed prekey private key
      const encryptedSignedPreKeyPrivate = this.cryptoManager.encryptData(
        signedPreKey.privateKey,
        `signed-prekey:${userId}:1`
      );

      // Store signed prekey
      await this.db.storeSignedPreKey(userId, {
        id: signedPreKey.id,
        publicKey: signedPreKey.publicKey,
        encryptedPrivateKey: encryptedSignedPreKeyPrivate,
        signature: signedPreKey.signature, // Store actual signature from libsignal
      });

      const user = await this.db.getUserById(userId);

      return {
        userId,
        email: user!.email,
        publicKey: identityKeyPair.publicKey,
        createdAt: user!.createdAt,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to register user',
        { originalError: error }
      );
    }
  }

  /**
   * Get user information
   */
  async getUser(userId: string): Promise<UserInfo> {
    try {
      const user = await this.db.getUserById(userId);

      if (!user) {
        throw new SignalError(
          SignalErrorCode.USER_NOT_FOUND,
          `User ${userId} not found`
        );
      }

      return {
        userId: user.id,
        email: user.email,
        createdAt: user.createdAt,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch user',
        { originalError: error }
      );
    }
  }

  /**
   * Get user's public key for session establishment
   */
  async getPublicKey(userId: string): Promise<string> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new SignalError(
          SignalErrorCode.USER_NOT_FOUND,
          `User ${userId} not found`
        );
      }

      const identityKey = await this.db.getIdentityKey(userId);
      if (!identityKey) {
        throw new SignalError(
          SignalErrorCode.CRYPTO_ERROR,
          `No identity key found for user ${userId}`
        );
      }

      return identityKey.publicKey;
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch public key',
        { originalError: error }
      );
    }
  }

  /**
   * Delete user and all associated data
   */
  async deleteUser(userId: string): Promise<void> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new SignalError(
          SignalErrorCode.USER_NOT_FOUND,
          `User ${userId} not found`
        );
      }

      await this.db.deleteUser(userId);
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to delete user',
        { originalError: error }
      );
    }
  }

  /**
   * Get user's identity key (private key encrypted)
   * Internal use only
   */
  async getIdentityKeyPair(userId: string): Promise<{ publicKey: string; encryptedPrivateKey: string }> {
    const identityKey = await this.db.getIdentityKey(userId);

    if (!identityKey) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        `No identity key found for user ${userId}`
      );
    }

    return {
      publicKey: identityKey.publicKey,
      encryptedPrivateKey: identityKey.encryptedPrivateKey,
    };
  }

  /**
   * Get active signed prekey for a user (used in X3DH)
   */
  async getActiveSignedPreKey(userId: string): Promise<{ publicKey: string; encryptedPrivateKey: string; id: number }> {
    const signedPreKey = await this.db.getActiveSignedPreKey(userId);

    if (!signedPreKey) {
      throw new SignalError(
        SignalErrorCode.CRYPTO_ERROR,
        `No active signed prekey found for user ${userId}`
      );
    }

    return {
      id: signedPreKey.id,
      publicKey: signedPreKey.publicKey,
      encryptedPrivateKey: signedPreKey.encryptedPrivateKey,
    };
  }

  /**
   * Check and rotate prekeys if threshold reached
   * Should be called periodically (e.g., daily)
   */
  async rotatePreKeysIfNeeded(userId: string, threshold: number = 20): Promise<number> {
    try {
      if (threshold < 0) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'Prekey threshold cannot be negative'
        );
      }

      const unusedCount = await this.db.getUnusedPreKeyCount(userId);

      if (unusedCount < threshold) {
        // Retain recent used prekeys for operational audits, remove old ones.
        const retentionCutoff = new Date();
        retentionCutoff.setDate(retentionCutoff.getDate() - 30);
        await this.db.deleteUsedPreKeysOlderThan(userId, retentionCutoff);

        // Generate new prekeys
        const newCount = this.maxPrekeys - unusedCount;
        const preKeys = await SignalProtocol.generatePreKeys(newCount, unusedCount + 1);

        // Encrypt and store
        const encryptedPreKeys = preKeys.map((pk) => ({
          id: pk.id,
          publicKey: pk.publicKey,
          encryptedPrivateKey: this.cryptoManager.encryptData(
            pk.privateKey,
            `prekey:${userId}:${pk.id}`
          ),
        }));

        await this.db.storePreKeys(userId, encryptedPreKeys);
        return newCount;
      }

      return 0;
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to rotate prekeys',
        { originalError: error }
      );
    }
  }
}
