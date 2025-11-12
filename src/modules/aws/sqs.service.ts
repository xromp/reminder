import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { LoggerService } from '../../common/utils/logger.service';
import { JobEnvelope } from '../jobs/interfaces/job-envelope.interface';

@Injectable()
export class SqsService {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const region = this.configService.get<string>('aws.region') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');
    const endpoint = this.configService.get<string>('aws.endpoint');

    this.client = new SQSClient({
      region,
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey ? {
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      } : {}),
    });

    this.queueUrl = this.configService.get<string>('sqs.queueUrl') || '';
    this.dlqUrl = this.configService.get<string>('sqs.dlqUrl') || '';
  }

  /**
   * Send a single message to SQS queue
   * 
   * @param envelope - Generic job envelope with type, version, idempotencyKey, and payload
   * @param delaySeconds - Optional delay before message becomes available
   */
  async sendMessage(
    envelope: JobEnvelope,
    delaySeconds?: number,
  ): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageDeduplicationId: envelope.idempotencyKey,
        MessageGroupId: 'notifications', // Generic group (for FIFO queues)
        DelaySeconds: delaySeconds,
      });

      await this.client.send(command);

      this.logger.log('Message sent to SQS', {
        idempotencyKey: envelope.idempotencyKey,
        type: envelope.type,
        version: envelope.version,
        delaySeconds,
      });
    } catch (error) {
      this.logger.error('Failed to send message to SQS', error.stack, {
        idempotencyKey: envelope.idempotencyKey,
        type: envelope.type,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send batch of messages to SQS (up to 10 messages)
   * 
   * @param envelopes - Array of job envelopes to send
   */
  async sendBatch(envelopes: JobEnvelope[]): Promise<void> {
    if (envelopes.length === 0) return;
    if (envelopes.length > 10) {
      throw new Error('SQS batch limit is 10 messages');
    }

    try {
      const entries: SendMessageBatchRequestEntry[] = envelopes.map((envelope) => ({
        Id: envelope.idempotencyKey,
        MessageBody: JSON.stringify(envelope),
        MessageDeduplicationId: envelope.idempotencyKey,
        MessageGroupId: 'notifications', // Generic group (for FIFO queues)
      }));

      const command = new SendMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: entries,
      });

      const result = await this.client.send(command);

      // Handle partial failures
      if (result.Failed && result.Failed.length > 0) {
        this.logger.warn('Some messages failed to send', {
          failed: result.Failed,
          successful: result.Successful?.length || 0,
        });
      }

      this.logger.log('Batch sent to SQS', {
        total: envelopes.length,
        successful: result.Successful?.length || 0,
        failed: result.Failed?.length || 0,
      });
    } catch (error) {
      this.logger.error('Failed to send batch to SQS', error.stack, {
        messageCount: envelopes.length,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Move message to Dead Letter Queue
   */
  async moveToDLQ(messageId: string, messageBody: any): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: JSON.stringify({
          ...messageBody,
          movedToDLQAt: new Date().toISOString(),
          originalMessageId: messageId,
        }),
      });

      await this.client.send(command);

      this.logger.warn('Message moved to DLQ', {
        messageId,
      });
    } catch (error) {
      this.logger.error('Failed to move message to DLQ', error.stack, {
        messageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Receive messages from queue
   * 
   * @param maxMessages - Maximum number of messages to receive (1-10)
   * @param waitTimeSeconds - Long polling wait time (default: 5s)
   * @param visibilityTimeout - How long messages are hidden from other consumers (default: 30s)
   * @returns Array of SQS messages
   */
  async receiveMessages(
    maxMessages: number = 10,
    waitTimeSeconds: number = 5,
    visibilityTimeout: number = 30,
  ): Promise<Message[]> {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10), // AWS limit is 10
        WaitTimeSeconds: waitTimeSeconds, // Long polling
        VisibilityTimeout: visibilityTimeout,
        AttributeNames: ['All'], // Include all message attributes
        MessageAttributeNames: ['All'],
      });

      const result = await this.client.send(command);
      return result.Messages || [];
    } catch (error) {
      this.logger.error('Failed to receive messages from SQS', error.stack, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete message from queue after successful processing
   */
  async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.client.send(command);
    } catch (error) {
      this.logger.error('Failed to delete message from SQS', error.stack, {
        error: error.message,
      });
      throw error;
    }
  }
}
