import { SignalProtocol } from '../../src/crypto/signal-protocol';

describe('SignalProtocol', () => {
  it('generates identity key pair', async () => {
    const kp = await SignalProtocol.generateIdentityKeyPair();

    expect(typeof kp.publicKey).toBe('string');
    expect(typeof kp.privateKey).toBe('string');
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey.length).toBeGreaterThan(0);
  });

  it('generates signed prekey from identity key pair', async () => {
    const identity = await SignalProtocol.generateIdentityKeyPair();
    const signed = await SignalProtocol.generateSignedPreKey(identity, 7);

    expect(signed.id).toBe(7);
    expect(typeof signed.publicKey).toBe('string');
    expect(typeof signed.privateKey).toBe('string');
    expect(typeof signed.signature).toBe('string');
  });

  it('initializes session and encrypts payload', async () => {
    const alice = await SignalProtocol.generateIdentityKeyPair();
    const bob = await SignalProtocol.generateIdentityKeyPair();
    const aliceEphemeral = await SignalProtocol.generateIdentityKeyPair();
    const bobSigned = await SignalProtocol.generateSignedPreKey(bob, 1);
    const bobPreKey = (await SignalProtocol.generatePreKeys(1, 100))[0];

    const session = await SignalProtocol.initiateSenderSession(
      alice.privateKey,
      aliceEphemeral.privateKey,
      bob.publicKey,
      bobSigned.publicKey,
      bobPreKey.publicKey
    );

    expect(typeof session.sessionState).toBe('string');
    expect(typeof session.sharedSecret).toBe('string');

    const encrypted = await SignalProtocol.encryptMessage('hello', session.sessionState);
    expect(typeof encrypted.ciphertext).toBe('string');
    expect(typeof encrypted.updatedSessionState).toBe('string');
  });

  it('supports one-time prekey omission', async () => {
    const alice = await SignalProtocol.generateIdentityKeyPair();
    const bob = await SignalProtocol.generateIdentityKeyPair();
    const aliceEphemeral = await SignalProtocol.generateIdentityKeyPair();
    const bobSigned = await SignalProtocol.generateSignedPreKey(bob, 1);

    const session = await SignalProtocol.initiateSenderSession(
      alice.privateKey,
      aliceEphemeral.privateKey,
      bob.publicKey,
      bobSigned.publicKey
    );

    const encrypted = await SignalProtocol.encryptMessage('message-without-onetime-prekey', session.sessionState);
    expect(encrypted.ciphertext).toBeDefined();
  });
});
