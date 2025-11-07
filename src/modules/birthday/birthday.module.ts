import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler/scheduler.service';
import { WorkerService } from './scheduler/worker.service';
import { RecoveryService } from './scheduler/recovery.service';
import { BirthdayController } from './birthday.controller';
import { AwsModule } from '../aws/aws.module';
import { NotificationModule } from '../notification/notification.module';
import { LoggerService } from '../../common/utils/logger.service';

@Module({
  imports: [AwsModule, NotificationModule],
  controllers: [BirthdayController],
  providers: [SchedulerService, WorkerService, RecoveryService, LoggerService],
  exports: [SchedulerService, WorkerService, RecoveryService],
})
export class BirthdayModule {}
