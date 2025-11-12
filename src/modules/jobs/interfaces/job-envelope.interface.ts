import { JobType } from '../enums/job-type.enum';

/**
 * Generic job envelope for transport-agnostic queueing
 * 
 * This interface defines the structure for all job messages sent through
 * the queuing system (SQS). The envelope is intentionally generic and contains
 * NO business logic or event-type-specific knowledge.
 * 
 * Design Principles:
 * - Transport layer (SQS) is business-logic-free
 * - Type field routes to appropriate processor
 * - Version field enables schema evolution
 * - IdempotencyKey ensures exactly-once processing
 * - Payload is type-specific data
 */
export interface JobEnvelope<T = any> {
  /**
   * Job type identifier for routing to appropriate processor
   * Uses JobType enum for type safety
   */
  type: JobType;

  /**
   * Schema version for future evolution
   * Start with version 1; increment when envelope structure changes
   */
  version: number;

  /**
   * Idempotency key for duplicate detection
   * Format: event:{eventId}:{year}
   * Example: 'event:uuid-abc-123:2025'
   * 
   * This key ensures that the same event occurrence is not processed multiple times,
   * even if the scheduler runs multiple times due to restarts or failures.
   */
  idempotencyKey: string;

  /**
   * Job-specific payload data
   * Structure depends on job type; use generics for type safety
   */
  payload: T;
}

/**
 * Payload for birthday/anniversary notification jobs
 */
export interface EventNotificationPayload {
  /**
   * RecurringEvent ID
   */
  eventId: string;

  /**
   * User ID (for user lookup)
   */
  userId: string;

  /**
   * Scheduled time for this occurrence (UTC)
   */
  scheduledFor: string; // ISO 8601 format

  /**
   * Event type (BIRTHDAY, ANNIVERSARY, etc.)
   */
  eventType: string;

  /**
   * Year of this occurrence
   */
  year: number;
}

/**
 * Type-safe envelope for event notifications
 */
export type EventNotificationEnvelope = JobEnvelope<EventNotificationPayload>;

/**
 * Helper to generate idempotency key
 * Format: event:{eventId}:{year}
 * 
 * @param eventId - RecurringEvent ID
 * @param year - Year of occurrence
 * @returns Idempotency key string
 */
export function generateIdempotencyKey(eventId: string, year: number): string {
  return `event:${eventId}:${year}`;
}

