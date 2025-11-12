import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../../common/utils/logger.service';
import { SqsService } from '../../aws/sqs.service';
import { CloudWatchService } from '../../aws/cloudwatch.service';
import { JobRegistry } from '../registry/job-registry.service';
import { JobEnvelope } from '../interfaces/job-envelope.interface';
import { JobType } from '../enums/job-type.enum';
import { Message } from '@aws-sdk/client-sqs';

/**
 * Generic job worker service
 * 
 * Polls SQS queue, validates job envelopes, routes to registered processors,
 * and records metrics. This worker is completely generic and has NO business
 * logic - all business logic lives in job processors.
 * 
 * Key Features:
 * - Configurable concurrency (process N messages in parallel)
 * - Envelope validation (fail-fast for invalid messages)
 * - Type-safe routing via JobRegistry
 * - Comprehensive metrics and logging
 * - Graceful shutdown
 * 
 * Error Handling:
 * - Invalid envelope → Delete message (cannot be processed)
 * - Unregistered job type → Delete message (no processor exists)
 * - Processor failure → Keep message (SQS will retry)
 * - Processor success → Delete message
 */
@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly enabled: boolean;
  private readonly concurrency: number;
  private readonly pollInterval: number;
  private readonly visibilityTimeout: number;
  private isRunning = false;
  private shutdownRequested = false;
  private pollingPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly sqsService: SqsService,
    private readonly cloudWatch: CloudWatchService,
    private readonly jobRegistry: JobRegistry,
  ) {
    this.enabled = this.config.get<boolean>('worker.enabled', false);
    this.concurrency = this.config.get<number>('worker.concurrency', 10);
    this.pollInterval = this.config.get<number>('worker.pollInterval', 5000);
    this.visibilityTimeout = this.config.get<number>('worker.visibilityTimeout', 30);

    if (this.enabled) {
      this.logger.log('Job Worker Service enabled', {
        concurrency: this.concurrency,
        pollInterval: this.pollInterval,
        visibilityTimeout: this.visibilityTimeout,
      });
    } else {
      this.logger.warn('Job Worker Service disabled');
    }
  }

  async onModuleInit() {
    if (this.enabled) {
      this.logger.log('Starting job worker polling loop');
      this.pollingPromise = this.startPolling();
    }
  }

  async onModuleDestroy() {
    if (this.enabled && this.isRunning) {
      this.logger.log('Shutting down job worker gracefully');
      this.shutdownRequested = true;
      
      // Wait for current batch to complete (with timeout)
      if (this.pollingPromise) {
        await Promise.race([
          this.pollingPromise,
          new Promise((resolve) => setTimeout(resolve, 10000)), // 10s timeout
        ]);
      }
      
      this.logger.log('Job worker shut down complete');
    }
  }

  /**
   * Main polling loop
   * Continuously polls SQS and processes messages until shutdown
   */
  private async startPolling(): Promise<void> {
    this.isRunning = true;

    while (!this.shutdownRequested) {
      try {
        await this.pollAndProcessBatch();
        
        // Sleep between batches
        if (!this.shutdownRequested) {
          await this.sleep(this.pollInterval);
        }
      } catch (error) {
        this.logger.error('Error in polling loop', error.stack, {
          error: error.message,
        });
        
        // Back off on errors
        await this.sleep(this.pollInterval * 2);
      }
    }

    this.isRunning = false;
  }

  /**
   * Poll SQS and process a batch of messages
   */
  private async pollAndProcessBatch(): Promise<void> {
    const startTime = Date.now();

    try {
      // Receive messages from SQS
      const messages = await this.sqsService.receiveMessages(
        this.concurrency,
        5, // Wait time seconds (long polling)
        this.visibilityTimeout,
      );

      if (messages.length === 0) {
        this.logger.debug('No messages received from SQS');
        return;
      }

      this.logger.log('Received messages from SQS', {
        count: messages.length,
      });

      // Process all messages concurrently
      const results = await Promise.allSettled(
        messages.map((message) => this.processMessage(message)),
      );

      // Count results
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      // Record batch metrics
      await this.cloudWatch.recordWorkerBatch(
        messages.length,
        succeeded,
        failed,
      );

      const durationMs = Date.now() - startTime;
      this.logger.log('Batch processing complete', {
        received: messages.length,
        succeeded,
        failed,
        durationMs,
      });
    } catch (error) {
      this.logger.error('Failed to poll and process batch', error.stack, {
        error: error.message,
      });
    }
  }

  /**
   * Process a single SQS message
   * 
   * @param message - SQS message
   */
  private async processMessage(message: Message): Promise<void> {
    const startTime = Date.now();
    const receiptHandle = message.ReceiptHandle!;
    const messageId = message.MessageId || 'unknown';

    try {
      // Parse envelope from message body
      const envelope = this.parseEnvelope(message.Body!);
      if (!envelope) {
        // Invalid JSON or missing body
        await this.handleValidationFailure(
          'InvalidJSON',
          receiptHandle,
          messageId,
        );
        return;
      }

      // Validate envelope structure
      const validationError = this.validateEnvelope(envelope);
      if (validationError) {
        await this.handleValidationFailure(
          validationError,
          receiptHandle,
          messageId,
          envelope,
        );
        return;
      }

      // Check if processor is registered
      if (!this.jobRegistry.hasProcessor(envelope.type)) {
        await this.handleUnregisteredType(
          envelope,
          receiptHandle,
          messageId,
        );
        return;
      }

      // Get processor and execute
      const processor = this.jobRegistry.getProcessor(envelope.type)!;
      const result = await processor.process(envelope);

      const durationMs = Date.now() - startTime;

      if (result.success) {
        await this.handleSuccess(envelope, receiptHandle, messageId, durationMs, result.metadata);
      } else {
        await this.handleProcessorFailure(envelope, receiptHandle, messageId, result.error);
      }
    } catch (error) {
      // Unexpected error during processing
      this.logger.error('Unexpected error processing message', error.stack, {
        messageId,
        error: error.message,
      });
      
      // Don't delete - let SQS retry
    }
  }

  /**
   * Parse JSON envelope from message body
   */
  private parseEnvelope(body: string): JobEnvelope | null {
    try {
      return JSON.parse(body) as JobEnvelope;
    } catch (error) {
      this.logger.error('Failed to parse message body as JSON', '', {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Validate envelope structure
   * 
   * @returns Error message if invalid, null if valid
   */
  private validateEnvelope(envelope: any): string | null {
    if (!envelope.type) {
      return 'MissingType';
    }

    if (!envelope.version) {
      return 'MissingVersion';
    }

    if (!envelope.idempotencyKey) {
      return 'MissingIdempotencyKey';
    }

    if (envelope.payload === undefined) {
      return 'MissingPayload';
    }

    // Check if type is a valid JobType enum value
    if (!Object.values(JobType).includes(envelope.type)) {
      return 'InvalidJobType';
    }

    return null;
  }

  /**
   * Handle successful processing
   */
  private async handleSuccess(
    envelope: JobEnvelope,
    receiptHandle: string,
    messageId: string,
    durationMs: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    this.logger.log('Job processed successfully', {
      jobType: envelope.type,
      idempotencyKey: envelope.idempotencyKey,
      messageId,
      durationMs,
      ...metadata,
    });

    // Record success metrics
    await this.cloudWatch.recordJobSuccess(envelope.type, durationMs);

    // Delete message from queue
    await this.sqsService.deleteMessage(receiptHandle);
  }

  /**
   * Handle processor failure (processor returned success: false)
   */
  private async handleProcessorFailure(
    envelope: JobEnvelope,
    receiptHandle: string,
    messageId: string,
    errorMessage?: string,
  ): Promise<void> {
    this.logger.error('Job processing failed', '', {
      jobType: envelope.type,
      idempotencyKey: envelope.idempotencyKey,
      messageId,
      error: errorMessage || 'Unknown error',
    });

    // Record failure metrics
    await this.cloudWatch.recordJobFailure(
      envelope.type,
      errorMessage || 'ProcessorReturnedFailure',
    );

    // Do NOT delete message - let SQS retry
  }

  /**
   * Handle validation failure (delete message immediately)
   */
  private async handleValidationFailure(
    validationReason: string,
    receiptHandle: string,
    messageId: string,
    envelope?: Partial<JobEnvelope>,
  ): Promise<void> {
    this.logger.error('Job validation failed', '', {
      validationReason,
      messageId,
      envelope,
    });

    // Record validation failure metric
    await this.cloudWatch.recordValidationFailure(validationReason);

    // Delete invalid message (cannot be processed)
    await this.sqsService.deleteMessage(receiptHandle);
  }

  /**
   * Handle unregistered job type (delete message immediately)
   */
  private async handleUnregisteredType(
    envelope: JobEnvelope,
    receiptHandle: string,
    messageId: string,
  ): Promise<void> {
    const registeredTypes = this.jobRegistry.getRegisteredTypes();
    
    this.logger.error('Job type not registered', '', {
      jobType: envelope.type,
      idempotencyKey: envelope.idempotencyKey,
      messageId,
      registeredTypes,
    });

    // Record unregistered type metric
    await this.cloudWatch.recordUnregisteredType(envelope.type);

    // Delete message (no processor exists)
    // If DLQ is configured, SQS will route after maxReceiveCount
    await this.sqsService.deleteMessage(receiptHandle);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get worker status (for health checks)
   */
  getStatus(): {
    enabled: boolean;
    isRunning: boolean;
    config: {
      concurrency: number;
      pollInterval: number;
      visibilityTimeout: number;
    };
  } {
    return {
      enabled: this.enabled,
      isRunning: this.isRunning,
      config: {
        concurrency: this.concurrency,
        pollInterval: this.pollInterval,
        visibilityTimeout: this.visibilityTimeout,
      },
    };
  }
}

