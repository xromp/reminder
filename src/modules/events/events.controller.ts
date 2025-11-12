import { Controller, Post } from '@nestjs/common';
import { EventSchedulerService } from './event-scheduler.service';

/**
 * Admin controller for event management
 * TEMPORARY: For testing and manual triggering
 */
@Controller('admin/events')
export class EventsController {
  constructor(private readonly schedulerService: EventSchedulerService) {}

  @Post('schedule')
  async triggerScheduler() {
    const scheduled = await this.schedulerService.scheduleUpcomingOccurrences();
    return {
      success: true,
      scheduled,
      message: `Scheduled ${scheduled} upcoming events`,
    };
  }
}

