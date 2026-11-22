// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import { createMockLogger, createMockLoggerFactory, dumpLogEntries } from './mock-logger';

describe('createMockLogger', () => {
  it('captures info messages with object', () => {
    const { logger, entries } = createMockLogger('auth');
    logger.info({ userId: '123' }, 'user logged in');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ level: 'info', msg: 'user logged in', obj: { userId: '123' } });
  });

  it('captures messages without object', () => {
    const { logger, entries } = createMockLogger();
    logger.warn('something happened');
    expect(entries).toEqual([{ level: 'warn', msg: 'something happened' }]);
  });

  it('captures all log levels', () => {
    const { logger, entries } = createMockLogger();
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('child returns same logger (shared buffer)', () => {
    const { logger, entries } = createMockLogger();
    logger.child({ sub: true }).info('from child');
    expect(entries).toHaveLength(1);
  });
});

describe('createMockLoggerFactory', () => {
  it('creates separate buffers per logger', () => {
    const { factory, allEntries } = createMockLoggerFactory();
    factory('a').info('from a');
    factory('b').warn('from b');
    expect(allEntries()).toHaveLength(2);
  });
});

describe('dumpLogEntries', () => {
  it('does nothing for empty entries', () => {
    const output: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    });
    dumpLogEntries([]);
    expect(output).toHaveLength(0);
    spy.mockRestore();
  });
});
