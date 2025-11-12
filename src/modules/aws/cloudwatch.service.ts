import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudWatchClient,
  PutMetricDataCommand,
  MetricDatum,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { LoggerService } from '../../common/utils/logger.service';

@Injectable()
export class CloudWatchService {
  private readonly client: CloudWatchClient;
  private readonly namespace: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const region = this.configService.get<string>('aws.region') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');

    this.client = new CloudWatchClient({
      region,
      ...(accessKeyId && secretAccessKey ? {
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      } : {}),
    });

    this.namespace =
      this.configService.get<string>('cloudwatch.namespace') ||
      'BirthdayNotifications';
  }

  /**
   * Record a single metric
   */
  async recordMetric(
    metricName: string,
    value: number,
    unit: StandardUnit = StandardUnit.None,
    dimensions?: Record<string, string>,
  ): Promise<void> {
    try {
      const metricData: MetricDatum = {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date(),
        ...(dimensions && {
          Dimensions: Object.entries(dimensions).map(([key, value]) => ({
            Name: key,
            Value: value,
          })),
        }),
      };

      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [metricData],
      });

      await this.client.send(command);

      this.logger.debug('Metric recorded', {
        metricName,
        value,
        unit,
        dimensions,
      });
    } catch (error) {
      this.logger.error('Failed to record metric', error.stack, {
        metricName,
        value,
        error: error.message,
      });
      // Don't throw - metrics shouldn't break the application
    }
  }

  /**
   * Record message delivery success/failure
   */
  async recordDelivery(success: boolean, durationMs: number): Promise<void> {
    await Promise.all([
      this.recordMetric(
        'MessageDeliverySuccess',
        success ? 1 : 0,
        StandardUnit.Count,
      ),
      this.recordMetric(
        'MessageDeliveryDuration',
        durationMs,
        StandardUnit.Milliseconds,
      ),
    ]);
  }

  /**
   * Record queue depth
   */
  async recordQueueDepth(depth: number): Promise<void> {
    await this.recordMetric(
      'PendingMessageCount',
      depth,
      StandardUnit.Count,
    );
  }

  /**
   * Record scheduler execution
   */
  async recordSchedulerExecution(
    messagesCreated: number,
    durationMs: number,
  ): Promise<void> {
    await Promise.all([
      this.recordMetric(
        'SchedulerMessagesCreated',
        messagesCreated,
        StandardUnit.Count,
      ),
      this.recordMetric(
        'SchedulerExecutionDuration',
        durationMs,
        StandardUnit.Milliseconds,
      ),
    ]);
  }

  /**
   * Record worker processing metrics
   */
  async recordWorkerProcessing(
    processed: number,
    failed: number,
    durationMs: number,
  ): Promise<void> {
    await Promise.all([
      this.recordMetric(
        'WorkerMessagesProcessed',
        processed,
        StandardUnit.Count,
      ),
      this.recordMetric('WorkerMessagesFailed', failed, StandardUnit.Count),
      this.recordMetric(
        'WorkerProcessingDuration',
        durationMs,
        StandardUnit.Milliseconds,
      ),
    ]);
  }

  /**
   * Record recovery execution
   */
  async recordRecovery(messagesRecovered: number, messagesSkipped: number): Promise<void> {
    await Promise.all([
      this.recordMetric(
        'RecoveryMessagesRecovered',
        messagesRecovered,
        StandardUnit.Count,
      ),
      this.recordMetric(
        'RecoveryMessagesSkipped',
        messagesSkipped,
        StandardUnit.Count,
      ),
    ]);
  }

  /**
   * Record job processing success
   */
  async recordJobSuccess(jobType: string, durationMs: number): Promise<void> {
    await Promise.all([
      this.recordMetric(
        'JobProcessingSuccess',
        1,
        StandardUnit.Count,
        { JobType: jobType },
      ),
      this.recordMetric(
        'JobProcessingDuration',
        durationMs,
        StandardUnit.Milliseconds,
        { JobType: jobType },
      ),
    ]);
  }

  /**
   * Record job processing failure
   */
  async recordJobFailure(
    jobType: string,
    failureReason: string,
  ): Promise<void> {
    await this.recordMetric(
      'JobProcessingFailure',
      1,
      StandardUnit.Count,
      { JobType: jobType, FailureReason: failureReason },
    );
  }

  /**
   * Record job validation failure
   */
  async recordValidationFailure(validationReason: string): Promise<void> {
    await this.recordMetric(
      'JobValidationFailure',
      1,
      StandardUnit.Count,
      { ValidationReason: validationReason },
    );
  }

  /**
   * Record unregistered job type
   */
  async recordUnregisteredType(jobType: string): Promise<void> {
    await this.recordMetric(
      'JobTypeUnregistered',
      1,
      StandardUnit.Count,
      { JobType: jobType },
    );
  }

  /**
   * Record worker batch processing
   */
  async recordWorkerBatch(
    received: number,
    processed: number,
    failed: number,
  ): Promise<void> {
    await Promise.all([
      this.recordMetric(
        'WorkerMessagesReceived',
        received,
        StandardUnit.Count,
      ),
      this.recordMetric(
        'WorkerMessagesProcessed',
        processed,
        StandardUnit.Count,
      ),
      this.recordMetric(
        'WorkerMessagesFailed',
        failed,
        StandardUnit.Count,
      ),
    ]);
  }
}
