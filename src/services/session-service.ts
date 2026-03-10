import { DatabaseService } from '../db/database-service';
import { SessionStatus, SessionListResponse, SignalError, SignalErrorCode } from '../types';

/**
 * Session management service
 */

export class SessionService {
  constructor(private db: DatabaseService) {}

  /**
   * Get session status
   */
  async getStatus(userId1: string, userId2: string): Promise<SessionStatus | null> {
    try {
      const session = await this.db.getSession(userId1, userId2);

      if (!session) {
        return null;
      }

      return {
        sessionId: session.id,
        userAId: session.userAId,
        userBId: session.userBId,
        createdAt: session.createdAt,
        lastMessageAt: session.lastMessageAt,
        isActive: true, // Sessions are always active if they exist
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to get session status',
        { originalError: error }
      );
    }
  }

  /**
   * List all sessions for a user
   */
  async listUserSessions(userId: string): Promise<SessionListResponse> {
    try {
      const sessions = await this.db.getUserSessions(userId);

      const sessionStatuses = sessions.map((session: any) => ({
        sessionId: session.id,
        userAId: session.userAId,
        userBId: session.userBId,
        createdAt: session.createdAt,
        lastMessageAt: session.lastMessageAt,
        isActive: true,
      }));

      return {
        sessions: sessionStatuses,
        count: sessionStatuses.length,
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to list sessions',
        { originalError: error }
      );
    }
  }

  /**
   * Reset/delete a session
   * Useful for resetting conversation if keys are compromised
   */
  async resetSession(userId1: string, userId2: string): Promise<void> {
    try {
      await this.db.deleteSession(userId1, userId2);
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to reset session',
        { originalError: error }
      );
    }
  }
}
