import { DatabaseService } from '../../src/db/database-service';

describe('DatabaseService', () => {
  it('produces deterministic ciphertext hashes', () => {
    const db = new DatabaseService();
    const c1 = 'ciphertext-a';
    const c2 = 'ciphertext-a';
    const c3 = 'ciphertext-b';

    expect(db.getCiphertextHash(c1)).toBe(db.getCiphertextHash(c2));
    expect(db.getCiphertextHash(c1)).not.toBe(db.getCiphertextHash(c3));
  });

  it('exposes prisma client accessor', () => {
    const db = new DatabaseService();
    const client = db.getClient();
    expect(client).toBeDefined();
  });
});
