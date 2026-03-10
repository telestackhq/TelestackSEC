import { DatabaseService } from '../db/database-service';
import { CryptoManager } from '../crypto/crypto-manager';
import { SignalProtocol } from '../crypto/signal-protocol';
import { UserService } from './user-service';
import {
  EncryptOptions,
  EncryptResponse,
  DecryptOptions,
  DecryptResponse,
  SignalError,
  SignalErrorCode,
  MessageContent,
  MessageType,
} from '../types';

/**
 * Messaging service - encryption and decryption of messages
 */
export class MessagingService {
  constructor(
    private db: DatabaseService,
    private cryptoManager: CryptoManager,
    private userService: UserService,
    private messageHistoryEnabled: boolean = true,
    private relayUrl?: string,
    private relayAuthKey?: string
  ) { }

  /**
   * Encrypt a message from one user to another
   * Automatically establishes session if needed
   * Supports both text messages and structured MessageContent (media, calls, etc.)
   */
  async encrypt(options: EncryptOptions): Promise<EncryptResponse> {
    const { from, to, message } = options;

    try {
      this.validateEncryptInput(from, to, message);

      // Validate users exist
      await this.userService.getUser(from);
      await this.userService.getUser(to);

      // Check if session already exists
      let session = await this.db.getSession(from, to);

      if (!session) {
        // Establish new session using X3DH
        session = await this.establishSession(from, to);
      }

      const sessionAad = this.getSessionAad(session.userAId, session.userBId);

      // Decrypt session state for use
      const sessionStateStr = this.cryptoManager.decryptData(
        session.encryptedState,
        sessionAad
      );

      // Serialize message (handle both string and MessageContent)
      const messageStr = typeof message === 'string'
        ? message
        : JSON.stringify(message);

      const messageType = typeof message === 'string'
        ? undefined
        : message.type;

      // Encrypt message using Double Ratchet
      const encrypted = await SignalProtocol.encryptMessage(messageStr, sessionStateStr);

      // Update session state in database
      const updatedEncryptedState = this.cryptoManager.encryptData(
        encrypted.updatedSessionState,
        sessionAad
      );

      await this.db.getClient().session.update({
        where: { id: session.id },
        data: {
          encryptedState: updatedEncryptedState,
          lastMessageAt: new Date(),
        },
      });

      // Store message in history if enabled
      if (this.messageHistoryEnabled) {
        await this.db.storeMessage(from, to, encrypted.ciphertext);
      }

      // NOVEL: Real-time Relay Push
      if (this.relayUrl) {
        try {
          // Fire and forget notification to the relay hub
          fetch(`${this.relayUrl}/notify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.relayAuthKey ? { 'x-relay-secret': this.relayAuthKey } : {})
            },
            body: JSON.stringify({
              to,
              from,
              ciphertext: encrypted.ciphertext,
              sessionId: session.id
            })
          }).catch(() => { });
        } catch (e) {
          // Ignore relay errors
        }
      }

      return {
        ciphertext: encrypted.ciphertext,
        sessionId: session.id,
        timestamp: new Date(),
        messageType,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.ENCRYPTION_FAILED,
        'Failed to encrypt message',
        { originalError: error }
      );
    }
  }

  /**
   * Decrypt a message
   */
  async decrypt(options: DecryptOptions): Promise<DecryptResponse> {
    const { to, ciphertext, sessionId } = options;

    try {
      this.validateDecryptInput(to, ciphertext, sessionId);

      // Get session from database
      const session = await this.db.getSessionById(sessionId);

      if (!session) {
        throw new SignalError(
          SignalErrorCode.SESSION_NOT_FOUND,
          `Session ${sessionId} not found`
        );
      }

      if (session.userAId !== to && session.userBId !== to) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          `User ${to} does not belong to session ${sessionId}`
        );
      }

      // Reject re-processing of the exact ciphertext for this recipient/session.
      const alreadyProcessed = await this.db.isMessageProcessed(
        sessionId,
        to,
        ciphertext
      );
      if (alreadyProcessed) {
        throw new SignalError(
          SignalErrorCode.REPLAY_ATTACK_DETECTED,
          'Potential replay attack detected: duplicate ciphertext'
        );
      }

      // Determine sender
      const from = session.userAId === to ? session.userBId : session.userAId;

      const sessionAad = this.getSessionAad(session.userAId, session.userBId);

      // Decrypt session state
      const sessionStateStr = this.cryptoManager.decryptData(
        session.encryptedState,
        sessionAad
      );

      // Decrypt message using Double Ratchet
      const decrypted = await SignalProtocol.decryptMessage(ciphertext, sessionStateStr);

      // Update session state in database
      const updatedEncryptedState = this.cryptoManager.encryptData(
        decrypted.updatedSessionState,
        sessionAad
      );

      await this.db.getClient().session.update({
        where: { id: session.id },
        data: {
          encryptedState: updatedEncryptedState,
          lastMessageAt: new Date(),
        },
      });

      await this.db.markMessageProcessed(sessionId, to, ciphertext);

      // Try to parse as MessageContent if it's JSON
      let message: string | MessageContent;
      let messageType: MessageType | undefined;
      try {
        const parsed = JSON.parse(decrypted.message);
        if (parsed.type && Object.values(MessageType).includes(parsed.type)) {
          message = parsed as MessageContent;
          messageType = parsed.type;
        } else {
          message = decrypted.message;
        }
      } catch {
        message = decrypted.message;
      }

      return {
        message,
        from,
        sessionId,
        timestamp: new Date(),
        messageType,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DECRYPTION_FAILED,
        'Failed to decrypt message',
        { originalError: error }
      );
    }
  }

  private validateEncryptInput(from: string, to: string, message: string | MessageContent): void {
    if (!from || !to) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'Both from and to user IDs are required'
      );
    }

    if (from === to) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'Sender and recipient must be different users'
      );
    }

    if (!message) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'Message cannot be empty'
      );
    }

    if (typeof message === 'string') {
      if (message.trim().length === 0) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'Message cannot be empty'
        );
      }
      if (Buffer.byteLength(message, 'utf8') > 64 * 1024) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'Message exceeds 64KB maximum size'
        );
      }
    } else if (typeof message === 'object') {
      if (!message.type || !message.data) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'MessageContent must have type and data fields'
        );
      }
      const serialized = JSON.stringify(message);
      if (Buffer.byteLength(serialized, 'utf8') > 10 * 1024 * 1024) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'Message content exceeds 10MB maximum size'
        );
      }
    }
  }

  private validateDecryptInput(to: string, ciphertext: string, sessionId: string): void {
    if (!to || !ciphertext || !sessionId) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'to, ciphertext, and sessionId are required'
      );
    }
  }

  private async establishSession(senderUserId: string, recipientUserId: string) {
    try {
      const senderKeyPair = await this.userService.getIdentityKeyPair(senderUserId);
      const senderPrivateKey = this.cryptoManager.decryptData(
        senderKeyPair.encryptedPrivateKey,
        `identity:${senderUserId}`
      );

      const ephemeralKeyPair = await SignalProtocol.generateIdentityKeyPair();
      const ephemeralPrivateKey = ephemeralKeyPair.privateKey;

      const recipientKeyPair = await this.userService.getIdentityKeyPair(recipientUserId);
      const recipientPublicKey = recipientKeyPair.publicKey;

      const recipientSignedPreKey = await this.userService.getActiveSignedPreKey(recipientUserId);
      const recipientPreKey = await this.db.getAndConsumePreKey(recipientUserId);

      if (!recipientPreKey) {
        throw new SignalError(
          SignalErrorCode.PREKEY_NOT_FOUND,
          `No unused prekeys available for user ${recipientUserId}`
        );
      }

      const sessionData = await SignalProtocol.initiateSenderSession(
        senderPrivateKey,
        ephemeralPrivateKey,
        recipientPublicKey,
        recipientSignedPreKey.publicKey,
        recipientPreKey.publicKey
      );

      const [ua, ub] = senderUserId < recipientUserId
        ? [senderUserId, recipientUserId]
        : [recipientUserId, senderUserId];
      const sessionAad = this.getSessionAad(ua, ub);

      const encryptedState = this.cryptoManager.encryptData(
        sessionData.sessionState,
        sessionAad
      );

      const sessionId = await this.db.storeSession(
        senderUserId,
        recipientUserId,
        encryptedState
      );

      const session = await this.db.getSessionById(sessionId);
      if (!session) {
        throw new SignalError(
          SignalErrorCode.SESSION_INIT_FAILED,
          'Failed to create session'
        );
      }

      return session;
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.SESSION_INIT_FAILED,
        'Failed to establish session',
        { originalError: error }
      );
    }
  }

  private getSessionAad(userAId: string, userBId: string): string {
    return `session:${userAId}:${userBId}`;
  }
}
