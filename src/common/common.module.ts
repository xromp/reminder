import { Module } from '@nestjs/common';
import { LoggerService } from './utils/logger.service';

/**
 * Common module for shared utilities and services
 */
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class CommonModule {}

