import { Module } from '@nestjs/common';
import { SqsService } from './sqs.service';
import { CloudWatchService } from './cloudwatch.service';
import { LoggerService } from '../../common/utils/logger.service';

@Module({
  providers: [SqsService, CloudWatchService, LoggerService],
  exports: [SqsService, CloudWatchService],
})
export class AwsModule {}
