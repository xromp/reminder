import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { SqsService } from '../../aws/sqs.service';
import { CloudWatchService } from '../../aws/cloudwatch.service';
import { nextOccurrence } from '../../../common/utils/next-occurrence.util';
import {
  JobEnvelope,
  EventNotificationPayload,
  generateIdempotencyKey,
} from '../../jobs/interfaces/job-envelope.interface';
import { JobType } from '../../jobs/enums/job-type.enum';
import { getYear, differenceInHours, subYears } from 'date-fns';
import { Prisma, EventType } from '@prisma/client';

/**
 * Event recovery service for missed RecurringEvent occurrences
 * 
 * Scans for RecurringEvent occurrences that should have been scheduled
 * but were missed due to downtime, and re-enqueues them within a
 * configurable grace period.
 * 
 * Key features:
 * - Event-agnostic (works for all RecurringEvent types)
 * - Grace period-based recovery
 * - Idempotent re-enqueueing via ScheduledNotification unique constraint
 * - CloudWatch metrics for observability
 * - Runs automatically on module initialization
 */
@Injectable()
export class EventRecoveryService implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly gracePeriodHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsService: SqsService,
    private readonly cloudWatch: CloudWatchService,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('recovery.enabled', false);
    
    // Config uses minutes, but we convert to hours for internal use
    const gracePeriodMinutes = this.configService.get<number>(
      'recovery.gracePeriodMinutes',
      7200, // Default 7200 minutes (120 hours / 5 days)
    );
    this.gracePeriodHours = gracePeriodMinutes / 60;

    if (this.enabled) {
      this.logger.log('Event Recovery Service enabled', {
        gracePeriodHours: this.gracePeriodHours,
        gracePeriodMinutes,
      });
    } else {
      this.logger.warn('Event Recovery Service disabled');
    }
  }

  async onModuleInit() {
    if (this.enabled) {
      // Run recovery on startup
      await this.recoverMissedOccurrences();
    }
  }

  /**
   * Recover all missed event occurrences within grace period
   * 
   * Scans all enabled RecurringEvents, computes their expected occurrences
   * for the past year, and re-enqueues any that are missing ScheduledNotifications
   * and fall within the grace period.
   * 
   * @returns Object with counts: totalMissed, recovered, skipped, alreadyScheduled
   */
  async recoverMissedOccurrences(): Promise<{
    totalMissed: number;
    recovered: number;
    skipped: number;
    alreadyScheduled: number;
  }> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting event recovery', {
        gracePeriodHours: this.gracePeriodHours,
      });

      const now = new Date();
      const gracePeriodCutoff = new Date(
        now.getTime() - this.gracePeriodHours * 60 * 60 * 1000,
      );

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
        this.logger.log('No enabled events found for recovery');
        return { totalMissed: 0, recovered: 0, skipped: 0, alreadyScheduled: 0 };
      }

      this.logger.log(`Scanning ${events.length} enabled events for missed occurrences`);

      let totalMissed = 0;
      let recovered = 0;
      let skipped = 0;
      let alreadyScheduled = 0;

      for (const event of events) {
        try {
          // Check last year, current year, and next year for missed occurrences
          const currentYear = getYear(now);
          const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];

          for (const year of yearsToCheck) {
            try {
              // Compute occurrence for this year
              const yearStart = new Date(year, 0, 1);
              const occurrence = nextOccurrence(
                {
                  eventDate: event.eventDate,
                  notificationTime: event.notificationTime,
                },
                yearStart,
                event.user.timezone,
              );

              // Only process if occurrence is in the past
              if (occurrence >= now) {
                continue;
              }

              // Check if within grace period
              const hoursLate = differenceInHours(now, occurrence);
              if (hoursLate > this.gracePeriodHours) {
                // Outside grace period - skip
                this.logger.debug('Occurrence outside grace period', {
                  eventId: event.id,
                  year,
                  occurrence: occurrence.toISOString(),
                  hoursLate,
                });
                continue;
              }

              // Check if already scheduled
              const idempotencyKey = generateIdempotencyKey(event.id, year);
              const existing = await this.prisma.scheduledNotification.findFirst({
                where: {
                  eventId: event.id,
                  scheduledFor: occurrence,
                },
              });

              if (existing) {
                alreadyScheduled++;
                this.logger.debug('Occurrence already scheduled', {
                  eventId: event.id,
                  year,
                  idempotencyKey,
                });
                continue;
              }

              // Found a missed occurrence within grace period
              totalMissed++;

              // Attempt to recover
              const wasRecovered = await this.recoverOccurrence(
                event,
                occurrence,
                year,
                idempotencyKey,
              );

              if (wasRecovered) {
                recovered++;
              } else {
                skipped++;
              }
            } catch (error) {
              this.logger.error('Failed to check year for event', error.stack, {
                eventId: event.id,
                year,
                error: error.message,
              });
            }
          }
        } catch (error) {
          this.logger.error('Failed to process event for recovery', error.stack, {
            eventId: event.id,
            error: error.message,
          });
        }
      }

      const durationMs = Date.now() - startTime;

      this.logger.log('Event recovery completed', {
        totalMissed,
        recovered,
        skipped,
        alreadyScheduled,
        durationMs,
      });

      // Record metrics to CloudWatch
      await this.cloudWatch.recordRecovery(recovered, skipped);

      return { totalMissed, recovered, skipped, alreadyScheduled };
    } catch (error) {
      this.logger.error('Event recovery failed', error.stack, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Recover a single missed occurrence
   * 
   * Creates ScheduledNotification and publishes JobEnvelope to SQS.
   * Uses idempotency via unique constraint to prevent duplicates.
   * 
   * @param event - RecurringEvent
   * @param occurrence - Computed occurrence date (UTC)
   * @param year - Year of occurrence
   * @param idempotencyKey - Idempotency key for this occurrence
   * @returns true if recovered, false if skipped
   */
  private async recoverOccurrence(
    event: any,
    occurrence: Date,
    year: number,
    idempotencyKey: string,
  ): Promise<boolean> {
    try {
      // Create ScheduledNotification (with idempotency)
      const notification = await this.prisma.scheduledNotification.create({
        data: {
          eventId: event.id,
          scheduledFor: occurrence,
          status: 'PENDING',
          retryCount: 0,
        },
      });

      // Publish JobEnvelope to SQS for immediate processing
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

      this.logger.log('Missed occurrence recovered', {
        notificationId: notification.id,
        eventId: event.id,
        idempotencyKey,
        scheduledFor: occurrence.toISOString(),
        year,
      });

      return true;
    } catch (error) {
      // Handle duplicate constraint violation (idempotency)
      if (error.code === 'P2002') {
        this.logger.debug('Occurrence already recovered', {
          eventId: event.id,
          idempotencyKey,
          scheduledFor: occurrence.toISOString(),
        });
        return false;
      }

      this.logger.error('Failed to recover occurrence', error.stack, {
        eventId: event.id,
        idempotencyKey,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Manual recovery trigger (for admin operations)
   */
  async triggerRecovery(): Promise<{
    totalMissed: number;
    recovered: number;
    skipped: number;
    alreadyScheduled: number;
  }> {
    return this.recoverMissedOccurrences();
  }

  /**
   * Get recovery statistics (for monitoring/debugging)
   */
  async getRecoveryStats(): Promise<{
    enabledEvents: number;
    gracePeriodHours: number;
    gracePeriodCutoff: string;
  }> {
    const now = new Date();
    const gracePeriodCutoff = new Date(
      now.getTime() - this.gracePeriodHours * 60 * 60 * 1000,
    );

    const enabledEvents = await this.prisma.recurringEvent.count({
      where: { enabled: true },
    });

    return {
      enabledEvents,
      gracePeriodHours: this.gracePeriodHours,
      gracePeriodCutoff: gracePeriodCutoff.toISOString(),
    };
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

