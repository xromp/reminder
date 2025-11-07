import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { LoggerService } from '../../common/utils/logger.service';

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

    this.client = new SQSClient({
      region,
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
   */
  async sendMessage(
    messageId: string,
    messageBody: any,
    delaySeconds?: number,
  ): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(messageBody),
        MessageDeduplicationId: messageId,
        MessageGroupId: 'birthday-messages', // For FIFO queues
        DelaySeconds: delaySeconds,
      });

      await this.client.send(command);

      this.logger.log('Message sent to SQS', {
        messageId,
        delaySeconds,
      });
    } catch (error) {
      this.logger.error('Failed to send message to SQS', error.stack, {
        messageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send batch of messages to SQS (up to 10 messages)
   */
  async sendBatch(messages: Array<{ id: string; body: any }>): Promise<void> {
    if (messages.length === 0) return;
    if (messages.length > 10) {
      throw new Error('SQS batch limit is 10 messages');
    }

    try {
      const entries: SendMessageBatchRequestEntry[] = messages.map((msg) => ({
        Id: msg.id,
        MessageBody: JSON.stringify(msg.body),
        MessageDeduplicationId: msg.id,
        MessageGroupId: 'birthday-messages',
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
        total: messages.length,
        successful: result.Successful?.length || 0,
        failed: result.Failed?.length || 0,
      });
    } catch (error) {
      this.logger.error('Failed to send batch to SQS', error.stack, {
        messageCount: messages.length,
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
