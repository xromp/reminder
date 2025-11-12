import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/utils/logger.service';
import { SqsService } from '../aws/sqs.service';
import { CloudWatchService } from '../aws/cloudwatch.service';
import { nextOccurrence } from '../../common/utils/next-occurrence.util';
import {
  JobEnvelope,
  EventNotificationPayload,
  generateIdempotencyKey,
} from '../jobs/interfaces/job-envelope.interface';
import { JobType } from '../jobs/enums/job-type.enum';
import { getYear } from 'date-fns';
import { Prisma, EventType } from '@prisma/client';

/**
 * Generic event scheduler service
 * 
 * This service replaces the birthday-specific scheduler with a generic
 * event scheduler that works with RecurringEvent model.
 * 
 * Key improvements:
 * - Uses RecurringEvent as single source of truth
 * - Publishes generic JobEnvelopes (not birthday-specific messages)
 * - Implements idempotency via ScheduledNotification unique constraint
 * - Transport-agnostic queueing (SQS has no business logic)
 */
@Injectable()
export class EventSchedulerService {
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
      this.logger.log('Event Scheduler Service enabled');
    } else {
      this.logger.warn('Event Scheduler Service disabled');
    }
  }

  /**
   * Schedule all upcoming RecurringEvent occurrences
   * 
   * Finds all enabled RecurringEvents, computes their next occurrence,
   * and schedules them by creating ScheduledNotifications and publishing
   * JobEnvelopes to SQS.
   * 
   * @returns Number of occurrences scheduled
   */
  async scheduleUpcomingOccurrences(): Promise<number> {
    if (!this.enabled) return 0;

    const startTime = Date.now();

    try {
      this.logger.log('Starting event scheduling');

      // Find all enabled recurring events
      const events = await this.prisma.recurringEvent.findMany({
        where: {
          enabled: true,
        },
        include: {
          user: true, // Include user for timezone
        },
      });

      if (events.length === 0) {
        this.logger.log('No enabled events found');
        return 0;
      }

      this.logger.log(`Found ${events.length} enabled events`);

      let scheduled = 0;

      for (const event of events) {
        try {
          // Compute next occurrence using timezone-aware util from Story 2.1
          const occurrence = nextOccurrence(
            {
              eventDate: event.eventDate,
              notificationTime: event.notificationTime,
            },
            new Date(),
            event.user.timezone,
          );

          const year = getYear(occurrence);
          const idempotencyKey = generateIdempotencyKey(event.id, year);

          // Create ScheduledNotification (with idempotency via unique constraint)
          const notification = await this.createScheduledNotification(
            event.id,
            occurrence,
            idempotencyKey,
          );

          if (notification) {
            // Publish generic JobEnvelope to SQS
            const jobType = this.getJobTypeForEvent(event.type);
            const envelope: JobEnvelope<EventNotificationPayload> = {
              type: jobType,
              version: 1,
              idempotencyKey,
              payload: {
                eventId: event.id,
                userId: event.userId,
                scheduledFor: occurrence.toISOString(),
                eventType: event.type,
                year,
              },
            };

            await this.sqsService.sendMessage(envelope);
            scheduled++;
          }
        } catch (error) {
          this.logger.error('Failed to schedule event', error.stack, {
            eventId: event.id,
            userId: event.userId,
            error: error.message,
          });
        }
      }

      const durationMs = Date.now() - startTime;

      this.logger.log('Event scheduling completed', {
        scheduled,
        durationMs,
      });

      await this.cloudWatch.recordSchedulerExecution(scheduled, durationMs);

      return scheduled;
    } catch (error) {
      this.logger.error('Event scheduling failed', error.stack, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create a ScheduledNotification with idempotency
   * 
   * Uses unique constraint on (event_id, scheduled_for) to prevent duplicates.
   * Handles Prisma P2002 error gracefully.
   * 
   * @param eventId - RecurringEvent ID
   * @param scheduledFor - Scheduled UTC time
   * @param idempotencyKey - Idempotency key for logging
   * @returns Created notification or null if already exists
   */
  private async createScheduledNotification(
    eventId: string,
    scheduledFor: Date,
    idempotencyKey: string,
  ): Promise<any | null> {
    try {
      const notification = await this.prisma.scheduledNotification.create({
        data: {
          eventId,
          scheduledFor,
          status: 'PENDING',
          retryCount: 0,
        },
      });

      this.logger.log('Scheduled notification created', {
        notificationId: notification.id,
        eventId,
        idempotencyKey,
        scheduledFor: scheduledFor.toISOString(),
      });

      return notification;
    } catch (error) {
      // Handle duplicate constraint violation gracefully (idempotency)
      if (error.code === 'P2002') {
        this.logger.debug('Scheduled notification already exists', {
          eventId,
          idempotencyKey,
          scheduledFor: scheduledFor.toISOString(),
        });
        return null;
      }

      throw error;
    }
  }

  /**
   * Map EventType to JobType
   * 
   * Converts Prisma EventType enum to JobType enum for job routing.
   * This mapping is centralized to make it easy to add new event types.
   * 
   * @param eventType - Prisma EventType from RecurringEvent
   * @returns Corresponding JobType for job routing
   * @throws Error if eventType is not recognized
   */
  private getJobTypeForEvent(eventType: EventType): JobType {
    switch (eventType) {
      case EventType.BIRTHDAY:
        return JobType.BIRTHDAY_NOTIFICATION;
      case EventType.ANNIVERSARY:
        return JobType.ANNIVERSARY_NOTIFICATION;
      default:
        throw new Error(`Unknown EventType: ${eventType}`);
    }
  }
}

