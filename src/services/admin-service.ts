import { DatabaseService } from '../db/database-service';
import { UserService } from './user-service';
import {
  HealthStatus,
  AdminPrekeyRotationResponse,
  AdminPrekeyCleanupResponse,
  SignalError,
  SignalErrorCode,
} from '../types';

/**
 * Admin service for maintenance and diagnostics
 */

export class AdminService {
  constructor(
    private db: DatabaseService,
    private userService: UserService
  ) {}

  /**
   * Health check - verify database connection
   */
  async health(): Promise<HealthStatus> {
    try {
      const isConnected = await this.db.healthCheck();

      return {
        status: isConnected ? 'healthy' : 'unhealthy',
        database: isConnected ? 'connected' : 'disconnected',
        timestamp: new Date(),
        message: isConnected ? 'All systems operational' : 'Database connection failed',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        database: 'disconnected',
        timestamp: new Date(),
        message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Rotate prekeys for a user
   * Used for maintenance and security
   */
  async rotatePrekeys(
    userId: string,
    retentionDays: number = 30
  ): Promise<AdminPrekeyRotationResponse> {
    try {
      if (retentionDays < 0) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'retentionDays cannot be negative'
        );
      }

      // Verify user exists
      await this.userService.getUser(userId);

      // Remove used prekeys
      const retentionCutoff = new Date();
      retentionCutoff.setDate(retentionCutoff.getDate() - retentionDays);
      const removedCount = await this.db.deleteUsedPreKeysOlderThan(
        userId,
        retentionCutoff
      );

      // Generate new prekeys
      const rotatedCount = await this.userService.rotatePreKeysIfNeeded(userId, 0);

      return {
        userId,
        newPrekeysGenerated: rotatedCount,
        oldPrekeysRemoved: removedCount,
        timestamp: new Date(),
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to rotate prekeys',
        { originalError: error }
      );
    }
  }

  async cleanupUsedPrekeys(
    userId: string,
    retentionDays: number = 30
  ): Promise<AdminPrekeyCleanupResponse> {
    try {
      if (retentionDays < 0) {
        throw new SignalError(
          SignalErrorCode.INVALID_INPUT,
          'retentionDays cannot be negative'
        );
      }

      await this.userService.getUser(userId);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const removedPrekeys = await this.db.deleteUsedPreKeysOlderThan(
        userId,
        cutoffDate
      );

      return {
        userId,
        removedPrekeys,
        cutoffDate,
        timestamp: new Date(),
      };
    } catch (error) {
      if (error instanceof SignalError) {
        throw error;
      }
      throw new SignalError(
        SignalErrorCode.DATABASE_ERROR,
        'Failed to clean up prekeys',
        { originalError: error }
      );
    }
  }

  /**
   * Get diagnostic information
   */
  async getDiagnostics(): Promise<{
    health: HealthStatus;
    timestamp: Date;
  }> {
    const health = await this.health();

    return {
      health,
      timestamp: new Date(),
    };
  }
}
