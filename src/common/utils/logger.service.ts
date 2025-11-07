import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface LogContext {
  [key: string]: any;
  correlationId?: string;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private static asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

  private formatLog(level: string, message: string, context?: LogContext) {
    const store = LoggerService.asyncLocalStorage.getStore();
    const correlationId = store?.get('correlationId') || context?.correlationId;

    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...(correlationId && { correlationId }),
    });
  }

  log(message: string, context?: LogContext) {
    console.log(this.formatLog('info', message, context));
  }

  error(message: string, trace?: string, context?: LogContext) {
    console.error(
      this.formatLog('error', message, {
        ...context,
        ...(trace && { stack: trace }),
      }),
    );
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatLog('warn', message, context));
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatLog('debug', message, context));
    }
  }

  verbose(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.log(this.formatLog('verbose', message, context));
    }
  }

  // Set correlation ID for request tracing
  static setCorrelationId(correlationId: string) {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      store.set('correlationId', correlationId);
    }
  }

  // Run function with correlation context
  static async runWithContext<T>(
    correlationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const store = new Map();
    store.set('correlationId', correlationId);
    return this.asyncLocalStorage.run(store, fn);
  }
}
