import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const checks = {
      database: await this.checkDatabase(),
      memory: this.checkMemory(),
      uptime: process.uptime(),
    };

    const allHealthy = Object.values(checks).every((v) =>
      typeof v === 'boolean' ? v : true
    );

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }

  private checkMemory(): boolean {
    const usage = process.memoryUsage();
    const limitMB = 500;
    return usage.heapUsed < limitMB * 1024 * 1024;
  }
}
