/**
 * Express.js Example - REST API for Encrypted Messaging
 * 
 * Shows how to use TelestackSEC with Express.js:
 * - User registration endpoint
 * - Message encryption endpoint
 * - Message decryption endpoint
 * - Session management
 */

import express, { Request, Response } from 'express';
import { TelestackSEC, SignalError } from '../src';

const app = express();
const signal = new TelestackSEC({
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost/signal_sdk_db',
  masterKey: process.env.MASTER_KEY || 'my-secure-key-at-least-32-characters-long-',
});

app.use(express.json());

// Error handler middleware
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: any) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      if (error instanceof SignalError) {
        return res.status(400).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  };

// ============ USER ENDPOINTS ============

/**
 * POST /users/register
 * Register a new user
 */
app.post(
  '/users/register',
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await signal.user.register(email);

    res.status(201).json({
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        publicKey: user.publicKey,
        createdAt: user.createdAt,
      },
    });
  })
);

/**
 * GET /users/:userId
 * Get user info
 */
app.get(
  '/users/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const user = await signal.user.getPublicKey(userId);

    res.json({
      userId,
      publicKey: user,
    });
  })
);

/**
 * DELETE /users/:userId
 * Delete user
 */
app.delete(
  '/users/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    await signal.user.delete(userId);

    res.json({ success: true, message: 'User deleted' });
  })
);

// ============ MESSAGING ENDPOINTS ============

/**
 * POST /messages/encrypt
 * Encrypt a message
 */
app.post(
  '/messages/encrypt',
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, message } = req.body;

    if (!from || !to || !message) {
      return res.status(400).json({
        error: 'from, to, and message are required',
      });
    }

    const encrypted = await signal.encrypt({ from, to, message });

    res.json({
      success: true,
      ciphertext: encrypted.ciphertext,
      sessionId: encrypted.sessionId,
      timestamp: encrypted.timestamp,
    });
  })
);

/**
 * POST /messages/decrypt
 * Decrypt a message
 */
app.post(
  '/messages/decrypt',
  asyncHandler(async (req: Request, res: Response) => {
    const { to, ciphertext, sessionId } = req.body;

    if (!to || !ciphertext || !sessionId) {
      return res.status(400).json({
        error: 'to, ciphertext, and sessionId are required',
      });
    }

    const decrypted = await signal.decrypt({ to, ciphertext, sessionId });

    res.json({
      success: true,
      message: decrypted.message,
      from: decrypted.from,
      timestamp: decrypted.timestamp,
    });
  })
);

// ============ SESSION ENDPOINTS ============

/**
 * GET /sessions/:userId
 * List user's sessions
 */
app.get(
  '/sessions/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const sessions = await signal.session.list(userId);

    res.json({
      success: true,
      count: sessions.count,
      sessions: sessions.sessions,
    });
  })
);

/**
 * GET /sessions/:userId1/:userId2
 * Get session status
 */
app.get(
  '/sessions/:userId1/:userId2',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId1, userId2 } = req.params;
    const status = await signal.session.getStatus(userId1, userId2);

    res.json({
      success: true,
      session: status || { message: 'No active session' },
    });
  })
);

/**
 * DELETE /sessions/:userId1/:userId2
 * Reset session
 */
app.delete(
  '/sessions/:userId1/:userId2',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId1, userId2 } = req.params;
    await signal.session.reset(userId1, userId2);

    res.json({ success: true, message: 'Session reset' });
  })
);

// ============ ADMIN ENDPOINTS ============

/**
 * GET /admin/health
 * Health check
 */
app.get(
  '/admin/health',
  asyncHandler(async (req: Request, res: Response) => {
    const health = await signal.admin.health();
    res.json(health);
  })
);

/**
 * POST /admin/prekeys/:userId/rotate
 * Rotate prekeys
 */
app.post(
  '/admin/prekeys/:userId/rotate',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const result = await signal.admin.rotatePrekeys(userId);

    res.json({
      success: true,
      ...result,
    });
  })
);

// Initialize and start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  try {
    await signal.initialize();
    console.log(`✓ TelestackSEC initialized`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await signal.disconnect();
  process.exit(0);
});

export default app;


