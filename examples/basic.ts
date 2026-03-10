/**
 * Basic Example - Complete Encryption/Decryption Flow
 * 
 * Shows:
 * 1. Initialize SDK
 * 2. Register two users
 * 3. Encrypt message from Alice to Bob
 * 4. Decrypt message on Bob's side
 */

import { TelestackSEC } from '../src';

async function main() {
  // Initialize SDK
  const signal = new TelestackSEC({
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost/signal_sdk_db',
    masterKey: process.env.MASTER_KEY || 'my-secure-key-at-least-32-characters-long-',
  });

  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    await signal.initialize();

    // Register users
    console.log('\n👤 Registering users...');
    const alice = await signal.user.register('alice@example.com');
    console.log(`✓ Alice registered: ${alice.userId}`);

    const bob = await signal.user.register('bob@example.com');
    console.log(`✓ Bob registered: ${bob.userId}`);

    // Alice encrypts message to Bob
    console.log('\n🔐 Encrypting message...');
    const encrypted = await signal.encrypt({
      from: alice.userId,
      to: bob.userId,
      message: 'Hello Bob! This is a secret message.',
    });
    console.log(`✓ Message encrypted`);
    console.log(`  Session ID: ${encrypted.sessionId.substring(0, 10)}...`);

    // Bob decrypts message
    console.log('\n🔓 Decrypting message...');
    const decrypted = await signal.decrypt({
      to: bob.userId,
      ciphertext: encrypted.ciphertext,
      sessionId: encrypted.sessionId,
    });
    console.log(`✓ Message decrypted`);
    console.log(`  From: ${decrypted.from.substring(0, 10)}...`);
    console.log(`  Message: "${decrypted.message}"`);

    // Bob replies to Alice
    console.log('\n💬 Bob sends reply...');
    const reply = await signal.encrypt({
      from: bob.userId,
      to: alice.userId,
      message: 'Got it! Thanks for the secret message.',
    });
    console.log(`✓ Reply encrypted`);

    // Alice decrypts reply
    console.log('\n📖 Alice reads reply...');
    const replyDecrypted = await signal.decrypt({
      to: alice.userId,
      ciphertext: reply.ciphertext,
      sessionId: reply.sessionId,
    });
    console.log(`✓ Reply decrypted`);
    console.log(`  Message: "${replyDecrypted.message}"`);

    // Check health
    console.log('\n❤️  Health check...');
    const health = await signal.admin.health();
    console.log(`✓ Status: ${health.status}`);
    console.log(`  Database: ${health.database}`);

    // Clean up
    console.log('\n🧹 Cleaning up...');
    await signal.disconnect();
    console.log('✓ Disconnected');

    console.log('\n✨ Example completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the example
main();


