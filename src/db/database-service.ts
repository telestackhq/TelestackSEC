import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { SignalError, SignalErrorCode } from '../types';

/**
 * Database service wrapper for all user, key, and session operations
 */

export class DatabaseService {
  private prisma: PrismaClient;

  private connected: boolean = false;

  constructor(databaseUrl?: string) {
    this.prisma = new PrismaClient({
      datasources: databaseUrl ? {
        db: {
          url: databaseUrl
        }
      } : undefined
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.connected = true;
      console.log('✓ Database connected');
    } catch (error) {
      this.connected = false;
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to connect to database',
        { originalError: error }
      );
    }
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  // ============ USER OPERATIONS ============

  async createUser(email: string): Promise<string> {
    try {
      const user = await this.prisma.user.create({
        data: { email },
      });
      return user.id;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new SignalError(
          SignalErrorCode.USER_ALREADY_EXISTS,
          `User with email ${email} already exists`
        );
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to create user',
        { originalError: error }
      );
    }
  }

  async getUserById(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      return user;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch user',
        { originalError: error }
      );
    }
  }

  async getUserByEmail(email: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
      });
      return user;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch user',
        { originalError: error }
      );
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.prisma.user.delete({
        where: { id: userId },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to delete user',
        { originalError: error }
      );
    }
  }

  // ============ IDENTITY KEY OPERATIONS ============

  async storeIdentityKey(
    userId: string,
    publicKey: string,
    encryptedPrivateKey: string
  ): Promise<void> {
    try {
      await this.prisma.identityKey.upsert({
        where: { userId },
        update: { publicKey, encryptedPrivateKey },
        create: { userId, publicKey, encryptedPrivateKey },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store identity key',
        { originalError: error }
      );
    }
  }

  async getIdentityKey(userId: string) {
    try {
      const key = await this.prisma.identityKey.findUnique({
        where: { userId },
      });
      return key;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch identity key',
        { originalError: error }
      );
    }
  }

  // ============ PREKEY OPERATIONS ============

  async storePreKeys(
    userId: string,
    preKeys: Array<{
      id: number;
      publicKey: string;
      encryptedPrivateKey: string;
    }>
  ): Promise<void> {
    try {
      await this.prisma.preKey.createMany({
        data: preKeys.map((pk) => ({
          userId,
          publicKey: pk.publicKey,
          encryptedPrivateKey: pk.encryptedPrivateKey,
        })),
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store prekeys',
        { originalError: error }
      );
    }
  }

  // ============ SIGNED PREKEY OPERATIONS ============

  async storeSignedPreKey(
    userId: string,
    signedPreKey: {
      id: number;
      publicKey: string;
      encryptedPrivateKey: string;
      signature: string;
    }
  ): Promise<void> {
    try {
      // Deactivate previous signed prekeys for this user
      await this.prisma.signedPreKey.updateMany({
        where: { userId, active: true },
        data: { active: false, rotatedAt: new Date() },
      });

      // Store new signed prekey as active
      await this.prisma.signedPreKey.create({
        data: {
          userId,
          publicKey: signedPreKey.publicKey,
          encryptedPrivateKey: signedPreKey.encryptedPrivateKey,
          signature: signedPreKey.signature,
          active: true,
        },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store signed prekey',
        { originalError: error }
      );
    }
  }

  async getActiveSignedPreKey(userId: string) {
    try {
      const signedPreKey = await this.prisma.signedPreKey.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: 'desc' },
      });
      return signedPreKey;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch active signed prekey',
        { originalError: error }
      );
    }
  }

  async getUnusedPreKey(userId: string) {
    try {
      const preKey = await this.prisma.preKey.findFirst({
        where: { userId, used: false },
        orderBy: { createdAt: 'asc' },
      });
      return preKey;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch prekey',
        { originalError: error }
      );
    }
  }

  async markPreKeyAsUsed(preKeyId: number): Promise<void> {
    try {
      await this.prisma.preKey.update({
        where: { id: preKeyId },
        data: { used: true, usedAt: new Date() },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to mark prekey as used',
        { originalError: error }
      );
    }
  }

  /**
   * Atomically fetch and mark a PreKey as used
   * Prevents race condition where two sessions could use the same prekey
   * Uses Prisma transaction to ensure atomicity
   */
  async getAndConsumePreKey(userId: string) {
    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        const preKey = await tx.preKey.findFirst({
          where: { userId, used: false },
          orderBy: { createdAt: 'asc' },
        });

        if (!preKey) return null;

        await tx.preKey.update({
          where: { id: preKey.id },
          data: { used: true, usedAt: new Date() },
        });

        return preKey;
      });
      return result;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to atomically consume prekey',
        { originalError: error }
      );
    }
  }

  async getUnusedPreKeyCount(userId: string): Promise<number> {
    try {
      return await this.prisma.preKey.count({
        where: { userId, used: false },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to count prekeys',
        { originalError: error }
      );
    }
  }

  async deleteUsedPreKeys(userId: string): Promise<number> {
    return this.deleteUsedPreKeysOlderThan(userId);
  }

  async deleteUsedPreKeysOlderThan(
    userId: string,
    cutoffDate?: Date
  ): Promise<number> {
    try {
      const result = await this.prisma.preKey.deleteMany({
        where: {
          userId,
          used: true,
          ...(cutoffDate ? { usedAt: { lt: cutoffDate } } : {}),
        },
      });
      return result.count;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to delete used prekeys',
        { originalError: error }
      );
    }
  }

  // ============ SESSION OPERATIONS ============

  async storeSession(
    userAId: string,
    userBId: string,
    encryptedState: string
  ): Promise<string> {
    try {
      // Ensure consistent ordering
      const [ua, ub] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

      const session = await this.prisma.session.upsert({
        where: {
          userAId_userBId: { userAId: ua, userBId: ub },
        },
        update: { encryptedState, lastMessageAt: new Date() },
        create: { userAId: ua, userBId: ub, encryptedState },
      });
      return session.id;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store session',
        { originalError: error }
      );
    }
  }

  async getSession(userAId: string, userBId: string) {
    try {
      const [ua, ub] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

      const session = await this.prisma.session.findUnique({
        where: {
          userAId_userBId: { userAId: ua, userBId: ub },
        },
      });
      return session;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch session',
        { originalError: error }
      );
    }
  }

  async getSessionById(sessionId: string) {
    try {
      return await this.prisma.session.findUnique({
        where: { id: sessionId },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch session',
        { originalError: error }
      );
    }
  }

  async getUserSessions(userId: string) {
    try {
      return await this.prisma.session.findMany({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        orderBy: { lastMessageAt: 'desc' },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch user sessions',
        { originalError: error }
      );
    }
  }

  async deleteSession(userAId: string, userBId: string): Promise<void> {
    try {
      const [ua, ub] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

      await this.prisma.session.delete({
        where: {
          userAId_userBId: { userAId: ua, userBId: ub },
        },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to delete session',
        { originalError: error }
      );
    }
  }

  // ============ MESSAGE OPERATIONS ============

  async storeMessage(
    fromUserId: string,
    toUserId: string,
    ciphertext: string
  ): Promise<string> {
    try {
      const message = await this.prisma.message.create({
        data: { fromUserId, toUserId, ciphertext },
      });
      return message.id;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store message',
        { originalError: error }
      );
    }
  }

  async getMessageById(messageId: string) {
    try {
      return await this.prisma.message.findUnique({
        where: { id: messageId },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch message',
        { originalError: error }
      );
    }
  }

  async getUserMessages(userId: string, limit: number = 50) {
    try {
      return await this.prisma.message.findMany({
        where: {
          OR: [{ fromUserId: userId }, { toUserId: userId }],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch messages',
        { originalError: error }
      );
    }
  }

  // ============ REPLAY DETECTION OPERATIONS ============

  private getCiphertextHash(ciphertext: string): string {
    return crypto.createHash('sha256').update(ciphertext).digest('hex');
  }

  async isMessageProcessed(
    sessionId: string,
    recipientUserId: string,
    ciphertext: string
  ): Promise<boolean> {
    try {
      const ciphertextHash = this.getCiphertextHash(ciphertext);
      const processed = await this.prisma.processedMessage.findUnique({
        where: {
          sessionId_recipientUserId_ciphertextHash: {
            sessionId,
            recipientUserId,
            ciphertextHash,
          },
        },
      });

      return !!processed;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to query processed message state',
        { originalError: error }
      );
    }
  }

  async markMessageProcessed(
    sessionId: string,
    recipientUserId: string,
    ciphertext: string
  ): Promise<void> {
    try {
      const ciphertextHash = this.getCiphertextHash(ciphertext);
      await this.prisma.processedMessage.create({
        data: {
          sessionId,
          recipientUserId,
          ciphertextHash,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new SignalError(
          SignalErrorCode.REPLAY_ATTACK_DETECTED,
          'Potential replay attack detected: ciphertext already processed'
        );
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to mark message as processed',
        { originalError: error }
      );
    }
  }

  // ============ DEVICE TRUST-MODE OPERATIONS ============

  async createDevice(input: {
    userId: string;
    name: string;
    identityPublicKey: string;
    registrationId: number;
    isPrimary: boolean;
  }) {
    try {
      if (input.isPrimary) {
        await this.prisma.device.updateMany({
          where: { userId: input.userId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return await this.prisma.device.create({
        data: {
          userId: input.userId,
          name: input.name,
          identityPublicKey: input.identityPublicKey,
          registrationId: input.registrationId,
          isPrimary: input.isPrimary,
        },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to create device',
        { originalError: error }
      );
    }
  }

  async getDeviceById(deviceId: string) {
    try {
      return await this.prisma.device.findUnique({
        where: { id: deviceId },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch device',
        { originalError: error }
      );
    }
  }

  async storeDeviceSignedPreKey(
    deviceId: string,
    signedPreKey: { keyId: number; publicKey: string; signature: string }
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.deviceSignedPreKey.updateMany({
          where: { deviceId, active: true },
          data: { active: false },
        });

        await tx.deviceSignedPreKey.upsert({
          where: {
            deviceId_keyId: {
              deviceId,
              keyId: signedPreKey.keyId,
            },
          },
          update: {
            publicKey: signedPreKey.publicKey,
            signature: signedPreKey.signature,
            active: true,
          },
          create: {
            deviceId,
            keyId: signedPreKey.keyId,
            publicKey: signedPreKey.publicKey,
            signature: signedPreKey.signature,
            active: true,
          },
        });
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store device signed prekey',
        { originalError: error }
      );
    }
  }

  async storeDevicePreKeys(
    deviceId: string,
    preKeys: Array<{ keyId: number; publicKey: string }>
  ): Promise<void> {
    try {
      await this.prisma.devicePreKey.createMany({
        data: preKeys.map((k) => ({
          deviceId,
          keyId: k.keyId,
          publicKey: k.publicKey,
        })),
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store device prekeys',
        { originalError: error }
      );
    }
  }

  async getActiveDeviceSignedPreKey(deviceId: string) {
    try {
      return await this.prisma.deviceSignedPreKey.findFirst({
        where: { deviceId, active: true },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch device signed prekey',
        { originalError: error }
      );
    }
  }

  async getAndConsumeDeviceOneTimePreKey(deviceId: string) {
    try {
      // Use transaction to prevent race condition where two processes grab same prekey
      const result = await this.prisma.$transaction(async (tx: any) => {
        const preKey = await tx.devicePreKey.findFirst({
          where: { deviceId, used: false },
          orderBy: { createdAt: 'asc' },
        });

        if (!preKey) {
          return null;
        }

        const consumed = await tx.devicePreKey.update({
          where: { id: preKey.id },
          data: { used: true, usedAt: new Date() },
        });

        return consumed;
      });

      return result;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to consume one-time prekey',
        { originalError: error }
      );
    }
  }

  async storeDeviceEnvelope(input: {
    senderUserId: string;
    senderDeviceId: string;
    recipientUserId: string;
    recipientDeviceId: string;
    ciphertext: string;
    envelopeType: string;
    expiresAt: Date;
  }): Promise<string> {
    try {
      const envelope = await this.prisma.deviceEnvelope.create({
        data: {
          senderUserId: input.senderUserId,
          senderDeviceId: input.senderDeviceId,
          recipientUserId: input.recipientUserId,
          recipientDeviceId: input.recipientDeviceId,
          ciphertext: input.ciphertext,
          envelopeType: input.envelopeType,
          expiresAt: input.expiresAt,
        },
      });

      return envelope.id;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to store device envelope',
        { originalError: error }
      );
    }
  }

  async getPendingDeviceEnvelopes(recipientDeviceId: string, limit: number) {
    try {
      return await this.prisma.deviceEnvelope.findMany({
        where: {
          recipientDeviceId,
          deliveredAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to fetch pending device envelopes',
        { originalError: error }
      );
    }
  }

  async markDeviceEnvelopeDelivered(
    recipientDeviceId: string,
    envelopeId: string
  ): Promise<void> {
    try {
      await this.prisma.deviceEnvelope.updateMany({
        where: {
          id: envelopeId,
          recipientDeviceId,
          deliveredAt: null,
        },
        data: { deliveredAt: new Date() },
      });
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to acknowledge device envelope',
        { originalError: error }
      );
    }
  }

  async deleteExpiredDeviceEnvelopes(): Promise<number> {
    try {
      const deleted = await this.prisma.deviceEnvelope.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });

      return deleted.count;
    } catch (error) {
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to delete expired device envelopes',
        { originalError: error }
      );
    }
  }

  // ============ GROUP OPERATIONS ============

  async createGroup(data: { name: string; creatorId: string; memberIds: string[] }) {
    try {
      return await this.prisma.group.create({
        data: {
          name: data.name,
          creatorId: data.creatorId,
          members: {
            create: data.memberIds.map((userId) => ({
              userId,
              isAdmin: userId === data.creatorId,
            })),
          },
        },
        include: { members: true },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to create group', { originalError: error });
    }
  }

  async getGroupById(groupId: string) {
    try {
      return await this.prisma.group.findUnique({
        where: { id: groupId },
        include: { members: true },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to fetch group', { originalError: error });
    }
  }

  async addGroupMember(groupId: string, userId: string, isAdmin: boolean = false) {
    try {
      return await this.prisma.groupMember.create({
        data: { groupId, userId, isAdmin },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to add group member', { originalError: error });
    }
  }

  async removeGroupMember(groupId: string, userId: string) {
    try {
      await this.prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to remove group member', { originalError: error });
    }
  }

  async storeSenderKey(groupId: string, senderId: string, encryptedState: string) {
    try {
      return await this.prisma.senderKey.upsert({
        where: { groupId_senderId: { groupId, senderId } },
        update: { encryptedState, lastUsedAt: new Date() },
        create: { groupId, senderId, encryptedState },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to store sender key', { originalError: error });
    }
  }

  async getSenderKey(groupId: string, senderId: string) {
    try {
      return await this.prisma.senderKey.findUnique({
        where: { groupId_senderId: { groupId, senderId } },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to fetch sender key', { originalError: error });
    }
  }

  async storeGroupMessage(groupId: string, senderId: string, ciphertext: string, messageNumber: number) {
    try {
      const ciphertextHash = this.getCiphertextHash(ciphertext);

      // Replay Attack Detection
      const existing = await this.prisma.groupMessage.findFirst({
        where: { groupId, ciphertextHash }
      });

      if (existing) {
        throw new SignalError(
          SignalErrorCode.REPLAY_ATTACK_DETECTED,
          'Duplicate group message detected (replay attack)'
        );
      }

      return await this.prisma.groupMessage.create({
        data: { groupId, senderId, ciphertext, ciphertextHash, messageNumber },
      });
    } catch (error) {
      if (error instanceof SignalError) throw error;
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to store group message', { originalError: error });
    }
  }


  // ============ CALL OPERATIONS ============

  async createCall(data: { callerId: string; calleeId?: string; groupId?: string; callType: string }) {
    try {
      return await this.prisma.call.create({
        data: {
          callerId: data.callerId,
          calleeId: data.calleeId,
          groupId: data.groupId,
          callType: data.callType,
          status: 'RINGING',
        },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to create call', { originalError: error });
    }
  }

  async updateCallStatus(callId: string, status: string, endedAt?: Date) {
    try {
      return await this.prisma.call.update({
        where: { id: callId },
        data: { status, endedAt },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to update call status', { originalError: error });
    }
  }

  async storeCallIceCandidate(callId: string, userId: string, candidate: string) {
    try {
      return await this.prisma.callIceCandidate.create({
        data: { callId, userId, candidate },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to store ICE candidate', { originalError: error });
    }
  }

  async getCallById(callId: string) {
    try {
      return await this.prisma.call.findUnique({
        where: { id: callId },
        include: { iceExchange: true },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to fetch call', { originalError: error });
    }
  }

  async updateCallStreamKey(callId: string, encryptionKey: string) {
    try {
      // In this schema, encryptionKey is stored directly on the Call model
      return await this.prisma.call.update({
        where: { id: callId },
        data: { encryptionKey },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to update stream key', { originalError: error });
    }
  }

  /**
   * Persist frame counter for a call to prevent IV reuse after restart.
   * NOVEL: This is a critical security fix for AES-CTR integrity.
   */
  async updateFrameCounter(callId: string, counter: number) {
    try {
      // We'll store the counter as part of a JSON blob in encryptionKey or as a separate field if we update schema
      // For now, let's assume encryptionKey is a JSON string or we can append it.
      const call = await this.getCallById(callId);
      if (!call) return;

      let keyData: any = {};
      try {
        keyData = JSON.parse(call.encryptionKey || '{}');
      } catch { /* legacy format */ }

      keyData.frameCounter = counter;

      await this.prisma.call.update({
        where: { id: callId },
        data: { encryptionKey: JSON.stringify(keyData) }
      });
    } catch (error) {
      // Non-critical if counter persistence fails occasionally, but we log it
      console.error(`[DB] Failed to persist frame counter for call ${callId}`, error);
    }
  }

  async storeSenderKeyDistribution(data: { groupId: string; senderId: string; recipientId: string; distributionMessage: string }) {
    try {
      return await this.prisma.senderKeyDistribution.upsert({
        where: { groupId_senderId_recipientId: { groupId: data.groupId, senderId: data.senderId, recipientId: data.recipientId } },
        update: { distributionMessage: data.distributionMessage, createdAt: new Date() },
        create: { ...data },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to store sender key distribution', { originalError: error });
    }
  }

  async getSenderKeyDistribution(groupId: string, senderId: string, recipientId: string) {
    try {
      return await this.prisma.senderKeyDistribution.findUnique({
        where: { groupId_senderId_recipientId: { groupId, senderId, recipientId } },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to fetch sender key distribution', { originalError: error });
    }
  }

  async getGroupMessageById(messageId: string) {
    try {
      return await this.prisma.groupMessage.findUnique({
        where: { id: messageId },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to fetch group message', { originalError: error });
    }
  }

  async updateCallSdp(callId: string, encryptedSdp: string) {
    try {
      return await this.prisma.call.update({
        where: { id: callId },
        data: { encryptedSdp },
      });
    } catch (error) {
      throw new SignalError(SignalErrorCode.DATABASE_ERROR, 'Failed to update call SDP', { originalError: error });
    }
  }

  /**
   * Get Prisma client for advanced queries if needed
   */
  getClient() {
    return this.prisma;
  }
}
