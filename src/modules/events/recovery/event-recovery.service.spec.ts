import { Test, TestingModule } from '@nestjs/testing';
import { EventRecoveryService } from './event-recovery.service';
import { PrismaService } from '../../../database/prisma.service';
import { SqsService } from '../../aws/sqs.service';
import { CloudWatchService } from '../../aws/cloudwatch.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { ConfigService } from '@nestjs/config';
import { nextOccurrence } from '../../../common/utils/next-occurrence.util';
import { addDays, subDays, subHours, getYear } from 'date-fns';

jest.mock('../../../common/utils/next-occurrence.util');

describe('EventRecoveryService', () => {
  let service: EventRecoveryService;
  let prismaService: PrismaService;
  let sqsService: SqsService;
  let cloudWatchService: CloudWatchService;
  let loggerService: LoggerService;
  let configService: ConfigService;

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockCloudWatch = {
    recordRecovery: jest.fn().mockResolvedValue(undefined),
  };

  const mockSqs = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrisma = {
    recurringEvent: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    scheduledNotification: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'recovery.enabled') return true;
      if (key === 'recovery.gracePeriodMinutes') return 7200; // 120 hours
      return defaultValue;
    }),
  };

  const mockEvent = {
    id: 'event-123',
    userId: 'user-456',
    type: 'BIRTHDAY',
    eventDate: new Date(2000, 4, 15), // May 15
    notificationTime: '09:00:00',
    enabled: true,
    user: {
      id: 'user-456',
      timezone: 'America/New_York',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventRecoveryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SqsService, useValue: mockSqs },
        { provide: CloudWatchService, useValue: mockCloudWatch },
        { provide: LoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EventRecoveryService>(EventRecoveryService);
    prismaService = module.get<PrismaService>(PrismaService);
    sqsService = module.get<SqsService>(SqsService);
    cloudWatchService = module.get<CloudWatchService>(CloudWatchService);
    loggerService = module.get<LoggerService>(LoggerService);
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should be enabled when config is true', async () => {
      // Clear mocks before creating a fresh service instance
      jest.clearAllMocks();
      
      const module = await Test.createTestingModule({
        providers: [
          EventRecoveryService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: SqsService, useValue: mockSqs },
          { provide: CloudWatchService, useValue: mockCloudWatch },
          { provide: LoggerService, useValue: mockLogger },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const testService = module.get<EventRecoveryService>(EventRecoveryService);
      
      expect(testService).toBeDefined();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Event Recovery Service enabled',
        expect.objectContaining({
          gracePeriodHours: 120,
          gracePeriodMinutes: 7200,
        }),
      );
    });

    it('should be disabled when config is false', async () => {
      jest.clearAllMocks();
      mockConfigService.get = jest.fn((key: string) => {
        if (key === 'recovery.enabled') return false;
        if (key === 'recovery.gracePeriodMinutes') return 7200;
      });

      const module = await Test.createTestingModule({
        providers: [
          EventRecoveryService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: SqsService, useValue: mockSqs },
          { provide: CloudWatchService, useValue: mockCloudWatch },
          { provide: LoggerService, useValue: mockLogger },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const disabledService = module.get<EventRecoveryService>(EventRecoveryService);
      expect(disabledService).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith('Event Recovery Service disabled');
    });

    it('should use default grace period if not configured', async () => {
      jest.clearAllMocks();
      mockConfigService.get = jest.fn((key: string, defaultValue?: any) => {
        if (key === 'recovery.enabled') return true;
        return defaultValue; // Return default for gracePeriodHours
      });

      const module = await Test.createTestingModule({
        providers: [
          EventRecoveryService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: SqsService, useValue: mockSqs },
          { provide: CloudWatchService, useValue: mockCloudWatch },
          { provide: LoggerService, useValue: mockLogger },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const defaultService = module.get<EventRecoveryService>(EventRecoveryService);
      expect(defaultService).toBeDefined();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Event Recovery Service enabled',
        expect.objectContaining({
          gracePeriodHours: 120, // Default value (7200 minutes / 60)
          gracePeriodMinutes: 7200,
        }),
      );
    });
  });

  describe('recoverMissedOccurrences', () => {
    it('should return zeros when no events found', async () => {
      mockPrisma.recurringEvent.findMany.mockResolvedValue([]);

      const result = await service.recoverMissedOccurrences();

      expect(result).toEqual({
        totalMissed: 0,
        recovered: 0,
        skipped: 0,
        alreadyScheduled: 0,
      });
      expect(mockLogger.log).toHaveBeenCalledWith('No enabled events found for recovery');
    });

    it('should skip occurrences in the future', async () => {
      const futureOccurrence = addDays(new Date(), 30);
      (nextOccurrence as jest.Mock).mockReturnValue(futureOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([mockEvent]);

      const result = await service.recoverMissedOccurrences();

      expect(result.totalMissed).toBe(0);
      expect(mockPrisma.scheduledNotification.findFirst).not.toHaveBeenCalled();
    });

    it('should skip occurrences outside grace period', async () => {
      const oldOccurrence = subDays(new Date(), 10); // 240 hours ago (> 120 grace period)
      (nextOccurrence as jest.Mock).mockReturnValue(oldOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([mockEvent]);

      const result = await service.recoverMissedOccurrences();

      expect(result.totalMissed).toBe(0);
      expect(mockPrisma.scheduledNotification.create).not.toHaveBeenCalled();
    });

    it('should skip occurrences that are already scheduled', async () => {
      const recentOccurrence = subHours(new Date(), 24); // 24 hours ago (within grace period)
      (nextOccurrence as jest.Mock).mockReturnValue(recentOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([mockEvent]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue({
        id: 'notification-123',
        eventId: mockEvent.id,
        scheduledFor: recentOccurrence,
      });

      const result = await service.recoverMissedOccurrences();

      expect(result.alreadyScheduled).toBe(3); // Checked for 3 years
      expect(mockPrisma.scheduledNotification.create).not.toHaveBeenCalled();
    });

    it('should recover a missed occurrence within grace period', async () => {
      const missedOccurrence = subHours(new Date(), 48); // 48 hours ago (within grace period)
      (nextOccurrence as jest.Mock).mockReturnValue(missedOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([mockEvent]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null); // Not scheduled
      mockPrisma.scheduledNotification.create.mockResolvedValue({
        id: 'notification-new',
        eventId: mockEvent.id,
        scheduledFor: missedOccurrence,
        status: 'PENDING',
      });

      const result = await service.recoverMissedOccurrences();

      expect(result.totalMissed).toBeGreaterThan(0);
      expect(result.recovered).toBeGreaterThan(0);
      expect(mockPrisma.scheduledNotification.create).toHaveBeenCalled();
      expect(mockSqs.sendMessage).toHaveBeenCalled();
      expect(mockCloudWatch.recordRecovery).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('should handle duplicate constraint violations gracefully', async () => {
      const missedOccurrence = subHours(new Date(), 48);
      (nextOccurrence as jest.Mock).mockReturnValue(missedOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([mockEvent]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null);
      mockPrisma.scheduledNotification.create.mockRejectedValue({
        code: 'P2002', // Prisma unique constraint violation
      });

      const result = await service.recoverMissedOccurrences();

      expect(result.skipped).toBeGreaterThan(0);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Occurrence already recovered',
        expect.any(Object),
      );
    });

    it('should recover multiple events', async () => {
      const event1 = { ...mockEvent, id: 'event-1' };
      const event2 = { ...mockEvent, id: 'event-2', type: 'ANNIVERSARY' };

      const missedOccurrence = subHours(new Date(), 48);
      (nextOccurrence as jest.Mock).mockReturnValue(missedOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([event1, event2]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null);
      mockPrisma.scheduledNotification.create.mockResolvedValue({
        id: 'notification-new',
        eventId: 'event-1',
        scheduledFor: missedOccurrence,
        status: 'PENDING',
      });

      const result = await service.recoverMissedOccurrences();

      expect(result.recovered).toBeGreaterThan(0);
      expect(mockSqs.sendMessage).toHaveBeenCalled();
    });

    it('should log errors but continue processing other events', async () => {
      const event1 = { ...mockEvent, id: 'event-1' };
      const event2 = { ...mockEvent, id: 'event-2' };

      const missedOccurrence = subHours(new Date(), 48);
      (nextOccurrence as jest.Mock).mockReturnValue(missedOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([event1, event2]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null);
      
      // First event fails, second succeeds
      mockPrisma.scheduledNotification.create
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({
          id: 'notification-new',
          eventId: 'event-2',
          scheduledFor: missedOccurrence,
          status: 'PENDING',
        });

      const result = await service.recoverMissedOccurrences();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(result.recovered).toBeGreaterThan(0);
    });

    it('should check last year, current year, and next year', async () => {
      const now = new Date();
      const currentYear = getYear(now);
      
      const pastOccurrence = new Date(currentYear - 1, 4, 15, 9, 0, 0);
      const currentOccurrence = new Date(currentYear, 4, 15, 9, 0, 0);
      const futureOccurrence = new Date(currentYear + 1, 4, 15, 9, 0, 0);

      (nextOccurrence as jest.Mock)
        .mockReturnValueOnce(pastOccurrence)
        .mockReturnValueOnce(currentOccurrence)
        .mockReturnValueOnce(futureOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([mockEvent]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null);
      mockPrisma.scheduledNotification.create.mockResolvedValue({
        id: 'notification-new',
        eventId: mockEvent.id,
        scheduledFor: pastOccurrence,
        status: 'PENDING',
      });

      await service.recoverMissedOccurrences();

      // nextOccurrence should be called 3 times (last year, current, next)
      expect(nextOccurrence).toHaveBeenCalledTimes(3);
    });
  });

  describe('triggerRecovery', () => {
    it('should call recoverMissedOccurrences', async () => {
      mockPrisma.recurringEvent.findMany.mockResolvedValue([]);

      const result = await service.triggerRecovery();

      expect(result).toEqual({
        totalMissed: 0,
        recovered: 0,
        skipped: 0,
        alreadyScheduled: 0,
      });
      expect(mockLogger.log).toHaveBeenCalled();
    });
  });

  describe('getRecoveryStats', () => {
    it('should return recovery statistics', async () => {
      mockPrisma.recurringEvent.count.mockResolvedValue(42);

      const stats = await service.getRecoveryStats();

      expect(stats.enabledEvents).toBe(42);
      expect(stats.gracePeriodHours).toBe(120);
      expect(stats.gracePeriodCutoff).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('JobEnvelope generation', () => {
    it('should create proper JobEnvelope for BIRTHDAY events', async () => {
      const event = {
        ...mockEvent,
        type: 'BIRTHDAY',
      };

      const missedOccurrence = subHours(new Date(), 48);
      (nextOccurrence as jest.Mock).mockReturnValue(missedOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([event]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null);
      mockPrisma.scheduledNotification.create.mockResolvedValue({
        id: 'notification-123',
        eventId: event.id,
        scheduledFor: missedOccurrence,
        status: 'PENDING',
      });

      await service.recoverMissedOccurrences();

      expect(mockSqs.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BIRTHDAY_NOTIFICATION',
          version: 1,
          idempotencyKey: expect.stringMatching(/^event:event-123:\d{4}$/),
          payload: expect.objectContaining({
            eventId: event.id,
            userId: event.userId,
            eventType: 'BIRTHDAY',
            year: expect.any(Number),
          }),
        }),
      );
    });

    it('should create proper JobEnvelope for ANNIVERSARY events', async () => {
      const event = {
        ...mockEvent,
        type: 'ANNIVERSARY',
      };

      const missedOccurrence = subHours(new Date(), 48);
      (nextOccurrence as jest.Mock).mockReturnValue(missedOccurrence);

      mockPrisma.recurringEvent.findMany.mockResolvedValue([event]);
      mockPrisma.scheduledNotification.findFirst.mockResolvedValue(null);
      mockPrisma.scheduledNotification.create.mockResolvedValue({
        id: 'notification-123',
        eventId: event.id,
        scheduledFor: missedOccurrence,
        status: 'PENDING',
      });

      await service.recoverMissedOccurrences();

      expect(mockSqs.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ANNIVERSARY_NOTIFICATION',
          version: 1,
          payload: expect.objectContaining({
            eventType: 'ANNIVERSARY',
          }),
        }),
      );
    });
  });
});

