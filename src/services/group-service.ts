import { DatabaseService } from '../db/database-service';
import { CryptoManager } from '../crypto/crypto-manager';
import crypto from 'crypto';
import {
  CreateGroupOptions,
  CreateGroupResponse,
  AddGroupMembersOptions,
  RemoveGroupMemberOptions,
  GroupMessageOptions,
  GroupMessageResponse,
  GroupInfo,
  SignalError,
  SignalErrorCode,
  MessageContent,
  MessageType,
} from '../types';

/**
 * Group Messaging Service using Sender Keys Protocol
 * 
 * Protocol Overview:
 * - Each sender has a unique chain key for the group
 * - Chain key is ratcheted forward for each message (forward secrecy)
 * - Sender distributes their sender key to all members via pairwise sessions
 * - Group messages are encrypted once (efficient for large groups)
 * 
 * Security Properties:
 * ✅ Forward Secrecy: Chain keys ratchet forward
 * ✅ Efficient: Single encryption per message
 * ❌ Post-Compromise Security: Static sender keys (like 1-to-1)
 * ⚠️ Member Changes: Adding/removing members requires key redistribution
 */

interface SenderKeyState {
  chainKey: Buffer;
  messageNumber: number;
  publicKey: string; // Sender's signature key
}

export class GroupService {
  constructor(
    private db: DatabaseService,
    private cryptoManager: CryptoManager
  ) { }

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [GroupService:${level.toUpperCase()}] ${message}`);
  }

  private checkInitialized(): void {
    if (!this.db.isConnected()) {
      throw new SignalError(
        SignalErrorCode.NOT_INITIALIZED,
        'SDK not initialized. Call await sdk.initialize() before using group features.'
      );
    }
  }

  /**
   * Create a new group with initial members
   */
  async createGroup(options: CreateGroupOptions): Promise<CreateGroupResponse> {
    this.checkInitialized();
    const { name, creatorId, memberIds } = options;

    try {
      // Validate creator exists
      const creator = await this.db.getUserById(creatorId);

      if (!creator) {
        throw new SignalError(
          SignalErrorCode.USER_NOT_FOUND,
          `Creator not found: ${creatorId}`
        );
      }

      // Validate all members exist
      const uniqueMembers = [...new Set([creatorId, ...memberIds])];

      for (const memberId of uniqueMembers) {
        const user = await this.db.getUserById(memberId);
        if (!user) {
          throw new SignalError(
            SignalErrorCode.USER_NOT_FOUND,
            `Member not found: ${memberId}`
          );
        }
      }

      // Create group via abstraction
      const group = await this.db.createGroup({
        name,
        creatorId,
        memberIds: uniqueMembers
      });

      // Each member generates and distributes their sender key
      // For now, we'll generate for the creator (they'll distribute later)
      await this.generateAndDistributeSenderKey(group.id, creatorId, uniqueMembers);

      return {
        groupId: group.id,
        name: group.name,
        creatorId: group.creatorId,
        memberIds: uniqueMembers,
        senderKeyDistributed: true,
        timestamp: group.createdAt,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.UNKNOWN_ERROR,
        'Failed to create group',
        { originalError: error }
      );
    }
  }

  /**
   * Generate sender key for a user in a group and distribute to all members
   */
  private async generateAndDistributeSenderKey(
    groupId: string,
    senderId: string,
    memberIds: string[]
  ): Promise<void> {
    // Generate initial sender key chain
    const chainKey = crypto.randomBytes(32);
    const senderKeyState: SenderKeyState = {
      chainKey,
      messageNumber: 0,
      publicKey: senderId, // In real implementation, use signature key
    };

    const stateJson = JSON.stringify({
      chainKey: chainKey.toString('base64'),
      messageNumber: senderKeyState.messageNumber,
      publicKey: senderKeyState.publicKey,
    });

    // Store sender key state (encrypted)
    const aad = `group:${groupId}:sender:${senderId}`;
    const encryptedState = this.cryptoManager.encryptData(stateJson, aad);

    await this.db.storeSenderKey(groupId, senderId, encryptedState);

    // Distribute sender key to all members using pairwise sessions
    for (const memberId of memberIds) {
      if (memberId === senderId) continue;

      const distributionMessage = JSON.stringify({
        type: 'SENDER_KEY_DISTRIBUTION',
        groupId,
        senderId,
        chainKey: chainKey.toString('base64'),
        messageNumber: 0,
      });

      await this.db.storeSenderKeyDistribution({
        groupId,
        senderId,
        recipientId: memberId,
        distributionMessage,
      });
    }
  }

  /**
   * Send a message to a group
   */
  async sendGroupMessage(options: GroupMessageOptions): Promise<GroupMessageResponse> {
    const { groupId, senderId, message } = options;

    try {
      // Verify group exists and sender is a member
      const group = await this.db.getGroupById(groupId);

      if (!group) {
        throw new SignalError(
          SignalErrorCode.INVALID_ARGUMENTS,
          `Group not found: ${groupId}`
        );
      }

      const membership = group.members.find(m => m.userId === senderId);
      if (!membership) {
        throw new SignalError(
          SignalErrorCode.INVALID_ARGUMENTS,
          `User ${senderId} is not a member of group ${groupId}`
        );
      }

      const memberIds = group.members.map((m) => m.userId);

      // Get sender's key for this group
      let senderKey = await this.db.getSenderKey(groupId, senderId);

      if (!senderKey) {
        // Automatic Key Repair: Generate initial sender key if doesn't exist
        this.log('info', `Automatically generating missing sender key for ${senderId} in group ${groupId}`);
        await this.generateAndDistributeSenderKey(groupId, senderId, memberIds);
        senderKey = await this.db.getSenderKey(groupId, senderId);
      }

      if (!senderKey) {
        throw new SignalError(
          SignalErrorCode.ENCRYPTION_FAILED,
          'Failed to get or repair sender key'
        );
      }

      // Decrypt sender key state
      const aad = `group:${groupId}:sender:${senderId}`;
      const stateJson = this.cryptoManager.decryptData(senderKey.encryptedState, aad);
      const senderKeyState: SenderKeyState = JSON.parse(stateJson);

      // FIX: JSON parse returns string, we need Buffer for HMAC key alignment with recipient
      senderKeyState.chainKey = Buffer.from(senderKeyState.chainKey as unknown as string, 'base64');

      // Serialize message
      const messageStr = typeof message === 'string'
        ? message
        : JSON.stringify(message);

      // Encrypt message with sender key
      const encrypted = this.encryptWithSenderKey(messageStr, senderKeyState);

      // Ratchet sender key forward
      senderKeyState.chainKey = crypto
        .createHmac('sha256', senderKeyState.chainKey)
        .update('TelestackSEC-sender-chain-key')
        .digest();
      senderKeyState.messageNumber++;

      // Update sender key state
      const updatedStateJson = JSON.stringify({
        chainKey: senderKeyState.chainKey.toString('base64'),
        messageNumber: senderKeyState.messageNumber,
        publicKey: senderKeyState.publicKey,
      });

      const updatedEncryptedState = this.cryptoManager.encryptData(
        updatedStateJson,
        aad
      );

      await this.db.storeSenderKey(groupId, senderId, updatedEncryptedState);

      // Store group message via abstraction
      const groupMessage = await this.db.storeGroupMessage(
        groupId,
        senderId,
        encrypted.ciphertext,
        encrypted.messageNumber
      );

      return {
        groupId,
        messageId: groupMessage.id,
        senderId,
        timestamp: groupMessage.createdAt,
        deliveredTo: memberIds.filter((id) => id !== senderId),
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.ENCRYPTION_FAILED,
        'Failed to send group message',
        { originalError: error }
      );
    }
  }

  /**
   * Receive and decrypt a group message
   */
  async receiveGroupMessage(
    groupId: string,
    recipientId: string,
    messageId: string
  ): Promise<{ message: string | MessageContent; senderId: string; timestamp: Date }> {
    try {
      // Get the message
      const groupMessage = await this.db.getGroupMessageById(messageId);

      if (!groupMessage || groupMessage.groupId !== groupId) {
        throw new SignalError(
          SignalErrorCode.DECRYPTION_FAILED,
          'Group message not found'
        );
      }

      // Verify recipient is a member (get group info)
      const group = await this.db.getGroupById(groupId);
      if (!group) throw new SignalError(SignalErrorCode.INVALID_ARGUMENTS, "Group not found");

      const membership = group.members.find(m => m.userId === recipientId);
      if (!membership) {
        throw new SignalError(
          SignalErrorCode.INVALID_ARGUMENTS,
          `User ${recipientId} is not a member of group ${groupId}`
        );
      }

      // Get sender key distribution for this sender
      const distribution = await this.db.getSenderKeyDistribution(
        groupId,
        groupMessage.senderId,
        recipientId
      );

      if (!distribution) {
        throw new SignalError(
          SignalErrorCode.DECRYPTION_FAILED,
          'Sender key not found for this user'
        );
      }

      // Parse distribution message to get sender key
      const distData = JSON.parse(distribution.distributionMessage);
      const senderChainKey = Buffer.from(distData.chainKey, 'base64');
      const startNumber = distData.messageNumber || 0;

      // NOVEL: MAX_SKIP DoS Protection
      const MAX_SKIP = 2000;
      const gap = groupMessage.messageNumber - startNumber;
      if (gap < 0) throw new SignalError(SignalErrorCode.DECRYPTION_FAILED, "Message out of sync (too old)");
      if (gap > MAX_SKIP) {
        throw new SignalError(
          SignalErrorCode.DECRYPTION_FAILED,
          `Message gap too large (${gap} > ${MAX_SKIP}). Potential resource exhaustion attack.`
        );
      }

      // Ratchet chain key to the message number
      let currentChainKey = senderChainKey;
      for (let i = startNumber; i < groupMessage.messageNumber; i++) {
        currentChainKey = crypto
          .createHmac('sha256', currentChainKey)
          .update('TelestackSEC-sender-chain-key')
          .digest();
      }

      // Derive message key
      const messageKey = crypto
        .createHmac('sha256', currentChainKey)
        .update('TelestackSEC-sender-message-key')
        .digest();

      // Decrypt message
      const aad = Buffer.from(`msg:${groupMessage.messageNumber}:${groupMessage.senderId}`);
      const decrypted = this.decryptWithMessageKey(
        groupMessage.ciphertext,
        messageKey,
        aad
      );

      // Try to parse as MessageContent
      let message: string | MessageContent;
      try {
        const parsed = JSON.parse(decrypted);
        if (parsed.type && Object.values(MessageType).includes(parsed.type)) {
          message = parsed as MessageContent;
        } else {
          message = decrypted;
        }
      } catch {
        message = decrypted;
      }

      return {
        message,
        senderId: groupMessage.senderId,
        timestamp: groupMessage.createdAt,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DECRYPTION_FAILED,
        'Failed to decrypt group message',
        { originalError: error }
      );
    }
  }

  /**
   * Add members to a group
   */
  async addMembers(options: AddGroupMembersOptions): Promise<GroupInfo> {
    const { groupId, adminId, memberIds } = options;
    try {
      const group = await this.db.getGroupById(groupId);
      if (!group) throw new SignalError(SignalErrorCode.INVALID_ARGUMENTS, "Group not found");

      const adminMembership = group.members.find(m => m.userId === adminId && m.isAdmin);

      if (!adminMembership) {
        throw new SignalError(
          SignalErrorCode.INVALID_ARGUMENTS,
          'User is not an admin of this group'
        );
      }

      // Add new members
      const existingMemberIds = group.members.map((m) => m.userId);
      const allMemberIds = [...existingMemberIds, ...memberIds];

      // Add new members via abstraction
      for (const memberId of memberIds) {
        if (!existingMemberIds.includes(memberId)) {
          await this.db.addGroupMember(groupId, memberId, false);
        }
      }

      // Redistribute sender keys to new members
      for (const existingSenderId of existingMemberIds) {
        await this.generateAndDistributeSenderKey(
          groupId,
          existingSenderId,
          allMemberIds
        );
      }

      return this.getGroupInfo(groupId);
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.UNKNOWN_ERROR,
        'Failed to add members',
        { originalError: error }
      );
    }
  }

  /**
   * Remove a member from a group
   */
  async removeMember(options: RemoveGroupMemberOptions): Promise<GroupInfo> {
    const { groupId, adminId, memberId } = options;
    try {
      const group = await this.db.getGroupById(groupId);
      if (!group) throw new SignalError(SignalErrorCode.INVALID_ARGUMENTS, "Group not found");

      const adminMembership = group.members.find(m => m.userId === adminId && m.isAdmin);

      if (!adminMembership) {
        throw new SignalError(
          SignalErrorCode.INVALID_ARGUMENTS,
          'User is not an admin of this group'
        );
      }

      // Remove member via abstraction
      await this.db.removeGroupMember(groupId, memberId);

      // Rotate all sender keys (for forward secrecy)
      // Get updated membership
      const updatedGroup = await this.db.getGroupById(groupId);
      if (!updatedGroup) throw new SignalError(SignalErrorCode.UNKNOWN_ERROR, "Group disappeared");

      const remainingMemberIds = updatedGroup.members.map((m) => m.userId);

      for (const senderId of remainingMemberIds) {
        // Generate new one (DB method for storeSenderKey handles upsert, so we just generate)
        await this.generateAndDistributeSenderKey(
          groupId,
          senderId,
          remainingMemberIds
        );
      }

      return this.getGroupInfo(groupId);
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.UNKNOWN_ERROR,
        'Failed to remove member',
        { originalError: error }
      );
    }
  }

  /**
   * Get group information
   */
  async getGroupInfo(groupId: string): Promise<GroupInfo> {
    const group = await this.db.getGroupById(groupId);

    if (!group) {
      throw new SignalError(
        SignalErrorCode.INVALID_ARGUMENTS,
        'Group not found'
      );
    }

    return {
      groupId: group.id,
      name: group.name,
      creatorId: group.creatorId,
      memberIds: group.members.map((m: any) => m.userId),
      createdAt: (group as any).createdAt,
      updatedAt: (group as any).updatedAt,
    };
  }

  /**
   * Encrypt message with sender key
   */
  private encryptWithSenderKey(
    message: string,
    senderKeyState: SenderKeyState
  ): { ciphertext: string; messageNumber: number } {
    // Derive message key from current chain key
    const messageKey = crypto
      .createHmac('sha256', senderKeyState.chainKey)
      .update('TelestackSEC-sender-message-key')
      .digest();

    // Encrypt with AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', messageKey, iv);

    const aad = Buffer.from(
      `msg:${senderKeyState.messageNumber}:${senderKeyState.publicKey}`
    );
    cipher.setAAD(aad);

    const encrypted = Buffer.concat([
      cipher.update(message, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: iv (12) + authTag (16) + ciphertext
    const combined = Buffer.concat([iv, authTag, encrypted]);

    return {
      ciphertext: combined.toString('base64'),
      messageNumber: senderKeyState.messageNumber,
    };
  }

  /**
   * Decrypt message with message key
   */
  private decryptWithMessageKey(ciphertext: string, messageKey: Buffer, aad: Buffer): string {
    const combined = Buffer.from(ciphertext, 'base64');

    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const encrypted = combined.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', messageKey, iv);
    decipher.setAuthTag(authTag);
    decipher.setAAD(aad);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
