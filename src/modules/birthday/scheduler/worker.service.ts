import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { SqsService } from '../../aws/sqs.service';
import { CloudWatchService } from '../../aws/cloudwatch.service';
import { NotificationService } from '../../notification/notification.service';
import { BirthdayNotificationHandler } from '../../notification/handlers/birthday-notification.handler';
import { Prisma, MessageStatus } from '@prisma/client';
import { differenceInMinutes } from 'date-fns';

@Injectable()
export class WorkerService implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly maxRetries: number;
  private readonly retryDelaySeconds: number[];
  private readonly concurrency: number;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsService: SqsService,
    private readonly cloudWatch: CloudWatchService,
    private readonly notificationService: NotificationService,
    private readonly birthdayHandler: BirthdayNotificationHandler,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('worker.enabled', false);
    this.maxRetries = this.configService.get<number>('retry.maxRetries', 3);
    this.retryDelaySeconds = this.configService.get<number[]>(
      'retry.delaySeconds',
      [60, 300, 900],
    );
    this.concurrency = this.configService.get<number>(
      'worker.concurrency',
      10,
    );

    if (this.enabled) {
      this.logger.log('Birthday Worker Service enabled', {
        maxRetries: this.maxRetries,
        retryDelaySeconds: this.retryDelaySeconds,
        concurrency: this.concurrency,
      });
    } else {
      this.logger.warn('Birthday Worker Service disabled');
    }
  }

  async onModuleInit() {
    if (this.enabled) {
      // Start processing loop
      this.startProcessing();
    }
  }

  /**
   * Start continuous processing loop
   */
  private async startProcessing(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.logger.log('Starting worker processing loop');

    while (this.isRunning) {
      try {
        await this.processNextBatch();
      } catch (error) {
        this.logger.error('Worker processing error', error.stack, {
          error: error.message,
        });
      }

      // Small delay between batches
      await this.sleep(1000);
    }
  }

  /**
   * Process a batch of messages
   */
  async processNextBatch(): Promise<void> {
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;

    try {
      // Claim pending messages atomically
      const messages = await this.claimMessages(this.concurrency);

      if (messages.length === 0) {
        return; // No messages to process
      }

      this.logger.log(`Processing batch of ${messages.length} messages`);

      // Process messages in parallel
      const results = await Promise.allSettled(
        messages.map((message) => this.processMessage(message)),
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          processed++;
        } else {
          failed++;
        }
      });

      const durationMs = Date.now() - startTime;

      this.logger.log('Batch processing completed', {
        processed,
        failed,
        durationMs,
      });

      await this.cloudWatch.recordWorkerProcessing(
        processed,
        failed,
        durationMs,
      );
    } catch (error) {
      this.logger.error('Batch processing failed', error.stack, {
        error: error.message,
      });
    }
  }

  /**
   * Claim messages atomically using SELECT FOR UPDATE SKIP LOCKED
   */
  private async claimMessages(limit: number): Promise<any[]> {
    const workerInstanceId = process.env.HOSTNAME || 'unknown';

    // Use raw SQL for SELECT FOR UPDATE SKIP LOCKED
    const messages = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM birthday_messages
      WHERE status = 'PENDING'
        AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;

    // Update worker instance ID
    if (messages.length > 0) {
      const messageIds = messages.map((m) => m.id);

      await this.prisma.birthdayMessage.updateMany({
        where: { id: { in: messageIds } },
        data: { workerInstanceId },
      });
    }

    return messages;
  }

  /**
   * Process a single birthday message
   */
  async processMessage(message: any): Promise<void> {
    const startTime = Date.now();

    try {
      // Fetch user (with deleted check)
      const user = await this.prisma.user.findUnique({
        where: { id: message.userId },
      });

      if (!user || user.deletedAt) {
        // User deleted - mark message as skipped
        await this.markAsSkipped(message.id, 'User deleted');
        this.logger.warn('Message skipped - user deleted', {
          messageId: message.id,
          userId: message.userId,
        });
        return;
      }

      // Validate user snapshot (detect stale messages)
      if (message.userSnapshot) {
        const snapshot = message.userSnapshot as any;
        if (
          snapshot.birthday !== user.birthday.toISOString() ||
          snapshot.timezone !== user.timezone
        ) {
          // User data changed - message is stale
          await this.markAsSkipped(
            message.id,
            'User data changed since message creation',
          );
          this.logger.warn('Message skipped - stale data', {
            messageId: message.id,
            userId: user.id,
          });
          return;
        }
      }

      // Send notification
      const result = await this.notificationService.send(
        message,
        user,
        this.birthdayHandler,
      );

      // Record delivery attempt
      await this.notificationService.recordDeliveryAttempt(
        message.id,
        message.retryCount + 1,
        result,
      );

      if (result.success) {
        // Mark as sent
        await this.markAsSent(message.id, result);

        this.logger.log('Message delivered successfully', {
          messageId: message.id,
          userId: user.id,
          durationMs: Date.now() - startTime,
        });

        await this.cloudWatch.recordDelivery(true, result.durationMs);
      } else {
        // Handle failure with retry logic
        await this.handleFailure(message, result);
      }
    } catch (error) {
      this.logger.error('Message processing failed', error.stack, {
        messageId: message.id,
        error: error.message,
      });

      // Handle failure
      await this.handleFailure(message, {
        success: false,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
    }
  }

  /**
   * Handle message failure with retry logic
   */
  private async handleFailure(message: any, result: any): Promise<void> {
    const newRetryCount = message.retryCount + 1;

    if (newRetryCount >= this.maxRetries) {
      // Max retries exceeded - mark as failed and move to DLQ
      await this.markAsFailed(message.id, result);

      await this.sqsService.moveToDLQ(message.id, {
        messageId: message.id,
        userId: message.userId,
        error: result.errorMessage,
        retriesExhausted: newRetryCount,
      });

      this.logger.error(`Message failed - max retries exceeded: ${message.id}`, undefined, {
        messageId: message.id,
        userId: message.userId,
        retryCount: newRetryCount,
      });

      await this.cloudWatch.recordDelivery(false, result.durationMs);
    } else {
      // Schedule retry with exponential backoff
      const delaySeconds =
        this.retryDelaySeconds[newRetryCount - 1] || this.retryDelaySeconds[this.retryDelaySeconds.length - 1];

      await this.scheduleRetry(message.id, newRetryCount, delaySeconds, result);

      this.logger.warn('Message retry scheduled', {
        messageId: message.id,
        retryCount: newRetryCount,
        delaySeconds,
      });
    }
  }

  /**
   * Schedule message retry
   */
  private async scheduleRetry(
    messageId: string,
    retryCount: number,
    delaySeconds: number,
    result: any,
  ): Promise<void> {
    // Update retry count and error message
    await this.prisma.birthdayMessage.update({
      where: { id: messageId },
      data: {
        retryCount,
        errorMessage: result.errorMessage,
        status: 'PENDING', // Keep as pending for retry
      },
    });

    // Send back to SQS with delay
    const message = await this.prisma.birthdayMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      this.logger.error(`Message not found for retry: ${messageId}`);
      return;
    }

    await this.sqsService.sendMessage(
      messageId,
      {
        messageId,
        userId: message.userId,
        scheduledFor: message.scheduledFor.toISOString(),
        retryCount,
      },
      delaySeconds,
    );
  }

  /**
   * Mark message as sent
   */
  private async markAsSent(messageId: string, result: any): Promise<void> {
    await this.prisma.birthdayMessage.update({
      where: { id: messageId },
      data: {
        status: 'SENT',
        deliveredAt: new Date(),
        webhookResponseCode: result.statusCode,
        processingDurationMs: result.durationMs,
      },
    });
  }

  /**
   * Mark message as failed
   */
  private async markAsFailed(messageId: string, result: any): Promise<void> {
    await this.prisma.birthdayMessage.update({
      where: { id: messageId },
      data: {
        status: 'FAILED',
        errorMessage: result.errorMessage,
        webhookResponseCode: result.statusCode,
        processingDurationMs: result.durationMs,
      },
    });
  }

  /**
   * Mark message as skipped
   */
  private async markAsSkipped(
    messageId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.birthdayMessage.update({
      where: { id: messageId },
      data: {
        status: 'SKIPPED',
        errorMessage: reason,
      },
    });
  }

  /**
   * Helper to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Stop processing (for graceful shutdown)
   */
  async stopProcessing(): Promise<void> {
    this.logger.log('Stopping worker processing');
    this.isRunning = false;
  }
}
