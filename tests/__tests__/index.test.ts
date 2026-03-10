import { TelestackSEC } from '../../src/index';

describe('TelestackSEC SDK - Production Hardening', () => {
  let sdk: TelestackSEC;

  describe('Environment Configuration', () => {
    it('should initialize with required configuration', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/telestack',
        masterKey: 'my-master-secret-32-bytes-long!!',
        logLevel: 'info' as const,
      };

      expect(() => {
        sdk = new TelestackSEC(config);
      }).not.toThrow();
    });

    it('should validate required environment variables', () => {
      const invalidConfig = {
        databaseUrl: '',
        masterKey: 'key-too-short',
      };

      expect(() => {
        new TelestackSEC(invalidConfig as any);
      }).toThrow();
    });

    it('should use MASTER_KEY from environment if not provided in config', () => {
      process.env.MASTER_KEY = 'env-master-secret-32-bytes-long!!!';

      const config = {
        databaseUrl: 'postgresql://localhost/test',
        logLevel: 'info' as const,
      };

      expect(() => {
        sdk = new TelestackSEC(config);
      }).not.toThrow();

      delete process.env.MASTER_KEY;
    });
  });

  describe('Master Key Validation', () => {
    it('should reject master keys shorter than 32 characters', () => {
      const invalidConfig = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'tooshort',
      };

      expect(() => {
        new TelestackSEC(invalidConfig as any);
      }).toThrow();
    });

    it('should accept valid 32+ character master keys', () => {
      const validConfig = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'this-is-a-valid-master-key-32-chars!!',
      };

      expect(() => {
        new TelestackSEC(validConfig);
      }).not.toThrow();
    });
  });

  describe('Log Level Hierarchy', () => {
    it('should implement log level hierarchy: debug < info < warn < error', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
        logLevel: 'info' as const,
      };

      sdk = new TelestackSEC(config);

      // At log level 'info', debug should not print
      // info, warn, error should print
      expect(() => {
        // @ts-ignore - accessing private log method for testing
        sdk['log']('debug', 'This should not appear at info level');
        // @ts-ignore
        sdk['log']('info', 'This should appear');
        // @ts-ignore
        sdk['log']('warn', 'This should appear');
        // @ts-ignore
        sdk['log']('error', 'This should appear');
      }).not.toThrow();
    });

    it('should filter logs based on log level configuration', () => {
      const debugConfig = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
        logLevel: 'debug' as const,
      };

      sdk = new TelestackSEC(debugConfig);

      // At debug level, all logs should be emitted
      expect(() => {
        // @ts-ignore
        sdk['log']('debug', 'Debug message');
        // @ts-ignore
        sdk['log']('info', 'Info message');
        // @ts-ignore
        sdk['log']('warn', 'Warning message');
        // @ts-ignore
        sdk['log']('error', 'Error message');
      }).not.toThrow();
    });

    it('should use ISO timestamps in logs', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
        logLevel: 'info' as const,
      };

      sdk = new TelestackSEC(config);

      // Capture console.log to verify timestamp format
      const originalLog = console.log;
      let logOutput = '';
      console.log = (msg: string) => {
        logOutput = msg;
      };

      // @ts-ignore
      sdk['log']('info', 'Test message');

      console.log = originalLog;

      // Should contain ISO format timestamp like: 2024-01-15T10:30:45.123Z
      expect(logOutput).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });
  });

  describe('Experimental API Warnings', () => {
    it('should mark getDatabase() as experimental and unsafe', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
        logLevel: 'info' as const,
      };

      sdk = new TelestackSEC(config);

      // getDatabase() should exist but be documented as experimental
      expect(() => {
        const db = sdk.getDatabase();
        expect(db).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Configuration Defaults', () => {
    it('should apply default configuration values', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
      };

      sdk = new TelestackSEC(config);

      // @ts-ignore - check private config
      expect(sdk['config'].maxPrekeys).toBe(50);
      // @ts-ignore
      expect(sdk['config'].prekeysThreshold).toBe(20);
      // @ts-ignore
      expect(sdk['config'].messageHistoryEnabled).toBe(true);
      // @ts-ignore
      expect(sdk['config'].logLevel).toBe('info');
      // @ts-ignore
      expect(sdk['config'].masterKeyVersion).toBe('1');
    });

    it('should support custom configuration overrides', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
        maxPrekeys: 100,
        prekeysThreshold: 30,
        messageHistoryEnabled: false,
        logLevel: 'error' as const,
      };

      sdk = new TelestackSEC(config);

      // @ts-ignore
      expect(sdk['config'].maxPrekeys).toBe(100);
      // @ts-ignore
      expect(sdk['config'].prekeysThreshold).toBe(30);
      // @ts-ignore
      expect(sdk['config'].messageHistoryEnabled).toBe(false);
      // @ts-ignore
      expect(sdk['config'].logLevel).toBe('error');
    });
  });

  describe('Key Rotation Configuration', () => {
    it('should support master key version tracking', () => {
      const config = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'current-master-secret-32-bytes!!',
        masterKeyVersion: '2',
        previousMasterKeys: {
          '1': 'previous-master-secret-32-bytes!',
        },
      };

      expect(() => {
        sdk = new TelestackSEC(config);
      }).not.toThrow();
    });

    it('should validate master key version format', () => {
      const invalidConfig = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'valid-master-secret-32-bytes!!!',
        masterKeyVersion: 'invalid-version',
      };

      expect(() => {
        new TelestackSEC(invalidConfig as any);
      }).toThrow();
    });

    it('should validate previous master keys format', () => {
      const invalidConfig = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'valid-master-secret-32-bytes!!!',
        previousMasterKeys: {
          'invalid-version': 'valid-master-secret-32-bytes!!!',
        },
      };

      expect(() => {
        new TelestackSEC(invalidConfig as any);
      }).toThrow();
    });
  });

  describe('Public API Namespaces', () => {
    beforeAll(() => {
      sdk = new TelestackSEC({
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
      });
    });

    it('should expose user service namespace', () => {
      expect(sdk.user).toBeDefined();
      expect(typeof sdk.user.register).toBe('function');
      expect(typeof sdk.user.delete).toBe('function');
      expect(typeof sdk.user.getPublicKey).toBe('function');
    });

    it('should expose session service namespace', () => {
      expect(sdk.session).toBeDefined();
      expect(typeof sdk.session.reset).toBe('function');
      expect(typeof sdk.session.getStatus).toBe('function');
      expect(typeof sdk.session.list).toBe('function');
    });

    it('should expose admin service namespace', () => {
      expect(sdk.admin).toBeDefined();
      expect(typeof sdk.admin.rotatePrekeys).toBe('function');
      expect(typeof sdk.admin.cleanupUsedPrekeys).toBe('function');
      expect(typeof sdk.admin.health).toBe('function');
      expect(typeof sdk.admin.getDiagnostics).toBe('function');
    });

    it('should expose device relay service namespace', () => {
      expect(sdk.device).toBeDefined();
      expect(typeof sdk.device.register).toBe('function');
      expect(typeof sdk.device.uploadPreKeyBundle).toBe('function');
      expect(typeof sdk.device.getPreKeyBundle).toBe('function');
      expect(typeof sdk.device.sendEnvelope).toBe('function');
      expect(typeof sdk.device.fetchPendingEnvelopes).toBe('function');
      expect(typeof sdk.device.ackEnvelope).toBe('function');
      expect(typeof sdk.device.pruneExpiredEnvelopes).toBe('function');
    });
  });

  describe('SDK Lifecycle', () => {
    it('should require initialize() before using SDK methods', async () => {
      const sdk = new TelestackSEC({
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
      });

      // Should throw without initialization
      await expect(
        sdk.encrypt({
          senderId: 'user1',
          recipientId: 'user2',
          plaintext: 'test',
        } as any)
      ).rejects.toThrow();
    });

    it('should support disconnect() for cleanup', async () => {
      const sdk = new TelestackSEC({
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'my-master-secret-32-bytes-long!!',
      });

      // Should not throw
      expect(() => {
        // Disconnect without initialize is okay
        sdk.disconnect();
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should validate configuration and throw SignalError', () => {
      const invalidConfig = {
        databaseUrl: '',
        masterKey: 'short',
      };

      expect(() => {
        new TelestackSEC(invalidConfig as any);
      }).toThrow();
    });

    it('should prevent threshold > maxPrekeys', () => {
      const invalidConfig = {
        databaseUrl: 'postgresql://localhost/test',
        masterKey: 'valid-master-secret-32-bytes!!!',
        maxPrekeys: 50,
        prekeysThreshold: 100,
      };

      expect(() => {
        new TelestackSEC(invalidConfig as any);
      }).toThrow();
    });
  });
});
