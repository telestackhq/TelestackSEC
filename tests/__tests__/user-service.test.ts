import { UserService } from '../../src/services/user-service';
import { SignalError, SignalErrorCode } from '../../src/types';

const mockDb = {
  createUser: jest.fn(),
  storeIdentityKey: jest.fn(),
  storePreKeys: jest.fn(),
  storeSignedPreKey: jest.fn(),
  getUserById: jest.fn(),
  getIdentityKey: jest.fn(),
  getActiveSignedPreKey: jest.fn(),
  getUnusedPreKeyCount: jest.fn(),
  deleteUsedPreKeysOlderThan: jest.fn(),
  deleteUser: jest.fn(),
};

const mockCrypto = {
  encryptData: jest.fn((value: string) => `enc:${value}`),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    service = new UserService(mockDb as any, mockCrypto as any, 5);
  });

  it('rejects empty email registration', async () => {
    await expect(service.register('')).rejects.toMatchObject({
      code: SignalErrorCode.INVALID_INPUT,
    });
  });

  it('registers user and returns public profile', async () => {
    mockDb.createUser.mockResolvedValue('u1');
    mockDb.getUserById.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await service.register('alice@example.com');

    expect(response.userId).toBe('u1');
    expect(response.email).toBe('alice@example.com');
    expect(typeof response.publicKey).toBe('string');
    expect(mockDb.storeIdentityKey).toHaveBeenCalled();
    expect(mockDb.storePreKeys).toHaveBeenCalled();
    expect(mockDb.storeSignedPreKey).toHaveBeenCalled();
  });

  it('returns active signed prekey', async () => {
    mockDb.getActiveSignedPreKey.mockResolvedValue({
      id: 4,
      publicKey: 'pub',
      encryptedPrivateKey: 'enc',
    });

    const key = await service.getActiveSignedPreKey('u1');
    expect(key.id).toBe(4);
    expect(key.publicKey).toBe('pub');
  });

  it('throws when active signed prekey missing', async () => {
    mockDb.getActiveSignedPreKey.mockResolvedValue(null);

    await expect(service.getActiveSignedPreKey('u1')).rejects.toMatchObject({
      code: SignalErrorCode.CRYPTO_ERROR,
    });
  });

  it('deletes existing user', async () => {
    mockDb.getUserById.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
      createdAt: new Date(),
    });
    mockDb.deleteUser.mockResolvedValue(undefined);

    await service.deleteUser('u1');
    expect(mockDb.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('wraps unknown errors in SignalError', async () => {
    mockDb.createUser.mockRejectedValue(new Error('db down'));

    await expect(service.register('alice@example.com')).rejects.toBeInstanceOf(
      SignalError
    );
  });
});
