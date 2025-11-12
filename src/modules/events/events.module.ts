import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventSchedulerService } from './event-scheduler.service';
import { EventRecoveryService } from './recovery/event-recovery.service';
import { AwsModule } from '../aws/aws.module';
import { CommonModule } from '../../common/common.module';
import { NotificationModule } from '../notification/notification.module';
import { BirthdayNotificationProcessor } from '../jobs/processors/birthday-notification.processor';
import { AnniversaryNotificationProcessor } from '../jobs/processors/anniversary-notification.processor';
import { JobRegistry } from '../jobs/registry/job-registry.service';
import { JobType } from '../jobs/enums/job-type.enum';

/**
 * Events module for managing recurring events (birthdays, anniversaries, etc.)
 * 
 * This module provides:
 * - EventSchedulerService: Schedules recurring event occurrences
 * - EventRecoveryService: Recovers missed occurrences within grace period
 * - Job Processors: Handle birthday and anniversary notifications
 * 
 * Note: PrismaService is globally available via DatabaseModule
 * 
 * Processor Registration:
 * This module registers job processors on initialization, mapping JobTypes
 * to their corresponding processor implementations.
 */
@Module({
  imports: [ConfigModule, AwsModule, CommonModule, NotificationModule],
  providers: [
    EventSchedulerService,
    EventRecoveryService,
    BirthdayNotificationProcessor,
    AnniversaryNotificationProcessor,
  ],
  exports: [
    EventSchedulerService,
    EventRecoveryService,
    BirthdayNotificationProcessor,
    AnniversaryNotificationProcessor,
  ],
})
export class EventsModule implements OnModuleInit {
  constructor(
    private readonly jobRegistry: JobRegistry,
    private readonly birthdayProcessor: BirthdayNotificationProcessor,
    private readonly anniversaryProcessor: AnniversaryNotificationProcessor,
  ) {}

  onModuleInit() {
    // Register processors in the job registry
    this.jobRegistry.register(
      JobType.BIRTHDAY_NOTIFICATION,
      this.birthdayProcessor,
    );
    this.jobRegistry.register(
      JobType.ANNIVERSARY_NOTIFICATION,
      this.anniversaryProcessor,
    );
  }
}

