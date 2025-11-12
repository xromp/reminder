import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, RecurringEvent } from '@prisma/client';
import { NotificationHandler } from '../interfaces/notification-handler.interface';
import { getYear } from 'date-fns';

/**
 * Anniversary notification handler
 * 
 * Generates notification messages for anniversaries with Nth year calculation
 * when originYear is available.
 */
@Injectable()
export class AnniversaryNotificationHandler implements NotificationHandler {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Get message template for anniversary
   * 
   * If originYear exists, calculates and includes "Nth anniversary"
   * Otherwise, generic anniversary message
   * 
   * @param user - User receiving notification
   * @param event - RecurringEvent with optional originYear
   * @param scheduledFor - Scheduled date (for year calculation)
   * @returns Formatted message string
   */
  getMessageTemplate(
    user: User,
    event?: RecurringEvent,
    scheduledFor?: Date,
  ): string {
    const firstName = user.firstName;
    const lastName = user.lastName;

    // Calculate Nth anniversary if originYear is available
    if (event?.originYear && scheduledFor) {
      const currentYear = getYear(scheduledFor);
      const yearsElapsed = currentYear - event.originYear;

      // Ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
      const suffix = this.getOrdinalSuffix(yearsElapsed);

      return `Hey, ${firstName} ${lastName} it's your ${yearsElapsed}${suffix} anniversary!`;
    }

    // Generic anniversary message (no originYear)
    return `Hey, ${firstName} ${lastName} it's your anniversary!`;
  }

  /**
   * Get ordinal suffix for numbers (1st, 2nd, 3rd, etc.)
   */
  private getOrdinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  getWebhookUrl(): string {
    return this.configService.get<string>('webhook.hookbinUrl') || '';
  }

  shouldSend(user: User): boolean {
    // Business logic: Don't send to deleted users
    return user.deletedAt === null;
  }

  getType(): string {
    return 'anniversary';
  }
}

