import { Test, TestingModule } from '@nestjs/testing';
import { JobRegistry } from './job-registry.service';
import { LoggerService } from '../../../common/utils/logger.service';
import { JobType } from '../enums/job-type.enum';
import { JobProcessor, ProcessorResult } from '../interfaces/job-processor.interface';
import { JobEnvelope } from '../interfaces/job-envelope.interface';

describe('JobRegistry', () => {
  let registry: JobRegistry;
  let loggerService: LoggerService;

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  // Mock processor for testing
  class MockBirthdayProcessor implements JobProcessor {
    async process(envelope: JobEnvelope): Promise<ProcessorResult> {
      return { success: true, metadata: { type: 'birthday' } };
    }
  }

  class MockAnniversaryProcessor implements JobProcessor {
    async process(envelope: JobEnvelope): Promise<ProcessorResult> {
      return { success: true, metadata: { type: 'anniversary' } };
    }
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRegistry,
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    registry = module.get<JobRegistry>(JobRegistry);
    loggerService = module.get<LoggerService>(LoggerService);

    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(registry).toBeDefined();
    });

    it('should log initialization on onModuleInit', async () => {
      await registry.onModuleInit();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'JobRegistry initialized',
        expect.objectContaining({
          registeredTypes: expect.any(Array),
          count: expect.any(Number),
        }),
      );
    });

    it('should start with zero registered processors', () => {
      expect(registry.getRegisteredCount()).toBe(0);
      expect(registry.getRegisteredTypes()).toEqual([]);
    });
  });

  describe('Registration', () => {
    it('should register a processor for a job type', () => {
      const processor = new MockBirthdayProcessor();

      registry.register(JobType.BIRTHDAY_NOTIFICATION, processor);

      expect(registry.hasProcessor(JobType.BIRTHDAY_NOTIFICATION)).toBe(true);
      expect(registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION)).toBe(processor);
      expect(mockLogger.log).toHaveBeenCalledWith('Processor registered', {
        type: JobType.BIRTHDAY_NOTIFICATION,
      });
    });

    it('should register multiple processors for different job types', () => {
      const birthdayProcessor = new MockBirthdayProcessor();
      const anniversaryProcessor = new MockAnniversaryProcessor();

      registry.register(JobType.BIRTHDAY_NOTIFICATION, birthdayProcessor);
      registry.register(JobType.ANNIVERSARY_NOTIFICATION, anniversaryProcessor);

      expect(registry.getRegisteredCount()).toBe(2);
      expect(registry.hasProcessor(JobType.BIRTHDAY_NOTIFICATION)).toBe(true);
      expect(registry.hasProcessor(JobType.ANNIVERSARY_NOTIFICATION)).toBe(true);
    });

    it('should throw error when registering duplicate job type', () => {
      const processor1 = new MockBirthdayProcessor();
      const processor2 = new MockBirthdayProcessor();

      registry.register(JobType.BIRTHDAY_NOTIFICATION, processor1);

      expect(() => {
        registry.register(JobType.BIRTHDAY_NOTIFICATION, processor2);
      }).toThrow('JobType BIRTHDAY_NOTIFICATION is already registered');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'JobType BIRTHDAY_NOTIFICATION is already registered',
        '',
        { type: JobType.BIRTHDAY_NOTIFICATION },
      );
    });

    it('should maintain registration count correctly', () => {
      expect(registry.getRegisteredCount()).toBe(0);

      registry.register(JobType.BIRTHDAY_NOTIFICATION, new MockBirthdayProcessor());
      expect(registry.getRegisteredCount()).toBe(1);

      registry.register(JobType.ANNIVERSARY_NOTIFICATION, new MockAnniversaryProcessor());
      expect(registry.getRegisteredCount()).toBe(2);
    });
  });

  describe('Retrieval', () => {
    beforeEach(() => {
      registry.register(JobType.BIRTHDAY_NOTIFICATION, new MockBirthdayProcessor());
      registry.register(JobType.ANNIVERSARY_NOTIFICATION, new MockAnniversaryProcessor());
    });

    it('should retrieve registered processor by type', () => {
      const processor = registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION);

      expect(processor).toBeInstanceOf(MockBirthdayProcessor);
    });

    it('should return undefined for unregistered job type', () => {
      // Cast to any to test with an invalid type
      const processor = registry.getProcessor('INVALID_TYPE' as any);

      expect(processor).toBeUndefined();
    });

    it('should check if processor is registered', () => {
      expect(registry.hasProcessor(JobType.BIRTHDAY_NOTIFICATION)).toBe(true);
      expect(registry.hasProcessor(JobType.ANNIVERSARY_NOTIFICATION)).toBe(true);
      expect(registry.hasProcessor('INVALID_TYPE' as any)).toBe(false);
    });

    it('should return all registered types', () => {
      const types = registry.getRegisteredTypes();

      expect(types).toHaveLength(2);
      expect(types).toContain(JobType.BIRTHDAY_NOTIFICATION);
      expect(types).toContain(JobType.ANNIVERSARY_NOTIFICATION);
    });
  });

  describe('Processor Execution', () => {
    it('should execute registered processor successfully', async () => {
      const processor = new MockBirthdayProcessor();
      registry.register(JobType.BIRTHDAY_NOTIFICATION, processor);

      const envelope: JobEnvelope = {
        type: JobType.BIRTHDAY_NOTIFICATION,
        version: 1,
        idempotencyKey: 'test-key',
        payload: { test: 'data' },
      };

      const retrievedProcessor = registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION);
      const result = await retrievedProcessor!.process(envelope);

      expect(result.success).toBe(true);
      expect(result.metadata).toEqual({ type: 'birthday' });
    });

    it('should handle processor returning failure', async () => {
      class FailingProcessor implements JobProcessor {
        async process(): Promise<ProcessorResult> {
          return { success: false, error: 'Processing failed' };
        }
      }

      registry.register(JobType.BIRTHDAY_NOTIFICATION, new FailingProcessor());

      const envelope: JobEnvelope = {
        type: JobType.BIRTHDAY_NOTIFICATION,
        version: 1,
        idempotencyKey: 'test-key',
        payload: {},
      };

      const processor = registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION);
      const result = await processor!.process(envelope);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Processing failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty registry gracefully', () => {
      expect(registry.getRegisteredCount()).toBe(0);
      expect(registry.getRegisteredTypes()).toEqual([]);
      expect(registry.hasProcessor(JobType.BIRTHDAY_NOTIFICATION)).toBe(false);
      expect(registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION)).toBeUndefined();
    });

    it('should preserve processor instances (not create new ones)', () => {
      const processor = new MockBirthdayProcessor();
      registry.register(JobType.BIRTHDAY_NOTIFICATION, processor);

      const retrieved1 = registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION);
      const retrieved2 = registry.getProcessor(JobType.BIRTHDAY_NOTIFICATION);

      expect(retrieved1).toBe(processor);
      expect(retrieved2).toBe(processor);
      expect(retrieved1).toBe(retrieved2);
    });
  });

  describe('Type Safety', () => {
    it('should enforce JobType enum for registration', () => {
      const processor = new MockBirthdayProcessor();

      // This should compile (valid JobType)
      registry.register(JobType.BIRTHDAY_NOTIFICATION, processor);

      // This would NOT compile if uncommented (TypeScript compile-time check):
      // registry.register('INVALID_STRING', processor);
    });

    it('should enforce JobProcessor interface for processors', () => {
      // This should compile (implements JobProcessor)
      registry.register(JobType.BIRTHDAY_NOTIFICATION, new MockBirthdayProcessor());

      // This would NOT compile if uncommented (missing process method):
      // registry.register(JobType.BIRTHDAY_NOTIFICATION, {} as any);
    });
  });
});

