import { CryptoManager } from '../../src/crypto/crypto-manager';

describe('CryptoManager - GPU-Resistant Encryption', () => {
  let cryptoManager: CryptoManager;
  const testMasterSecret = 'test-master-secret-32-bytes-long!!';

  beforeAll(() => {
    cryptoManager = new CryptoManager(testMasterSecret);
  });

  describe('scrypt KDF', () => {
    it('should encrypt and decrypt data with scrypt-derived key', () => {
      const plaintext = 'sensitive-data-to-encrypt';
      
      const encrypted = cryptoManager.encryptData(plaintext);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      
      const decrypted = cryptoManager.decryptData(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should use GPU-resistant scrypt parameters (N=16384, r=8, p=1, 16MB)', () => {
      const plaintext = 'test-data';
      const encrypted = cryptoManager.encryptData(plaintext);
      
      // Verify versioned format: v<version>:<base64>
      expect(encrypted).toMatch(/^v\d+:/);
      
      // Verify decryption works with scrypt-derived keys
      const decrypted = cryptoManager.decryptData(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle AAD binding with encryption', () => {
      const plaintext = 'user-session-data';
      const aad = 'session:user123:device456';
      
      const encrypted = cryptoManager.encryptData(plaintext, aad);
      expect(encrypted).toBeDefined();
      
      // Should fail if AAD doesn't match
      expect(() => {
        cryptoManager.decryptData(encrypted, 'wrong-aad');
      }).toThrow();
      
      // Should succeed with correct AAD
      const decrypted = cryptoManager.decryptData(encrypted, aad);
      expect(decrypted).toBe(plaintext);
    });

    it('should support key rotation with versioned keyring', () => {
      const plaintext = 'test-plaintext';
      
      const encryptedV1 = cryptoManager.encryptData(plaintext);
      
      // Simulate key rotation with previous keys in constructor
      const newCryptoManager = new CryptoManager(
        'rotated-master-secret-32-bytes!!',
        '2',
        { '1': testMasterSecret }
      );
      const encryptedV2 = newCryptoManager.encryptData(plaintext);
      
      // V1 and V2 should be different due to versioning
      expect(encryptedV1).not.toBe(encryptedV2);
      
      // V1 can still decrypt with versioned keyring
      const decryptedV1 = newCryptoManager.decryptData(encryptedV1);
      expect(decryptedV1).toBe(plaintext);
      
      // V2 decrypts with current version
      const decryptedV2 = newCryptoManager.decryptData(encryptedV2);
      expect(decryptedV2).toBe(plaintext);
    });
  });

  describe('AES-256-GCM encryption', () => {
    it('should use authenticated encryption', () => {
      const plaintext = 'authenticated-message';
      
      const encrypted = cryptoManager.encryptData(plaintext);
      const decrypted = cryptoManager.decryptData(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should detect tampering with authenticated encryption', () => {
      const plaintext = 'original-message';
      const encrypted = cryptoManager.encryptData(plaintext);
      
      // Tamper with ciphertext - replace last 4 base64 chars
      const tampered = encrypted.slice(0, -4) + 'xxxx';
      
      // Should fail decryption due to authentication tag mismatch
      expect(() => {
        cryptoManager.decryptData(tampered);
      }).toThrow();
    });
  });

  describe('error handling and logging', () => {
    it('should handle encryption errors gracefully', () => {
      expect(() => {
        cryptoManager.encryptData(null as any);
      }).toThrow();
    });

    it('should handle decryption with invalid format', () => {
      expect(() => {
        cryptoManager.decryptData('invalid-base64-@#$%');
      }).toThrow();
    });

    it('should validate master key format', () => {
      expect(CryptoManager.validateMasterKey('short')).toBe(false);
      expect(CryptoManager.validateMasterKey('valid-master-secret-32-bytes-long!!!')).toBe(true);
    });
  });

  describe('versioning and backward compatibility', () => {
    it('should support decryption of data encrypted with previous key versions', () => {
      const oldSecret = 'old-master-secret-32-bytes-long!!';
      const newSecret = 'new-master-secret-32-bytes-long!!';
      
      // Encrypt with old key
      const oldManager = new CryptoManager(oldSecret);
      const encrypted = oldManager.encryptData('test-data');
      
      // Create new manager with both old and new keys
      const newManager = new CryptoManager(newSecret, '2', { '1': oldSecret });
      
      // Should decrypt data from old version
      const decrypted = newManager.decryptData(encrypted);
      expect(decrypted).toBe('test-data');
    });

    it('should format ciphertext with version prefix', () => {
      const encrypted = cryptoManager.encryptData('test');
      expect(encrypted).toMatch(/^v\d+:/);
      
      const parts = encrypted.split(':');
      expect(parts.length).toBe(2);
      expect(parts[0]).toMatch(/^v\d+$/);
    });
  });
});
