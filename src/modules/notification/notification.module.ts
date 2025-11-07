import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { BirthdayNotificationHandler } from './handlers/birthday-notification.handler';
import { LoggerService } from '../../common/utils/logger.service';

@Module({
  providers: [NotificationService, BirthdayNotificationHandler, LoggerService],
  exports: [NotificationService, BirthdayNotificationHandler],
})
export class NotificationModule {}
