import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './modules/user/user.module';
import { BirthdayModule } from './modules/birthday/birthday.module';
import { NotificationModule } from './modules/notification/notification.module';
import { HealthModule } from './modules/health/health.module';
import { AwsModule } from './modules/aws/aws.module';
import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Bull Queue (for SQS processing)
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),

    // Database
    DatabaseModule,

    // AWS services
    AwsModule,

    // Feature modules
    UserModule,
    BirthdayModule,
    NotificationModule,
    HealthModule,
  ],
})
export class AppModule {}
