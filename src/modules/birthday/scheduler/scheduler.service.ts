import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { SqsService } from '../../aws/sqs.service';
import { CloudWatchService } from '../../aws/cloudwatch.service';
import { TimezoneUtil } from '../../../common/utils/timezone.util';
import { getMonth, getDate, getYear } from 'date-fns';
import { Prisma } from '@prisma/client';

@Injectable()
export class SchedulerService {
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsService: SqsService,
    private readonly cloudWatch: CloudWatchService,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('scheduler.enabled', false);

    if (this.enabled) {
      this.logger.log('Birthday Scheduler Service enabled');
    } else {
      this.logger.warn('Birthday Scheduler Service disabled');
    }
  }

  /**
   * Run every hour to schedule birthdays for the next 24 hours
   * This ensures we don't miss any birthdays due to service restarts
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleBirthdaysForNext24Hours(): Promise<void> {
    if (!this.enabled) return;

    const startTime = Date.now();

    try {
      this.logger.log('Starting birthday scheduling for next 24 hours');

      const messagesCreated = await this.createBirthdayMessages();

      const durationMs = Date.now() - startTime;

      this.logger.log('Birthday scheduling completed', {
        messagesCreated,
        durationMs,
      });

      await this.cloudWatch.recordSchedulerExecution(
        messagesCreated,
        durationMs,
      );
    } catch (error) {
      this.logger.error('Birthday scheduling failed', error.stack, {
        error: error.message,
      });
    }
  }

  /**
   * Create birthday messages for users with birthdays today
   * across all timezones
   */
  async createBirthdayMessages(): Promise<number> {
    const today = new Date();
    const month = getMonth(today) + 1; // 0-indexed
    const day = getDate(today);
    const year = getYear(today);

    // Find all users with birthdays today (not deleted)
    const users = await this.prisma.user.findMany({
      where: {
        birthdayMonth: month,
        birthdayDay: day,
        deletedAt: null,
      },
    });

    if (users.length === 0) {
      this.logger.log('No birthdays found for today', { month, day });
      return 0;
    }

    this.logger.log(`Found ${users.length} birthdays for today`, {
      month,
      day,
      userCount: users.length,
    });

    let messagesCreated = 0;

    // Process in batches to avoid overwhelming database
    const batchSize = 100;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      for (const user of batch) {
        try {
          // Calculate 9am local time in UTC
          const scheduledFor = TimezoneUtil.calculateBirthdaySchedule(
            user.birthday,
            user.timezone,
            year,
          );

          // Create birthday message (with duplicate prevention)
          const message = await this.createMessage(user.id, scheduledFor, user);

          if (message) {
            // Push to SQS queue
            await this.sqsService.sendMessage(message.id, {
              messageId: message.id,
              userId: user.id,
              scheduledFor: message.scheduledFor.toISOString(),
            });

            messagesCreated++;
          }
        } catch (error) {
          this.logger.error('Failed to create birthday message', error.stack, {
            userId: user.id,
            timezone: user.timezone,
            error: error.message,
          });
        }
      }
    }

    return messagesCreated;
  }

  /**
   * Create a birthday message with duplicate prevention
   */
  private async createMessage(
    userId: string,
    scheduledFor: Date,
    user: any,
  ): Promise<any | null> {
    try {
      // Store user snapshot for stale message detection
      const userSnapshot = {
        firstName: user.firstName,
        lastName: user.lastName,
        birthday: user.birthday,
        timezone: user.timezone,
      };

      const message = await this.prisma.birthdayMessage.create({
        data: {
          userId,
          scheduledFor,
          status: 'PENDING',
          userSnapshot: userSnapshot as Prisma.JsonObject,
        },
      });

      this.logger.log('Birthday message created', {
        messageId: message.id,
        userId,
        scheduledFor: scheduledFor.toISOString(),
      });

      return message;
    } catch (error) {
      // Handle duplicate constraint violation gracefully
      if (error.code === 'P2002') {
        this.logger.debug('Birthday message already exists', {
          userId,
          scheduledFor: scheduledFor.toISOString(),
        });
        return null;
      }

      throw error;
    }
  }

  /**
   * Manual trigger for testing or recovery
   */
  async triggerScheduling(): Promise<{ messagesCreated: number }> {
    const messagesCreated = await this.createBirthdayMessages();
    return { messagesCreated };
  }
}
