/**
 * Job type enumeration for routing messages to appropriate processors
 * 
 * This enum defines all supported job types in the system. Each type
 * corresponds to a specific processor that handles that job.
 * 
 * Design Notes:
 * - Enum values match their keys for JSON serialization compatibility
 * - Adding a new job type requires:
 *   1. Add enum value here
 *   2. Create processor implementing JobProcessor<T>
 *   3. Register processor in appropriate module's OnModuleInit
 * 
 * @example
 * ```typescript
 * const envelope: JobEnvelope = {
 *   type: JobType.BIRTHDAY_NOTIFICATION,
 *   version: 1,
 *   idempotencyKey: 'event:123:2025',
 *   payload: { ... }
 * };
 * ```
 */
export enum JobType {
  /**
   * Birthday notification job
   * Payload: EventNotificationPayload
   * Processor: BirthdayNotificationProcessor
   */
  BIRTHDAY_NOTIFICATION = 'BIRTHDAY_NOTIFICATION',

  /**
   * Anniversary notification job
   * Payload: EventNotificationPayload
   * Processor: AnniversaryNotificationProcessor
   */
  ANNIVERSARY_NOTIFICATION = 'ANNIVERSARY_NOTIFICATION',

  // Future job types (placeholders):
  // SUBSCRIPTION_RENEWAL = 'SUBSCRIPTION_RENEWAL',
  // CUSTOM = 'CUSTOM',
}

