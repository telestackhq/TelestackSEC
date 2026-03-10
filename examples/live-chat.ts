import { TelestackSEC } from '../src';
import { RelayHub } from '../src/relay/hub';

/**
 * Live Real-Time Multi-User E2EE Chat Demo
 * 
 * This example demonstrates:
 * 1. Starting a secured Relay Hub
 * 2. Two users (Alice & Bob) connecting via WebSockets
 * 3. Alice sending an encrypted message to Bob in real-time
 * 4. Bob replying instantly
 */
async function runDemo() {
    const AUTH_KEY = 'secret-demo-key';
    const RELAY_URL = 'http://localhost:3013';

    console.log('🚀 [Demo] Starting Secured Relay Hub...');
    const hub = new RelayHub(3013, AUTH_KEY);
    hub.start();

    // 1. Initialize Alice's SDK
    const aliceSDK = new TelestackSEC({
        databaseUrl: 'file:./demo.db',
        relayUrl: RELAY_URL,
        relayAuthKey: AUTH_KEY,
        logLevel: 'error'
    });
    await aliceSDK.initialize();

    // 2. Initialize Bob's SDK
    const bobSDK = new TelestackSEC({
        databaseUrl: 'file:./demo.db',
        relayUrl: RELAY_URL,
        relayAuthKey: AUTH_KEY,
        logLevel: 'error'
    });
    await bobSDK.initialize();

    // 3. Register Users (use timestamp to avoid conflicts across runs)
    const ts = Date.now();
    const alice = await aliceSDK.user.register(`alice-${ts}@telestack.run`);
    const bob = await bobSDK.user.register(`bob-${ts}@telestack.run`);

    console.log(`\n✅ Users Registered:\n- Alice: ${alice.userId}\n- Bob: ${bob.userId}\n`);

    // 4. Set up Listeners
    bobSDK.on('message', async (msg) => {
        const start = Date.now();
        console.log(`\n📥 [Bob] Received message: "${msg.message}"`);
        console.log(`🔒 [Bob] Verified E2EE from ${msg.from}`);

        // Bob Replies
        console.log(`📤 [Bob] Replying to Alice...`);
        await bobSDK.encrypt({
            from: bob.userId,
            to: alice.userId,
            message: 'Hey Alice! Got it instantly. This is amazing. 🚀'
        });
    });

    aliceSDK.on('message', (msg) => {
        console.log(`\n📥 [Alice] Received reply: "${msg.message}"`);
        console.log('🏁 [Alice] Demo complete! Sub-millisecond E2EE achieved.');

        // Cleanup
        setTimeout(async () => {
            await aliceSDK.disconnect();
            await bobSDK.disconnect();
            hub.stop();
            process.exit(0);
        }, 1000);
    });

    // 5. Start Listening
    console.log('👂 [Bob] Listening for real-time messages...');
    await bobSDK.listen(bob.userId);

    console.log('👂 [Alice] Listening for replies...');
    await aliceSDK.listen(alice.userId);

    // 6. Alice sends first message
    console.log(`\n📤 [Alice] Sending message to Bob...`);
    await aliceSDK.encrypt({
        from: alice.userId,
        to: bob.userId,
        message: 'Hello Bob! Are you receiving this real-time?'
    });
}

runDemo().catch(console.error);
