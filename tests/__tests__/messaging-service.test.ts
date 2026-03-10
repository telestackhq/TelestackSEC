import { MessagingService } from '../../src/services/messaging-service';
import { SignalErrorCode } from '../../src/types';

jest.mock('../../src/crypto/signal-protocol', () => ({
  SignalProtocol: {
    generateIdentityKeyPair: jest.fn(async () => ({
      publicKey: 'ephemeral-public',
      privateKey: 'ephemeral-private',
    })),
    initiateSenderSession: jest.fn(async () => ({
      sessionState: JSON.stringify({ rootKey: 'r', sendingChainKey: 's', receivingChainKey: 's', sendingCounter: 0, receivingCounter: 0, skippedMessageKeys: {} }),
      sharedSecret: 'shared',
    })),
    encryptMessage: jest.fn(async (message: string) => ({
      ciphertext: `cipher:${message}`,
      updatedSessionState: JSON.stringify({ updated: true }),
    })),
    decryptMessage: jest.fn(async (ciphertext: string) => ({
      message: ciphertext.replace('cipher:', ''),
      updatedSessionState: JSON.stringify({ updated: true }),
    })),
  },
}));

const mockDb = {
  getSession: jest.fn(),
  getSessionById: jest.fn(),
  storeSession: jest.fn(),
  storeMessage: jest.fn(),
  getAndConsumePreKey: jest.fn(),
  isMessageProcessed: jest.fn(),
  markMessageProcessed: jest.fn(),
  getClient: jest.fn(),
};

const mockCrypto = {
  decryptData: jest.fn((value: string) => value),
  encryptData: jest.fn((value: string) => value),
};

const mockUserService = {
  getUser: jest.fn(),
  getIdentityKeyPair: jest.fn(),
  getActiveSignedPreKey: jest.fn(),
};

describe('MessagingService', () => {
  let service: MessagingService;
  const mockSession = {
    id: 's1',
    userAId: 'a',
    userBId: 'b',
    encryptedState: JSON.stringify({ state: true }),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb.getClient.mockReturnValue({
      session: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    });

    mockUserService.getUser.mockResolvedValue({});
    mockUserService.getIdentityKeyPair.mockResolvedValue({
      publicKey: 'id-pub',
      encryptedPrivateKey: 'id-enc-priv',
    });
    mockUserService.getActiveSignedPreKey.mockResolvedValue({
      id: 1,
      publicKey: 'signed-prekey-public',
      encryptedPrivateKey: 'signed-prekey-private',
    });

    mockDb.getAndConsumePreKey.mockResolvedValue({
      id: 10,
      publicKey: 'one-time-prekey',
      encryptedPrivateKey: 'enc',
    });
    mockDb.storeMessage.mockResolvedValue('m1');

    service = new MessagingService(
      mockDb as any,
      mockCrypto as any,
      mockUserService as any,
      true
    );
  });

  it('creates session when missing and encrypts message', async () => {
    mockDb.getSession.mockResolvedValue(null);
    mockDb.storeSession.mockResolvedValue('s1');
    mockDb.getSessionById.mockResolvedValue(mockSession);

    const response = await service.encrypt({
      from: 'a',
      to: 'b',
      message: 'hello',
    });

    expect(response.ciphertext).toBe('cipher:hello');
    expect(response.sessionId).toBe('s1');
    expect(mockDb.storeSession).toHaveBeenCalled();
  });

  it('decrypts message and records replay state', async () => {
    mockDb.getSessionById.mockResolvedValue(mockSession);
    mockDb.isMessageProcessed.mockResolvedValue(false);
    mockDb.markMessageProcessed.mockResolvedValue(undefined);

    const response = await service.decrypt({
      to: 'a',
      ciphertext: 'cipher:hello',
      sessionId: 's1',
    });

    expect(response.message).toBe('hello');
    expect(response.from).toBe('b');
    expect(mockDb.markMessageProcessed).toHaveBeenCalledWith(
      's1',
      'a',
      'cipher:hello'
    );
  });

  it('rejects duplicate ciphertext replay', async () => {
    mockDb.getSessionById.mockResolvedValue(mockSession);
    mockDb.isMessageProcessed.mockResolvedValue(true);

    await expect(
      service.decrypt({
        to: 'a',
        ciphertext: 'cipher:hello',
        sessionId: 's1',
      })
    ).rejects.toMatchObject({
      code: SignalErrorCode.REPLAY_ATTACK_DETECTED,
    });
  });
});
