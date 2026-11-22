import type { Logger, LoggerFactory } from '../types';

/** In-memory log entry for assertions. */
export interface LogEntry {
  level: 'info' | 'warn' | 'debug' | 'error';
  msg: string;
  obj?: Record<string, unknown>;
}

/**
 * Creates a mock logger that captures all log output to an in-memory buffer.
 * On test failure, the buffer contents can be dumped for debugging.
 *
 * @example
 * const { logger, entries } = createMockLogger('test');
 * logger.info({ key: 'val' }, 'hello');
 * expect(entries).toHaveLength(1);
 * expect(entries[0].msg).toBe('hello');
 */
export function createMockLogger(_namespace: string = 'test'): {
  logger: Logger;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];

  const push = (level: LogEntry['level']) => (objOrMsg: Record<string, unknown> | string, msg?: string) => {
    if (typeof objOrMsg === 'string') {
      entries.push({ level, msg: objOrMsg });
    } else {
      entries.push({ level, msg: msg ?? '', obj: objOrMsg });
    }
  };

  const logger: Logger = {
    info: push('info'),
    warn: push('warn'),
    debug: push('debug'),
    error: push('error'),
    child: () => logger,
  };

  return { logger, entries };
}

/**
 * Creates a LoggerFactory that produces mock loggers.
 * Each call creates a new logger with its own buffer.
 */
export function createMockLoggerFactory(): {
  factory: LoggerFactory;
  allEntries: () => LogEntry[];
} {
  const all: LogEntry[][] = [];
  return {
    factory: (name: string) => {
      const { logger, entries } = createMockLogger(name);
      all.push(entries);
      return logger;
    },
    allEntries: () => all.flat(),
  };
}

/**
 * Dumps captured log entries to console.error for debugging.
 * Call this in a test's afterAll or when a test fails.
 */
export function dumpLogEntries(entries: LogEntry[], label: string = 'captured logs'): void {
  if (entries.length === 0) return;
  console.error(`\n── ${label} (${entries.length} entries) ──`);
  for (const entry of entries) {
    const obj = entry.obj ? ` ${JSON.stringify(entry.obj)}` : '';
    console.error(`[${entry.level}] ${entry.msg}${obj}`);
  }
}
