import { Module, Global } from '@nestjs/common';
import { JobRegistry } from './registry/job-registry.service';
import { JobWorkerService } from './worker/job-worker.service';
import { CommonModule } from '../../common/common.module';
import { AwsModule } from '../aws/aws.module';

/**
 * Jobs module for job envelope, processor registry, and worker
 * 
 * This module provides the infrastructure for type-safe job routing:
 * - JobType enum for type-safe job types
 * - JobEnvelope interface for standardized message structure
 * - JobProcessor interface for processor contract
 * - JobRegistry service for processor registration and lookup
 * 
 * The module is marked as @Global() so JobRegistry is available everywhere
 * without explicit imports. This is necessary because multiple modules
 * (birthday, anniversary, etc.) need to register their processors.
 * 
 * Usage Pattern:
 * 
 * 1. **Create a Processor:**
 * ```typescript
 * @Injectable()
 * export class BirthdayProcessor implements JobProcessor<EventNotificationPayload> {
 *   async process(envelope: JobEnvelope<EventNotificationPayload>): Promise<ProcessorResult> {
 *     // ... processing logic
 *     return { success: true, metadata: { ... } };
 *   }
 * }
 * ```
 * 
 * 2. **Register Processor in Module:**
 * ```typescript
 * @Module({
 *   providers: [BirthdayProcessor],
 * })
 * export class BirthdayModule implements OnModuleInit {
 *   constructor(
 *     private readonly jobRegistry: JobRegistry,
 *     private readonly birthdayProcessor: BirthdayProcessor,
 *   ) {}
 * 
 *   onModuleInit() {
 *     this.jobRegistry.register(JobType.BIRTHDAY_NOTIFICATION, this.birthdayProcessor);
 *   }
 * }
 * ```
 * 
 * 3. **Route Jobs in Worker:**
 * ```typescript
 * @Injectable()
 * export class WorkerService {
 *   constructor(private readonly jobRegistry: JobRegistry) {}
 * 
 *   async processMessage(envelope: JobEnvelope): Promise<void> {
 *     const processor = this.jobRegistry.getProcessor(envelope.type);
 *     if (!processor) {
 *       throw new Error(`No processor for job type: ${envelope.type}`);
 *     }
 *     const result = await processor.process(envelope);
 *     // ... handle result
 *   }
 * }
 * ```
 */
@Global()
@Module({
  imports: [CommonModule, AwsModule],
  providers: [JobRegistry, JobWorkerService],
  exports: [JobRegistry, JobWorkerService],
})
export class JobsModule {}

