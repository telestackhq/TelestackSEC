import dotenv from 'dotenv';
dotenv.config();

import { TelestackSEC } from '../src';

async function runMinimalChat() {
    // 1. Initialize once
    const signal = new TelestackSEC({ databaseUrl: process.env.DATABASE_URL! });
    await signal.initialize();

    // 2. Reactive: Listen for messages
    signal.on('message', (decrypted) => {
        console.log(`\n[RECV] From ${decrypted.from}: ${decrypted.message}`);
    });

    // 3. Register users (internal UUIDs created)
    const alice = await signal.user.register('alice@lab.io');
    const bob = await signal.user.register('bob@lab.io');

    // 4. Start service mode for Alice
    await signal.listen(alice.userId);

    // 5. Minimal Code for Security: Bob sends to Alice
    console.log('[SEND] Bob is sending a secure message...');
    await signal.encrypt({
        from: bob.userId,
        to: alice.userId,
        message: 'Hello Alice! This is military-grade security in 10 lines.'
    });

    // Keep alive to see the event response
    setTimeout(async () => {
        await signal.disconnect();
        process.exit(0);
    }, 5000);
}

runMinimalChat().catch(console.error);
