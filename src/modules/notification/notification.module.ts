import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { EmailService } from './email.service';
import { BirthdayNotificationHandler } from './handlers/birthday-notification.handler';
import { AnniversaryNotificationHandler } from './handlers/anniversary-notification.handler';
import { LoggerService } from '../../common/utils/logger.service';

@Module({
  imports: [ConfigModule],
  providers: [
    NotificationService,
    EmailService,
    BirthdayNotificationHandler,
    AnniversaryNotificationHandler,
    LoggerService,
  ],
  exports: [
    NotificationService,
    EmailService,
    BirthdayNotificationHandler,
    AnniversaryNotificationHandler,
  ],
})
export class NotificationModule {}
