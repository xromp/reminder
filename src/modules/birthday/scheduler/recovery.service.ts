import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { SqsService } from '../../aws/sqs.service';
import { CloudWatchService } from '../../aws/cloudwatch.service';
import { differenceInMinutes } from 'date-fns';

@Injectable()
export class RecoveryService implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly gracePeriodMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsService: SqsService,
    private readonly cloudWatch: CloudWatchService,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('recovery.enabled', false);
    this.gracePeriodMinutes = this.configService.get<number>(
      'recovery.gracePeriodMinutes',
      120,
    );

    if (this.enabled) {
      this.logger.log('Recovery Service enabled', {
        gracePeriodMinutes: this.gracePeriodMinutes,
      });
    } else {
      this.logger.warn('Recovery Service disabled');
    }
  }

  async onModuleInit() {
    if (this.enabled) {
      // Run recovery on startup
      await this.recoverMissedMessages();
    }
  }

  /**
   * Recover all missed messages after downtime
   * Implements grace period logic to skip messages that are too old
   */
  async recoverMissedMessages(): Promise<{
    recovered: number;
    skipped: number;
  }> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting recovery of missed messages', {
        gracePeriodMinutes: this.gracePeriodMinutes,
      });

      // Find all pending messages with scheduled_for < NOW()
      const missedMessages = await this.prisma.birthdayMessage.findMany({
        where: {
          status: 'PENDING',
          scheduledFor: {
            lt: new Date(),
          },
        },
        orderBy: {
          scheduledFor: 'asc',
        },
      });

      if (missedMessages.length === 0) {
        this.logger.log('No missed messages found');
        return { recovered: 0, skipped: 0 };
      }

      this.logger.log(`Found ${missedMessages.length} missed messages`);

      const now = new Date();
      let recovered = 0;
      let skipped = 0;

      for (const message of missedMessages) {
        const minutesLate = differenceInMinutes(now, message.scheduledFor);

        if (minutesLate > this.gracePeriodMinutes) {
          // Too late - skip this message
          await this.skipMessage(
            message.id,
            `Message is ${minutesLate} minutes late (grace period: ${this.gracePeriodMinutes} minutes)`,
          );

          skipped++;

          this.logger.warn('Message skipped - outside grace period', {
            messageId: message.id,
            scheduledFor: message.scheduledFor,
            minutesLate,
          });
        } else {
          // Within grace period - process immediately
          await this.recoverMessage(message);
          recovered++;

          this.logger.log('Message recovered', {
            messageId: message.id,
            scheduledFor: message.scheduledFor,
            minutesLate,
          });
        }
      }

      const durationMs = Date.now() - startTime;

      this.logger.log('Recovery completed', {
        totalMissed: missedMessages.length,
        recovered,
        skipped,
        durationMs,
      });

      await this.cloudWatch.recordRecovery(recovered, skipped);

      return { recovered, skipped };
    } catch (error) {
      this.logger.error('Recovery failed', error.stack, {
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Recover a single message by pushing to SQS for immediate processing
   */
  private async recoverMessage(message: any): Promise<void> {
    try {
      // Push to SQS for immediate processing (no delay)
      await this.sqsService.sendMessage(message.id, {
        messageId: message.id,
        userId: message.userId,
        scheduledFor: message.scheduledFor.toISOString(),
        recovered: true,
      });

      this.logger.debug('Message queued for recovery', {
        messageId: message.id,
      });
    } catch (error) {
      this.logger.error('Failed to recover message', error.stack, {
        messageId: message.id,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Skip a message that's outside the grace period
   */
  private async skipMessage(messageId: string, reason: string): Promise<void> {
    await this.prisma.birthdayMessage.update({
      where: { id: messageId },
      data: {
        status: 'SKIPPED',
        errorMessage: reason,
      },
    });
  }

  /**
   * Manual recovery trigger (for admin operations)
   */
  async triggerRecovery(): Promise<{ recovered: number; skipped: number }> {
    return this.recoverMissedMessages();
  }

  /**
   * Get recovery statistics
   */
  async getRecoveryStats(): Promise<{
    pendingCount: number;
    missedCount: number;
    withinGracePeriod: number;
    outsideGracePeriod: number;
  }> {
    const now = new Date();
    const gracePeriodCutoff = new Date(
      now.getTime() - this.gracePeriodMinutes * 60 * 1000,
    );

    const [pendingCount, missedCount, withinGracePeriod, outsideGracePeriod] =
      await Promise.all([
        // Total pending
        this.prisma.birthdayMessage.count({
          where: { status: 'PENDING' },
        }),

        // Missed (scheduled in past)
        this.prisma.birthdayMessage.count({
          where: {
            status: 'PENDING',
            scheduledFor: { lt: now },
          },
        }),

        // Within grace period
        this.prisma.birthdayMessage.count({
          where: {
            status: 'PENDING',
            scheduledFor: {
              lt: now,
              gte: gracePeriodCutoff,
            },
          },
        }),

        // Outside grace period
        this.prisma.birthdayMessage.count({
          where: {
            status: 'PENDING',
            scheduledFor: { lt: gracePeriodCutoff },
          },
        }),
      ]);

    return {
      pendingCount,
      missedCount,
      withinGracePeriod,
      outsideGracePeriod,
    };
  }
}
