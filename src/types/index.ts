/**
 * Core type definitions for TelestackSEC.
 */

// Configuration
export interface SignalSDKConfig {
  databaseUrl: string;
  masterKey?: string;
  masterKeyVersion?: string;
  previousMasterKeys?: Record<string, string>;
  maxPrekeys?: number;
  prekeysThreshold?: number;
  messageHistoryEnabled?: boolean;
  sessionExpiryDays?: number | null;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  relayUrl?: string; // WebSocket Relay Hub URL for real-time push
  relayAuthKey?: string; // Secret key for authenticating with the Relay Hub
}

// Preferred project-branded config alias.
export type TelestackSECConfig = SignalSDKConfig;

// User
export interface UserRegisterResponse {
  userId: string;
  email: string;
  publicKey: string;
  createdAt: Date;
}

export interface UserInfo {
  userId: string;
  email: string;
  createdAt: Date;
}

// Message Types
export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  FILE = 'FILE',
  CALL_OFFER = 'CALL_OFFER',
  CALL_ANSWER = 'CALL_ANSWER',
  CALL_ICE_CANDIDATE = 'CALL_ICE_CANDIDATE',
  CALL_HANGUP = 'CALL_HANGUP',
}

export interface MessageContent {
  type: MessageType;
  data: string | Buffer; // Text or base64 encoded binary
  mimeType?: string; // For media files
  fileName?: string; // For file attachments
  duration?: number; // For audio/video (seconds)
  thumbnail?: string; // Base64 encoded thumbnail for media
  metadata?: Record<string, any>; // Additional metadata
}

// Encryption/Decryption
export interface EncryptOptions {
  from: string;
  to: string;
  message: string | MessageContent;
  groupId?: string; // For group messages
}

export interface EncryptResponse {
  ciphertext: string;
  sessionId: string;
  timestamp: Date;
  messageType?: MessageType;
}

export interface DecryptOptions {
  to: string;
  ciphertext: string;
  sessionId: string;
  groupId?: string; // For group messages
}

export interface DecryptResponse {
  message: string | MessageContent;
  from: string;
  sessionId: string;
  timestamp: Date;
  messageType?: MessageType;
}

// Session
export interface SessionStatus {
  sessionId: string;
  userAId: string;
  userBId: string;
  createdAt: Date;
  lastMessageAt: Date;
  isActive: boolean;
}

export interface SessionListResponse {
  sessions: SessionStatus[];
  count: number;
}

// Group Messaging
export interface GroupInfo {
  groupId: string;
  name: string;
  creatorId: string;
  memberIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGroupOptions {
  name: string;
  creatorId: string;
  memberIds: string[]; // Initial members
}

export interface CreateGroupResponse {
  groupId: string;
  name: string;
  creatorId: string;
  memberIds: string[];
  senderKeyDistributed: boolean;
  timestamp: Date;
}

export interface AddGroupMembersOptions {
  groupId: string;
  adminId: string; // Who is adding members
  memberIds: string[]; // New members to add
}

export interface RemoveGroupMemberOptions {
  groupId: string;
  adminId: string; // Who is removing
  memberId: string; // Member to remove
}

export interface GroupMessageOptions {
  groupId: string;
  senderId: string;
  message: string | MessageContent;
}

export interface GroupMessageResponse {
  groupId: string;
  messageId: string;
  senderId: string;
  timestamp: Date;
  deliveredTo: string[]; // List of member IDs
}

// Call Encryption
export interface CallOptions {
  callerId: string;
  calleeId: string;
  callType: 'AUDIO' | 'VIDEO';
  sdpOffer?: string; // SDP for WebRTC
}

export interface CallResponse {
  callId: string;
  sessionId: string;
  encryptedSdp: string;
  timestamp: Date;
}

export interface CallAnswerOptions {
  callId: string;
  calleeId: string;
  sdpAnswer: string;
}

export interface CallIceOptions {
  callId: string;
  userId: string;
  candidate: string; // ICE candidate JSON
}

export interface StreamEncryptionKey {
  key: Buffer;
  iv: Buffer;
  frameCounter: number;
  callId?: string;
}

// Keys
export interface IdentityKeyPair {
  publicKey: string;
  privateKey: string; // Encrypted in storage
}

export interface PreKeyPair {
  id: number;
  publicKey: string;
  privateKey: string; // Encrypted in storage
}

// Health/Admin
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  timestamp: Date;
  message?: string;
}

export interface AdminPrekeyRotationResponse {
  userId: string;
  newPrekeysGenerated: number;
  oldPrekeysRemoved: number;
  timestamp: Date;
}

export interface AdminPrekeyCleanupResponse {
  userId: string;
  removedPrekeys: number;
  cutoffDate: Date;
  timestamp: Date;
}

// Device trust-mode (client-side keys) contracts
export interface DeviceRegisterOptions {
  userId: string;
  name: string;
  identityPublicKey: string;
  registrationId: number;
  isPrimary?: boolean;
}

export interface DeviceRegisterResponse {
  deviceId: string;
  userId: string;
  name: string;
  identityPublicKey: string;
  registrationId: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface DevicePreKeyUpload {
  keyId: number;
  publicKey: string;
}

export interface DeviceSignedPreKeyUpload {
  keyId: number;
  publicKey: string;
  signature: string;
}

export interface DevicePreKeyBundleUploadOptions {
  deviceId: string;
  signedPreKey: DeviceSignedPreKeyUpload;
  oneTimePreKeys: DevicePreKeyUpload[];
}

export interface DevicePreKeyBundle {
  deviceId: string;
  userId: string;
  identityPublicKey: string;
  registrationId: number;
  signedPreKey: DeviceSignedPreKeyUpload;
  oneTimePreKey?: DevicePreKeyUpload;
}

export interface RelayEnvelopeSubmitOptions {
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  ciphertext: string;
  envelopeType: 'prekey' | 'message';
  ttlSeconds?: number;
}

export interface RelayEnvelope {
  envelopeId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  ciphertext: string;
  envelopeType: 'prekey' | 'message';
  createdAt: Date;
}

// Errors
export enum SignalErrorCode {
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
  SESSION_INIT_FAILED = 'SESSION_INIT_FAILED',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INVALID_CONFIG = 'INVALID_CONFIG',
  PREKEY_NOT_FOUND = 'PREKEY_NOT_FOUND',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  CRYPTO_ERROR = 'CRYPTO_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
  REPLAY_ATTACK_DETECTED = 'REPLAY_ATTACK_DETECTED',
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class SignalError extends Error {
  constructor(
    public code: SignalErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SignalError';
  }
}
