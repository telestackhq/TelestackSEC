import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import { DatabaseService } from './db/database-service';
import { CryptoManager } from './crypto/crypto-manager';
import {
  UserService,
  MessagingService,
  SessionService,
  AdminService,
  DeviceRelayService,
  GroupService,
  CallService,
} from './services';
import {
  TelestackSECConfig,
  SignalError,
  SignalErrorCode,
  EncryptOptions,
  DecryptOptions,
  DeviceRegisterOptions,
  DevicePreKeyBundleUploadOptions,
  RelayEnvelopeSubmitOptions,
  CreateGroupOptions,
  AddGroupMembersOptions,
  RemoveGroupMemberOptions,
  GroupMessageOptions,
  CallOptions,
  CallAnswerOptions,
  CallIceOptions,
} from './types';

/**
 * Main TelestackSEC class
 * Simple, reactive, and developer-friendly API for end-to-end encrypted messaging.
 * 
 * @example
 * const signal = new TelestackSEC({ databaseUrl: '...' });
 * await signal.initialize();
 * 
 * signal.on('message', (decrypted) => {
 *   console.log(`From ${decrypted.from}: ${decrypted.message}`);
 * });
 */
export class SignalSDK extends EventEmitter {
  private config: TelestackSECConfig;
  private db: DatabaseService;
  private cryptoManager: CryptoManager;
  private userService: UserService;
  private messagingService: MessagingService;
  private sessionService: SessionService;
  private adminService: AdminService;
  private deviceRelayService: DeviceRelayService;
  private groupService!: GroupService;
  private callService!: CallService;
  private initialized = false;
  private socket: Socket | null = null;

  // Public API namespaces
  public user!: {
    register: (email: string) => Promise<any>;
    delete: (userId: string) => Promise<void>;
    getPublicKey: (userId: string) => Promise<string>;
  };

  public session!: {
    reset: (userId1: string, userId2: string) => Promise<void>;
    getStatus: (userId1: string, userId2: string) => Promise<any>;
    list: (userId: string) => Promise<any>;
  };

  public admin!: {
    rotatePrekeys: (userId: string, retentionDays?: number) => Promise<any>;
    cleanupUsedPrekeys: (userId: string, retentionDays?: number) => Promise<any>;
    health: () => Promise<any>;
    getDiagnostics: () => Promise<any>;
  };

  public device!: {
    register: (options: DeviceRegisterOptions) => Promise<any>;
    uploadPreKeyBundle: (options: DevicePreKeyBundleUploadOptions) => Promise<void>;
    getPreKeyBundle: (deviceId: string) => Promise<any>;
    sendEnvelope: (options: RelayEnvelopeSubmitOptions) => Promise<any>;
    fetchPendingEnvelopes: (recipientDeviceId: string, limit?: number) => Promise<any>;
    ackEnvelope: (recipientDeviceId: string, envelopeId: string) => Promise<void>;
    pruneExpiredEnvelopes: () => Promise<number>;
  };

  public group!: {
    create: (options: CreateGroupOptions) => Promise<any>;
    addMembers: (options: AddGroupMembersOptions) => Promise<any>;
    removeMember: (options: RemoveGroupMemberOptions) => Promise<any>;
    send: (options: GroupMessageOptions) => Promise<any>;
    receive: (groupId: string, recipientId: string, messageId: string) => Promise<any>;
    getInfo: (groupId: string) => Promise<any>;
  };

  public call!: {
    initiate: (options: CallOptions) => Promise<any>;
    answer: (options: CallAnswerOptions) => Promise<any>;
    exchangeIce: (options: CallIceOptions) => Promise<void>;
    end: (callId: string, userId: string) => Promise<void>;
    getStreamKey: (callId: string, userId: string) => Promise<any>;
    encryptFrame: (frame: Buffer, streamKey: any) => Buffer;
    decryptFrame: (frame: Buffer, streamKey: any, frameNumber: number) => Buffer;
  };

  /**
   * Initialize TelestackSEC
   */
  constructor(config: TelestackSECConfig) {
    super();
    this.validateConfig(config);
    this.config = config;

    // Apply defaults
    if (!this.config.masterKey) {
      this.config.masterKey = process.env.MASTER_KEY;
    }
    if (!this.config.maxPrekeys) {
      this.config.maxPrekeys = 50;
    }
    if (!this.config.prekeysThreshold) {
      this.config.prekeysThreshold = 20;
    }
    if (this.config.messageHistoryEnabled === undefined) {
      this.config.messageHistoryEnabled = true;
    }
    if (!this.config.logLevel) {
      this.config.logLevel = 'info';
    }
    if (!this.config.masterKeyVersion) {
      this.config.masterKeyVersion = '1';
    }
    if (!this.config.previousMasterKeys) {
      this.config.previousMasterKeys = {};
    }

    // Initialize services
    this.db = new DatabaseService(this.config.databaseUrl);
    this.cryptoManager = new CryptoManager(
      this.config.masterKey!,
      this.config.masterKeyVersion,
      this.config.previousMasterKeys
    );
    this.userService = new UserService(
      this.db,
      this.cryptoManager,
      this.config.maxPrekeys
    );
    this.messagingService = new MessagingService(
      this.db,
      this.cryptoManager,
      this.userService,
      this.config.messageHistoryEnabled,
      this.config.relayUrl,
      this.config.relayAuthKey
    );
    this.sessionService = new SessionService(this.db);
    this.adminService = new AdminService(this.db, this.userService);
    this.groupService = new GroupService(this.db, this.cryptoManager);
    this.callService = new CallService(this.db, this.cryptoManager, this.messagingService);

    // Expose group API immediately
    this.group = {
      create: (options) => this.groupService.createGroup(options),
      addMembers: (options) => this.groupService.addMembers(options),
      removeMember: (options) => this.groupService.removeMember(options),
      getInfo: (groupId) => this.groupService.getGroupInfo(groupId),
      send: (options) => this.groupService.sendGroupMessage(options),
      receive: (groupId, recipientId, messageId) =>
        this.groupService.receiveGroupMessage(groupId, recipientId, messageId),
    };

    // Expose call API immediately
    this.call = {
      initiate: (options) => this.callService.initiateCall(options),
      answer: (options) => this.callService.answerCall(options),
      exchangeIce: (options) => this.callService.exchangeIceCandidate(options),
      end: (callId, userId) => this.callService.endCall(callId, userId),
      getStreamKey: (callId, userId) => this.callService.getStreamKey(callId, userId),
      encryptFrame: (frame, streamKey) => this.callService.encryptFrame(frame, streamKey),
      decryptFrame: (frame, streamKey, frameNumber) =>
        this.callService.decryptFrame(frame, streamKey, frameNumber),
    };
    this.deviceRelayService = new DeviceRelayService(this.db);

    this.setupPublicAPI();
  }

  /**
   * Initialize database connection and internal services.
   */
  async initialize(): Promise<void> {
    try {
      if (this.initialized) return;

      await this.db.initialize();

      this.initialized = true;
      this.log('info', '✓ TelestackSEC initialized successfully');

    } catch (error) {
      this.log('error', '✗ Failed to initialize TelestackSEC');
      throw error;
    }
  }

  /**
   * Start listening for messages for a specific user.
   * NOVEL: Service mode now uses WebSockets for real-time delivery.
   */
  public async listen(userId: string): Promise<void> {
    this.checkInitialized();
    if (this.socket) this.socket.disconnect();

    if (!this.config.relayUrl) {
      this.log('warn', 'relayUrl not provided. Falling back to internal DB check (one-time).');
      await this.processPendingMessages(userId);
      return;
    }

    this.log('info', `👂 Connecting to Relay Hub for user ${userId}...`);

    this.socket = io(this.config.relayUrl);

    this.socket.on('connect', () => {
      this.log('info', 'Connected to Relay Hub');
      this.socket?.emit('register', userId);
    });

    this.socket.on('message', async (msg: any) => {
      try {
        const decrypted = await this.decrypt({
          to: userId,
          ciphertext: msg.ciphertext,
          sessionId: msg.sessionId
        });

        this.emit('message', decrypted);
        this.log('debug', `Real-time message from ${decrypted.from} received via push.`);
      } catch (e) {
        this.emit('error', e);
      }
    });

    this.socket.on('disconnect', () => {
      this.log('warn', 'Disconnected from Relay Hub');
    });

    this.socket.on('connect_error', (err) => {
      this.emit('error', new Error(`Connection error: ${err.message}`));
    });

    // Also process any missed messages while offline
    await this.processPendingMessages(userId);
  }

  /**
   * Stop listening for messages
   */
  public stopListening(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.log('info', 'Stopped listening (WebSocket disconnected)');
    }
  }

  /**
   * Internal helper to process any messages already in DB (online/offline sync)
   */
  private async processPendingMessages(userId: string): Promise<void> {
    try {
      const messages = await this.db.getClient().message.findMany({
        where: { toUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20
      });

      for (const msg of messages) {
        const isProcessed = await this.db.isMessageProcessed("SYNC", userId, msg.ciphertext);
        if (isProcessed) continue;

        try {
          const session = await this.db.getSession(msg.fromUserId, userId);
          if (!session) continue;

          const decrypted = await this.decrypt({
            to: userId,
            ciphertext: msg.ciphertext,
            sessionId: session.id
          });

          this.emit('message', decrypted);
          this.log('debug', `Synced historical message from ${decrypted.from}.`);
        } catch (e) { /* skip sync errors */ }
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * Encrypt a message
   */
  async encrypt(options: EncryptOptions) {
    this.checkInitialized();
    return this.messagingService.encrypt(options);
  }

  /**
   * Decrypt a message
   */
  async decrypt(options: DecryptOptions) {
    this.checkInitialized();
    return this.messagingService.decrypt(options);
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    try {
      this.stopListening();
      await this.db.disconnect();
      this.initialized = false;
      this.log('info', '✓ TelestackSEC disconnected');
    } catch (error) {
      this.log('error', '✗ Failed to disconnect TelestackSEC');
      throw error;
    }
  }

  /**
   * Get database client for advanced queries
   */
  getDatabase() {
    return this.db.getClient();
  }

  /**
   * ========================
   * Private Methods
   * ========================
   */

  private validateConfig(config: TelestackSECConfig): void {
    if (!config.databaseUrl) {
      throw new SignalError(SignalErrorCode.INVALID_CONFIG, 'databaseUrl is required');
    }

    const masterKey = config.masterKey || process.env.MASTER_KEY;
    if (!masterKey) {
      throw new SignalError(SignalErrorCode.INVALID_CONFIG, 'masterKey is required');
    }

    if (!CryptoManager.validateMasterKey(masterKey)) {
      throw new SignalError(SignalErrorCode.INVALID_CONFIG, 'Master key min 32 chars');
    }
  }

  private setupPublicAPI(): void {
    this.user = {
      register: (email: string) => this.userService.register(email),
      delete: (userId: string) => this.userService.deleteUser(userId),
      getPublicKey: (userId: string) => this.userService.getPublicKey(userId),
    };

    this.session = {
      reset: (userId1: string, userId2: string) => this.sessionService.resetSession(userId1, userId2),
      getStatus: (userId1: string, userId2: string) => this.sessionService.getStatus(userId1, userId2),
      list: (userId: string) => this.sessionService.listUserSessions(userId),
    };

    this.admin = {
      rotatePrekeys: (userId: string, rent?: number) => this.adminService.rotatePrekeys(userId, rent),
      cleanupUsedPrekeys: (userId: string, rent?: number) => this.adminService.cleanupUsedPrekeys(userId, rent),
      health: () => this.adminService.health(),
      getDiagnostics: () => this.adminService.getDiagnostics(),
    };

    this.device = {
      register: (o: DeviceRegisterOptions) => this.deviceRelayService.registerDevice(o),
      uploadPreKeyBundle: (o: DevicePreKeyBundleUploadOptions) => this.deviceRelayService.uploadPreKeyBundle(o),
      getPreKeyBundle: (id: string) => this.deviceRelayService.getDevicePreKeyBundle(id),
      sendEnvelope: (o: RelayEnvelopeSubmitOptions) => this.deviceRelayService.sendEnvelope(o),
      fetchPendingEnvelopes: (id: string, l?: number) => this.deviceRelayService.fetchPendingEnvelopes(id, l),
      ackEnvelope: (rid: string, eid: string) => this.deviceRelayService.ackEnvelope(rid, eid),
      pruneExpiredEnvelopes: () => this.deviceRelayService.pruneExpiredEnvelopes(),
    };
  }

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new SignalError(SignalErrorCode.INVALID_CONFIG, 'SDK not initialized');
    }
  }

  private log(level: string, message: string): void {
    const logLevels = { debug: 0, info: 1, warn: 2, error: 3 };
    const currentLevel = logLevels[this.config.logLevel as keyof typeof logLevels] ?? 1;
    const messageLevel = logLevels[level as keyof typeof logLevels] ?? 1;

    if (messageLevel >= currentLevel) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [TelestackSEC:${level.toUpperCase()}] ${message}`);
    }
  }
}

export { SignalSDK as TelestackSEC };
export * from './types';
export { CryptoManager } from './crypto/crypto-manager';
export { SignalProtocol } from './crypto/signal-protocol';
export { DatabaseService } from './db/database-service';
