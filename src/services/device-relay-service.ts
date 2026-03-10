import { DatabaseService } from '../db/database-service';
import {
  DeviceRegisterOptions,
  DeviceRegisterResponse,
  DevicePreKeyBundleUploadOptions,
  DevicePreKeyBundle,
  RelayEnvelopeSubmitOptions,
  RelayEnvelope,
  SignalError,
  SignalErrorCode,
} from '../types';

/**
 * DeviceRelayService provides a zero-server-decrypt trust path.
 * The server stores public device key material and relays encrypted envelopes.
 */
export class DeviceRelayService {
  constructor(private db: DatabaseService) {}

  async registerDevice(
    options: DeviceRegisterOptions
  ): Promise<DeviceRegisterResponse> {
    const { userId, name, identityPublicKey, registrationId, isPrimary } = options;

    if (!userId || !name || !identityPublicKey) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'userId, name, and identityPublicKey are required'
      );
    }

    if (!Number.isInteger(registrationId) || registrationId <= 0) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'registrationId must be a positive integer'
      );
    }

    await this.assertUserExists(userId);

    try {
      const created = await this.db.createDevice({
        userId,
        name: name.trim(),
        identityPublicKey,
        registrationId,
        isPrimary: !!isPrimary,
      });

      return {
        deviceId: created.id,
        userId: created.userId,
        name: created.name,
        identityPublicKey: created.identityPublicKey,
        registrationId: created.registrationId,
        isPrimary: created.isPrimary,
        createdAt: created.createdAt,
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          `Device registrationId ${registrationId} already exists for user ${userId}`
        );
      }
      throw error;
    }
  }

  async uploadPreKeyBundle(options: DevicePreKeyBundleUploadOptions): Promise<void> {
    const { deviceId, signedPreKey, oneTimePreKeys } = options;

    if (!deviceId || !signedPreKey || !Array.isArray(oneTimePreKeys)) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'deviceId, signedPreKey, and oneTimePreKeys are required'
      );
    }

    const device = await this.db.getDeviceById(deviceId);
    if (!device) {
      throw new SignalError(
        SignalErrorCode.DEVICE_NOT_FOUND,
        `Device ${deviceId} not found`
      );
    }

    await this.db.storeDeviceSignedPreKey(deviceId, signedPreKey);
    if (oneTimePreKeys.length > 0) {
      await this.db.storeDevicePreKeys(deviceId, oneTimePreKeys);
    }
  }

  async getDevicePreKeyBundle(deviceId: string): Promise<DevicePreKeyBundle> {
    if (!deviceId) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'deviceId is required'
      );
    }

    const device = await this.db.getDeviceById(deviceId);
    if (!device) {
      throw new SignalError(
        SignalErrorCode.DEVICE_NOT_FOUND,
        `Device ${deviceId} not found`
      );
    }

    const signedPreKey = await this.db.getActiveDeviceSignedPreKey(deviceId);
    if (!signedPreKey) {
      throw new SignalError(
        SignalErrorCode.PREKEY_NOT_FOUND,
        `No active signed prekey for device ${deviceId}`
      );
    }

    const oneTimePreKey = await this.db.getAndConsumeDeviceOneTimePreKey(deviceId);

    return {
      deviceId: device.id,
      userId: device.userId,
      identityPublicKey: device.identityPublicKey,
      registrationId: device.registrationId,
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: signedPreKey.publicKey,
        signature: signedPreKey.signature,
      },
      oneTimePreKey: oneTimePreKey
        ? {
            keyId: oneTimePreKey.keyId,
            publicKey: oneTimePreKey.publicKey,
          }
        : undefined,
    };
  }

  async sendEnvelope(options: RelayEnvelopeSubmitOptions): Promise<{ envelopeId: string; expiresAt: Date }> {
    const {
      senderUserId,
      senderDeviceId,
      recipientUserId,
      recipientDeviceId,
      ciphertext,
      envelopeType,
      ttlSeconds,
    } = options;

    if (
      !senderUserId ||
      !senderDeviceId ||
      !recipientUserId ||
      !recipientDeviceId ||
      !ciphertext
    ) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'sender/recipient user+device IDs and ciphertext are required'
      );
    }

    if (envelopeType !== 'prekey' && envelopeType !== 'message') {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'envelopeType must be either prekey or message'
      );
    }

    await this.assertDeviceBelongsToUser(senderDeviceId, senderUserId);
    await this.assertDeviceBelongsToUser(recipientDeviceId, recipientUserId);

    const safeTtlSeconds = Math.min(Math.max(ttlSeconds ?? 7 * 24 * 60 * 60, 60), 30 * 24 * 60 * 60);
    const expiresAt = new Date(Date.now() + safeTtlSeconds * 1000);

    const envelopeId = await this.db.storeDeviceEnvelope({
      senderUserId,
      senderDeviceId,
      recipientUserId,
      recipientDeviceId,
      ciphertext,
      envelopeType,
      expiresAt,
    });

    return { envelopeId, expiresAt };
  }

  async fetchPendingEnvelopes(recipientDeviceId: string, limit: number = 100): Promise<RelayEnvelope[]> {
    if (!recipientDeviceId) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'recipientDeviceId is required'
      );
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'limit must be a positive integer'
      );
    }

    const device = await this.db.getDeviceById(recipientDeviceId);
    if (!device) {
      throw new SignalError(
        SignalErrorCode.DEVICE_NOT_FOUND,
        `Device ${recipientDeviceId} not found`
      );
    }

    const envelopes = await this.db.getPendingDeviceEnvelopes(recipientDeviceId, Math.min(limit, 500));
    return envelopes.map((e: any) => ({
      envelopeId: e.id,
      senderUserId: e.senderUserId,
      senderDeviceId: e.senderDeviceId,
      recipientUserId: e.recipientUserId,
      recipientDeviceId: e.recipientDeviceId,
      ciphertext: e.ciphertext,
      envelopeType: e.envelopeType as 'prekey' | 'message',
      createdAt: e.createdAt,
    }));
  }

  async ackEnvelope(recipientDeviceId: string, envelopeId: string): Promise<void> {
    if (!recipientDeviceId || !envelopeId) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        'recipientDeviceId and envelopeId are required'
      );
    }

    await this.db.markDeviceEnvelopeDelivered(recipientDeviceId, envelopeId);
  }

  async pruneExpiredEnvelopes(): Promise<number> {
    return this.db.deleteExpiredDeviceEnvelopes();
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.db.getUserById(userId);
    if (!user) {
      throw new SignalError(
        SignalErrorCode.USER_NOT_FOUND,
        `User ${userId} not found`
      );
    }
  }

  private async assertDeviceBelongsToUser(deviceId: string, userId: string): Promise<void> {
    const device = await this.db.getDeviceById(deviceId);
    if (!device) {
      throw new SignalError(
        SignalErrorCode.DEVICE_NOT_FOUND,
        `Device ${deviceId} not found`
      );
    }

    if (device.userId !== userId) {
      throw new SignalError(
        SignalErrorCode.INVALID_INPUT,
        `Device ${deviceId} does not belong to user ${userId}`
      );
    }
  }
}
