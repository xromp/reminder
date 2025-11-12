import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, ScheduledNotification } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/utils/logger.service';
import { EmailService } from './email.service';
import {
  NotificationHandler,
  DeliveryResult,
  NotificationPayload,
} from './interfaces/notification-handler.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Send notification using the provided handler strategy
   * Works with ScheduledNotification (event-generic system)
   * 
   * @param message - ScheduledNotification to send
   * @param user - User receiving notification
   * @param handler - NotificationHandler strategy (birthday, anniversary, etc.)
   * @param event - Optional RecurringEvent for context (e.g., originYear for anniversaries)
   * @param scheduledFor - Optional scheduled date for year calculations
   */
  async send(
    message: ScheduledNotification,
    user: User,
    handler: NotificationHandler,
    event?: any, // RecurringEvent
    scheduledFor?: Date,
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const idempotencyKey = `${message.id}-${message.retryCount}`;

    try {
      // Check if should send
      if (!handler.shouldSend(user)) {
        this.logger.log('Notification skipped - business logic check failed', {
          messageId: message.id,
          userId: user.id,
          type: handler.getType(),
        });

        return {
          success: false,
          errorMessage: 'Business logic check failed',
          durationMs: Date.now() - startTime,
        };
      }

      // Build payload
      const payload: NotificationPayload = {
        message: handler.getMessageTemplate(user, event, scheduledFor),
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        timestamp: new Date().toISOString(),
        notificationType: handler.getType(),
      };

      // Send via both webhook and email (dual-channel delivery)
      const webhookUrl = handler.getWebhookUrl();
      const results: DeliveryResult[] = [];

      // Send to webhook if configured
      if (webhookUrl) {
        try {
          const webhookResult = await this.sendToWebhook(
            webhookUrl,
            payload,
            idempotencyKey,
          );
          results.push(webhookResult);
          this.logger.log('Webhook notification delivered', {
            messageId: message.id,
            userId: user.id,
            statusCode: webhookResult.statusCode,
          });
        } catch (error) {
          this.logger.error('Webhook delivery failed', error.stack, {
            messageId: message.id,
            userId: user.id,
          });
        }
      }

      // Send email (always - using dummy email for testing)
      try {
        const dummyEmail = this.generateDummyEmail(user);
        const emailResult = await this.sendEmail(
          user,
          message,
          handler,
          dummyEmail,
        );
        results.push(emailResult);
        this.logger.log('Email notification delivered', {
          messageId: message.id,
          userId: user.id,
          email: dummyEmail,
        });
      } catch (error) {
        const dummyEmail = this.generateDummyEmail(user);
        this.logger.error('Email delivery failed', error.stack, {
          messageId: message.id,
          userId: user.id,
          email: dummyEmail,
        });
      }

      // If at least one delivery method succeeded, consider it a success
      const anySuccess = results.some((r) => r.success);
      const combinedResult: DeliveryResult = {
        success: anySuccess,
        durationMs: Math.max(...results.map((r) => r.durationMs), 0),
        errorMessage: anySuccess
          ? undefined
          : 'All delivery methods failed',
      };

      this.logger.log(
        anySuccess
          ? 'Notification delivered successfully'
          : 'All notification delivery methods failed',
        {
          messageId: message.id,
          userId: user.id,
          webhookSent: !!webhookUrl,
          emailSent: true, // Always send email (with dummy address)
          results,
        },
      );

      return combinedResult;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.logger.error('Notification delivery failed', error.stack, {
        messageId: message.id,
        userId: user.id,
        error: error.message,
        durationMs,
      });

      return {
        success: false,
        errorMessage: error.message,
        durationMs,
      };
    }
  }

  /**
   * Send HTTP POST request to webhook URL
   */
  private async sendToWebhook(
    url: string,
    payload: NotificationPayload,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'User-Agent': 'BirthdayNotificationService/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      const responseBody = await response.text();
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        throw new HttpException(
          `Webhook returned ${response.status}: ${responseBody}`,
          response.status,
        );
      }

      return {
        success: true,
        statusCode: response.status,
        responseBody,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error.name === 'AbortError') {
        throw new Error('Webhook request timeout after 10 seconds');
      }

      throw error;
    }
  }

  /**
   * Generate a dummy email address for testing
   * Format: firstname.lastname@test.local
   */
  private generateDummyEmail(user: User): string {
    const firstName = user.firstName.toLowerCase().replace(/\s+/g, '');
    const lastName = user.lastName.toLowerCase().replace(/\s+/g, '');
    return `${firstName}.${lastName}@test.local`;
  }

  /**
   * Send email notification
   */
  private async sendEmail(
    user: User,
    message: ScheduledNotification,
    handler: NotificationHandler,
    toEmail: string,
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      // For birthday notifications, extract person name from metadata
      // The metadata JSON should have structure like: { personName: "John Doe" }
      const metadata = message.metadata as any;
      const personName = metadata?.personName || 'Someone';

      // Calculate days until the event
      const scheduledDate = new Date(message.scheduledFor);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      scheduledDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil(
        (scheduledDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      await this.emailService.sendBirthdayReminder(
        toEmail,
        personName,
        daysUntil,
      );

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        statusCode: 200,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      return {
        success: false,
        errorMessage: error.message,
        durationMs,
      };
    }
  }

  /**
   * Record delivery attempt - REMOVED
   * Legacy DeliveryAttempt table has been removed in favor of
   * tracking attempts via ScheduledNotification.retryCount and errorMessage
   */
  async recordDeliveryAttempt(
    messageId: string,
    attemptNumber: number,
    result: DeliveryResult,
  ): Promise<void> {
    // No-op: Legacy audit logging removed
    // Delivery attempts now tracked via ScheduledNotification status/error fields
    this.logger.debug('Delivery attempt recorded via ScheduledNotification', {
      messageId,
      attemptNumber,
      success: result.success,
    });
  }
}
