import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '../../../common/utils/logger.service';
import { JobType } from '../enums/job-type.enum';
import { JobProcessor } from '../interfaces/job-processor.interface';

/**
 * Job registry service
 * 
 * Central registry that maps JobType to JobProcessor implementations.
 * This enables the worker to route jobs without knowing business logic.
 * 
 * Design Principles:
 * - Singleton service (provided in JobsModule)
 * - Processors register themselves during module initialization
 * - Registry validates against duplicate registrations
 * - Lookup is O(1) via Map
 * - Immutable after initialization (no unregister method)
 * 
 * Usage Pattern:
 * 1. Create processor implementing JobProcessor<T>
 * 2. In module's OnModuleInit, call registry.register(JobType.X, processor)
 * 3. Worker calls registry.getProcessor(type) to route jobs
 * 
 * @example
 * ```typescript
 * // In processor module
 * export class BirthdayModule implements OnModuleInit {
 *   constructor(
 *     private readonly registry: JobRegistry,
 *     private readonly processor: BirthdayProcessor,
 *   ) {}
 * 
 *   onModuleInit() {
 *     this.registry.register(JobType.BIRTHDAY_NOTIFICATION, this.processor);
 *   }
 * }
 * ```
 */
@Injectable()
export class JobRegistry implements OnModuleInit {
  private readonly processors = new Map<JobType, JobProcessor>();
  private initialized = false;

  constructor(private readonly logger: LoggerService) {}

  async onModuleInit() {
    this.initialized = true;
    this.logger.log('JobRegistry initialized', {
      registeredTypes: Array.from(this.processors.keys()),
      count: this.processors.size,
    });
  }

  /**
   * Register a processor for a job type
   * 
   * @param type - Job type to register
   * @param processor - Processor implementation
   * @throws Error if type is already registered (prevents accidental overwrites)
   */
  register(type: JobType, processor: JobProcessor): void {
    if (this.processors.has(type)) {
      const error = `JobType ${type} is already registered`;
      this.logger.error(error, '', { type });
      throw new Error(error);
    }

    this.processors.set(type, processor);
    this.logger.log('Processor registered', { type });
  }

  /**
   * Get processor for a job type
   * 
   * @param type - Job type to look up
   * @returns Processor if registered, undefined otherwise
   */
  getProcessor(type: JobType): JobProcessor | undefined {
    return this.processors.get(type);
  }

  /**
   * Check if a processor is registered for a job type
   * 
   * @param type - Job type to check
   * @returns true if registered, false otherwise
   */
  hasProcessor(type: JobType): boolean {
    return this.processors.has(type);
  }

  /**
   * Get all registered job types
   * 
   * Useful for debugging and health checks
   * 
   * @returns Array of registered job types
   */
  getRegisteredTypes(): JobType[] {
    return Array.from(this.processors.keys());
  }

  /**
   * Get count of registered processors
   * 
   * Useful for health checks and monitoring
   * 
   * @returns Number of registered processors
   */
  getRegisteredCount(): number {
    return this.processors.size;
  }
}

