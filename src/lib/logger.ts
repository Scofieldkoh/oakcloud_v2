/* eslint-disable no-console -- Centralized logger wrapper around console methods. */

/**
 * Configurable logging utility with multiple log levels
 *
 * Log Levels (in order of verbosity):
 * - silent: No logging at all
 * - error: Only errors
 * - warn: Errors + warnings
 * - info: Errors + warnings + info (default for production)
 * - debug: All above + debug messages
 * - trace: All above + trace (most verbose, includes queries)
 *
 * Set LOG_LEVEL environment variable to control logging:
 * LOG_LEVEL=silent | error | warn | info | debug | trace
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return envLevel;
  }
  // Default: info for production, debug for development
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel();
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: string, namespace: string, message: string): string {
  const timestamp = formatTimestamp();
  return `${colors.gray}[${timestamp}]${colors.reset} ${level} ${colors.cyan}[${namespace}]${colors.reset} ${message}`;
}

class Logger {
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      const formatted = formatMessage(`${colors.red}ERROR${colors.reset}`, this.namespace, message);
      console.error(formatted, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      const formatted = formatMessage(`${colors.yellow}WARN${colors.reset}`, this.namespace, message);
      console.warn(formatted, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      const formatted = formatMessage(`${colors.blue}INFO${colors.reset}`, this.namespace, message);
      console.info(formatted, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      const formatted = formatMessage(`${colors.magenta}DEBUG${colors.reset}`, this.namespace, message);
      console.debug(formatted, ...args);
    }
  }

  trace(message: string, ...args: unknown[]): void {
    if (shouldLog('trace')) {
      const formatted = formatMessage(`${colors.gray}TRACE${colors.reset}`, this.namespace, message);
      console.log(formatted, ...args);
    }
  }

  /**
   * Create a child logger with a sub-namespace
   */
  child(subNamespace: string): Logger {
    return new Logger(`${this.namespace}:${subNamespace}`);
  }
}

/**
 * Create a logger instance for a specific namespace
 * @param namespace - Module/feature name (e.g., 'prisma', 'auth', 'api')
 */
export function createLogger(namespace: string): Logger {
  return new Logger(namespace);
}

/**
 * Get the current log level
 */
export function getCurrentLogLevel(): LogLevel {
  return getLogLevel();
}

/**
 * Check if a specific log level is enabled
 */
export function isLogLevelEnabled(level: LogLevel): boolean {
  return shouldLog(level);
}

/**
 * Get Prisma log configuration based on current log level
 * Maps our log levels to Prisma's log options
 */
export function getPrismaLogConfig(): ('query' | 'info' | 'warn' | 'error')[] {
  const level = getLogLevel();

  switch (level) {
    case 'silent':
      return [];
    case 'error':
      return ['error'];
    case 'warn':
      return ['error', 'warn'];
    case 'info':
      return ['error', 'warn', 'info'];
    case 'debug':
      return ['error', 'warn', 'info'];
    case 'trace':
      // Only include queries at trace level
      return ['query', 'error', 'warn', 'info'];
    default:
      return ['error'];
  }
}

/**
 * Safely extract error message without exposing sensitive data
 * Use this instead of logging full error objects
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Only return the message, not the stack trace or other properties
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * Create a sanitized error object for logging
 * Removes potentially sensitive data like stack traces in production
 */
export function sanitizeError(error: unknown): { message: string; type: string; code?: string } {
  const result: { message: string; type: string; code?: string } = {
    message: safeErrorMessage(error),
    type: error?.constructor?.name || 'Unknown',
  };

  // Include error code if available (e.g., Prisma errors)
  if (error && typeof error === 'object' && 'code' in error) {
    result.code = String((error as { code: unknown }).code);
  }

  return result;
}

// Default logger instance
export const logger = createLogger('app');

export default logger;
