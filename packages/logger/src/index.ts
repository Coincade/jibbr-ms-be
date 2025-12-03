export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export class Logger {
  constructor(private serviceName: string) {}

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      message,
      ...meta,
    };
    console.log(JSON.stringify(logEntry));
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.WARN, message, meta);
  }

  error(
    message: string,
    error?: Error,
    meta?: Record<string, unknown>
  ) {
    this.log(LogLevel.ERROR, message, {
      ...meta,
      error: error?.message,
      stack: error?.stack,
    });
  }
}

