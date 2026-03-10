/**
 * Type declarations for libsignal package
 * Provides minimal type definitions for libsignal API used in TelestackSEC
 */

declare module 'libsignal' {
  export class IdentityKeyPair {
    static generate(): IdentityKeyPair;
    getPublicKey(): PublicKey;
    getPrivateKey(): PrivateKey;
  }

  export class PublicKey {
    serialize(): Buffer;
    static deserialize(buffer: Buffer): PublicKey;
  }

  export class PrivateKey {
    static deserialize(buffer: Buffer): PrivateKey;
    serialize(): Buffer;
    getPublicKey(): PublicKey;
  }

  export class PreKeyPair {
    static generate(preKeyId: number): PreKeyPair;
    getPublicKey(): PublicKey;
    getPrivateKey(): PrivateKey;
  }

  export class SignedPreKeyPair {
    static generate(identityPrivateKey: PrivateKey, signedPreKeyId: number): SignedPreKeyPair;
    getPublicKey(): PublicKey;
    getPrivateKey(): PrivateKey;
  }

  export class SessionState {
    static deserialize(buffer: Buffer | string): SessionState;
    serialize(): Buffer | string;
  }

  export class Session {
    state: SessionState;
  }

  export class SessionBuilder {
    static create(
      senderIdentityPrivateKey: PrivateKey,
      senderEphemeralPrivateKey: PrivateKey,
      recipientIdentityPublicKey: PublicKey,
      recipientSignedPreKeyPublicKey: PublicKey,
      recipientPreKeyPublicKey?: PublicKey | null
    ): Session;
  }

  export class SessionCipher {
    static create(sessionState: SessionState): SessionCipher;
    encryptMessage(plaintext: Buffer | string): Buffer | string;
    decryptMessage(ciphertext: Buffer | string): Buffer | string;
    getSessionState(): SessionState;
  }

  export interface X3DHResult {
    sessionState: string | Buffer;
    sharedSecret: string | Buffer;
  }

  export function generateIdentityKeyPair(): IdentityKeyPair;
  export function generatePreKeys(startId: number, count: number): PreKeyPair[];
  export function generateSignedPreKey(identityPrivateKey: PrivateKey, signedPreKeyId: number): SignedPreKeyPair;
}
