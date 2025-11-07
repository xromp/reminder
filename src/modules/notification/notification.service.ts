import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, BirthdayMessage } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/utils/logger.service';
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
  ) {}

  /**
   * Send notification using the provided handler strategy
   */
  async send(
    message: BirthdayMessage,
    user: User,
    handler: NotificationHandler,
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
        message: handler.getMessageTemplate(user),
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        timestamp: new Date().toISOString(),
        notificationType: handler.getType(),
      };

      // Send to webhook
      const result = await this.sendToWebhook(
        handler.getWebhookUrl(),
        payload,
        idempotencyKey,
      );

      this.logger.log('Notification delivered successfully', {
        messageId: message.id,
        userId: user.id,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
      });

      return result;
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
   * Record delivery attempt in audit log
   */
  async recordDeliveryAttempt(
    messageId: string,
    attemptNumber: number,
    result: DeliveryResult,
  ): Promise<void> {
    await this.prisma.deliveryAttempt.create({
      data: {
        messageId,
        attemptNumber,
        status: result.success ? 'SUCCESS' : 'FAILED',
        httpStatusCode: result.statusCode,
        errorMessage: result.errorMessage,
        responseBody: result.responseBody?.substring(0, 1000), // Limit size
        durationMs: result.durationMs,
      },
    });
  }
}
