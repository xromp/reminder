import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, RecurringEvent } from '@prisma/client';
import { NotificationHandler } from '../interfaces/notification-handler.interface';

@Injectable()
export class BirthdayNotificationHandler implements NotificationHandler {
  constructor(private readonly configService: ConfigService) {}

  getMessageTemplate(
    user: User,
    event?: RecurringEvent,
    scheduledFor?: Date,
  ): string {
    return `Hey, ${user.firstName} ${user.lastName} it's your birthday`;
  }

  getWebhookUrl(): string {
    return this.configService.get<string>('webhook.hookbinUrl') || '';
  }

  shouldSend(user: User): boolean {
    // Business logic: Don't send to deleted users
    return user.deletedAt === null;
  }

  getType(): string {
    return 'birthday';
  }
}
