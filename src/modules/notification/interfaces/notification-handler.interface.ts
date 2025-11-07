import { User } from '@prisma/client';

/**
 * Strategy pattern interface for different notification types
 * Allows easy extension for anniversaries, subscription renewals, etc.
 */
export interface NotificationHandler {
  /**
   * Generate the message template for this notification type
   */
  getMessageTemplate(user: User): string;

  /**
   * Get the webhook URL for delivery
   */
  getWebhookUrl(): string;

  /**
   * Business logic to determine if notification should be sent
   * e.g., only send anniversaries on 5-year increments
   */
  shouldSend(user: User): boolean;

  /**
   * Get notification type identifier
   */
  getType(): string;
}

/**
 * Delivery result with details for logging and retry logic
 */
export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Notification payload sent to webhook
 */
export interface NotificationPayload {
  message: string;
  userId: string;
  userName: string;
  timestamp: string;
  notificationType: string;
}
