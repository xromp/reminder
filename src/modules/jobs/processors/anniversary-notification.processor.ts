import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { NotificationService } from '../../notification/notification.service';
import { AnniversaryNotificationHandler } from '../../notification/handlers/anniversary-notification.handler';
import { JobProcessor, ProcessorResult } from '../interfaces/job-processor.interface';
import { JobEnvelope, EventNotificationPayload } from '../interfaces/job-envelope.interface';

/**
 * Anniversary notification job processor
 * 
 * Processes ANNIVERSARY_NOTIFICATION jobs by:
 * 1. Fetching the ScheduledNotification and RecurringEvent
 * 2. Fetching the User
 * 3. Sending notification via NotificationService + AnniversaryNotificationHandler
 * 4. Handler calculates Nth anniversary if originYear is present
 * 5. Updating ScheduledNotification status
 */
@Injectable()
export class AnniversaryNotificationProcessor implements JobProcessor<EventNotificationPayload> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly notificationService: NotificationService,
    private readonly anniversaryHandler: AnniversaryNotificationHandler,
  ) {}

  async process(envelope: JobEnvelope<EventNotificationPayload>): Promise<ProcessorResult> {
    const { payload, idempotencyKey } = envelope;
    const startTime = Date.now();

    try {
      this.logger.log('Processing anniversary notification', {
        idempotencyKey,
        eventId: payload.eventId,
        userId: payload.userId,
        year: payload.year,
      });

      // Fetch scheduled notification
      const notification = await this.prisma.scheduledNotification.findFirst({
        where: {
          eventId: payload.eventId,
          scheduledFor: new Date(payload.scheduledFor),
        },
      });

      if (!notification) {
        this.logger.error('Scheduled notification not found', '', {
          idempotencyKey,
          eventId: payload.eventId,
        });
        return {
          success: false,
          error: 'ScheduledNotification not found',
          metadata: { eventId: payload.eventId },
        };
      }

      // Fetch user
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        this.logger.error('User not found', '', {
          idempotencyKey,
          userId: payload.userId,
        });
        return {
          success: false,
          error: 'User not found',
          metadata: { userId: payload.userId },
        };
      }

      // Fetch event (IMPORTANT: originYear used for Nth anniversary calculation)
      const event = await this.prisma.recurringEvent.findUnique({
        where: { id: payload.eventId },
      });

      if (!event) {
        this.logger.error('RecurringEvent not found', '', {
          idempotencyKey,
          eventId: payload.eventId,
        });
        return {
          success: false,
          error: 'RecurringEvent not found',
          metadata: { eventId: payload.eventId },
        };
      }

      // Send notification (passes event and scheduledFor for Nth calculation)
      const result = await this.notificationService.send(
        notification,
        user,
        this.anniversaryHandler,
        event,
        new Date(payload.scheduledFor),
      );

      // Update notification status based on result
      if (result.success) {
        await this.prisma.scheduledNotification.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            deliveredAt: new Date(),
            webhookResponseCode: result.statusCode,
          },
        });
      } else {
        await this.prisma.scheduledNotification.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            retryCount: notification.retryCount + 1,
            errorMessage: result.errorMessage,
            webhookResponseCode: result.statusCode,
          },
        });
      }

      const durationMs = Date.now() - startTime;

      if (result.success) {
        const yearsElapsed = event.originYear
          ? payload.year - event.originYear
          : null;

        this.logger.log('Anniversary notification delivered successfully', {
          idempotencyKey,
          notificationId: notification.id,
          userId: payload.userId,
          yearsElapsed,
          durationMs,
        });

        return {
          success: true,
          metadata: {
            notificationId: notification.id,
            userId: payload.userId,
            eventId: payload.eventId,
            yearsElapsed,
            durationMs,
          },
        };
      } else {
        this.logger.error('Anniversary notification delivery failed', '', {
          idempotencyKey,
          notificationId: notification.id,
          userId: payload.userId,
          error: result.errorMessage,
        });

        return {
          success: false,
          error: result.errorMessage || 'Notification delivery failed',
          metadata: {
            notificationId: notification.id,
            userId: payload.userId,
          },
        };
      }
    } catch (error) {
      this.logger.error('Anniversary notification processing failed', error.stack, {
        idempotencyKey,
        eventId: payload.eventId,
        userId: payload.userId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        metadata: {
          eventId: payload.eventId,
          userId: payload.userId,
        },
      };
    }
  }
}

