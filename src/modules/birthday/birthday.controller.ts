import { Controller, Post, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { SchedulerService } from './scheduler/scheduler.service';
import { RecoveryService } from './scheduler/recovery.service';

/**
 * Admin endpoints for manual triggering and monitoring
 * In production, these should be protected with authentication
 */
@Controller('admin/birthday')
export class BirthdayController {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly recoveryService: RecoveryService,
  ) {}

  /**
   * Manually trigger birthday scheduling
   * Useful for testing or debugging
   */
  @Post('schedule')
  @HttpCode(HttpStatus.OK)
  async triggerScheduling() {
    return this.schedulerService.triggerScheduling();
  }

  /**
   * Manually trigger recovery of missed messages
   * Useful after prolonged downtime
   */
  @Post('recover')
  @HttpCode(HttpStatus.OK)
  async triggerRecovery() {
    return this.recoveryService.triggerRecovery();
  }

  /**
   * Get recovery statistics
   */
  @Get('recovery-stats')
  async getRecoveryStats() {
    return this.recoveryService.getRecoveryStats();
  }
}
