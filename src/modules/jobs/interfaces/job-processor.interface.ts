import { JobEnvelope } from './job-envelope.interface';

/**
 * Result of job processing
 * 
 * Processors return this structured result instead of throwing exceptions.
 * This allows for better error handling, logging, and metrics.
 */
export interface ProcessorResult {
  /**
   * Whether the job was processed successfully
   */
  success: boolean;

  /**
   * Error message if processing failed
   * Should be human-readable and suitable for logs/alerts
   */
  error?: string;

  /**
   * Additional metadata for logging and metrics
   * Examples: userId, notificationId, deliveryStatus, etc.
   */
  metadata?: Record<string, any>;
}

/**
 * Job processor interface
 * 
 * All job processors must implement this interface. Processors are responsible
 * for executing the business logic for a specific job type.
 * 
 * Design Principles:
 * - Processors are async (return Promise)
 * - Processors return structured results (success/error)
 * - Processors handle their own errors (catch and return { success: false })
 * - Processors are idempotent (can be safely retried)
 * - Processors log their own operations
 * 
 * @example
 * ```typescript
 * @Injectable()
 * export class BirthdayProcessor implements JobProcessor<EventNotificationPayload> {
 *   async process(envelope: JobEnvelope<EventNotificationPayload>): Promise<ProcessorResult> {
 *     try {
 *       const { payload } = envelope;
 *       await this.notificationService.sendBirthday(payload.userId);
 *       return {
 *         success: true,
 *         metadata: { userId: payload.userId, eventId: payload.eventId }
 *       };
 *     } catch (error) {
 *       return {
 *         success: false,
 *         error: error.message,
 *         metadata: { userId: payload.userId }
 *       };
 *     }
 *   }
 * }
 * ```
 */
export interface JobProcessor<T = any> {
  /**
   * Process a job envelope
   * 
   * @param envelope - Job envelope with typed payload
   * @returns Processing result with success status and optional metadata
   */
  process(envelope: JobEnvelope<T>): Promise<ProcessorResult>;
}

