import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { LoggerService } from './common/utils/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new LoggerService(),
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS
  app.enableCors();

  await app.listen(port);

  const logger = app.get(LoggerService);
  logger.log(`Birthday Notification Service running on port ${port}`, {
    environment: configService.get('NODE_ENV', 'development'),
    schedulerEnabled: configService.get('SCHEDULER_ENABLED', false),
    workerEnabled: configService.get('WORKER_ENABLED', false),
  });
}

bootstrap();
