import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

/**
 * TelestackSEC Relay Hub
 * 
 * A central WebSocket server that manages active user connections 
 * and routes real-time push notifications.
 */
export class RelayHub {
    private app = express();
    private httpServer = createServer(this.app);
    private io = new Server(this.httpServer, {
        cors: { origin: '*' }
    });

    // Maps userId to socketId
    private activeUsers = new Map<string, string>();

    constructor(
        private port: number = 3001,
        private authKey?: string
    ) {
        // In production, RELAY_API_SECRET must be explicitly set.
        const secret = authKey ?? process.env.RELAY_API_SECRET;
        if (!secret) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error(
                    '[RelayHub] FATAL: RELAY_API_SECRET environment variable is not set. ' +
                    'The hub cannot start in production without a secret.'
                );
            }
            console.warn('[RelayHub] WARNING: No auth secret provided. Using insecure fallback for development only.');
        }
        this.authKey = secret ?? 'default-secret-dev-only';

        this.app.use(express.json());
        this.setupRoutes();
        this.setupSocketIO();
    }

    private setupRoutes() {
        // Auth Middleware for sensitive endpoints
        const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
            const secret = req.headers['x-relay-secret'];
            if (secret !== this.authKey) {
                res.status(401).json({ error: 'Unauthorized: Invalid Relay Secret' });
                return;
            }
            return next();
        };

        this.app.get('/health', (_req, res) => {
            return res.json({ status: 'healthy', connections: this.activeUsers.size });
        });

        /**
         * Internal endpoint for the SDK to notify the hub of new messages.
         * In a production environment, this would be authenticated via a service secret.
         */
        this.app.post('/notify', authMiddleware, (req, res) => {
            const { to, from, ciphertext, sessionId } = req.body;

            const socketId = this.activeUsers.get(to);
            if (socketId) {
                this.io.to(socketId).emit('message', { to, from, ciphertext, sessionId });
                return res.json({ status: 'pushed', to });
            }

            return res.json({ status: 'queued_in_db', to });
        });
    }

    private setupSocketIO() {
        this.io.on('connection', (socket: Socket) => {
            console.log(`[RelayHub] Socket connected: ${socket.id}`);

            // Users "Register" their socket with their userId
            socket.on('register', (userId: string) => {
                this.activeUsers.set(userId, socket.id);
                console.log(`[RelayHub] User ${userId} registered at socket ${socket.id}`);
            });

            socket.on('disconnect', () => {
                // Find and remove the user entry
                for (const [userId, id] of this.activeUsers.entries()) {
                    if (id === socket.id) {
                        this.activeUsers.delete(userId);
                        console.log(`[RelayHub] User ${userId} disconnected.`);
                        break;
                    }
                }
            });
        });
    }

    public start() {
        this.httpServer.listen(this.port, () => {
            console.log(`🚀 TelestackSEC Relay Hub running on port ${this.port}`);
        });
    }

    public stop() {
        this.httpServer.close();
    }
}

// Start if executed directly
if (require.main === module) {
    const hub = new RelayHub();
    hub.start();
}
