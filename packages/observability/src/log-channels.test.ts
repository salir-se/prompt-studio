// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import { ConsoleSink, createChannelLogger, type LogEntry, type LogSink, RingBufferSink } from './log-channels';

/** Collecting sink for tests. */
class TestSink implements LogSink {
  entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe('ConsoleSink', () => {
  it('writes to console with namespace prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sink = new ConsoleSink();
    sink.write({
      timestamp: '2026-04-20T00:00:00Z',
      channel: 'debug',
      level: 'info',
      namespace: 'agent',
      message: 'test message',
    });
    expect(spy).toHaveBeenCalledWith('[agent]', 'test message');
    spy.mockRestore();
  });

  it('includes data when present', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sink = new ConsoleSink();
    sink.write({
      timestamp: '2026-04-20T00:00:00Z',
      channel: 'debug',
      level: 'info',
      namespace: 'agent',
      message: 'with data',
      data: { iteration: 5 },
    });
    expect(spy).toHaveBeenCalledWith('[agent]', 'with data', { iteration: 5 });
    spy.mockRestore();
  });

  it('uses correct console method for each level', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.write({ timestamp: '', channel: 'debug', level: 'warn', namespace: 'x', message: 'w' });
    sink.write({ timestamp: '', channel: 'debug', level: 'error', namespace: 'x', message: 'e' });
    sink.write({ timestamp: '', channel: 'debug', level: 'debug', namespace: 'x', message: 'd' });

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });
});

describe('RingBufferSink', () => {
  it('stores entries up to maxSize', () => {
    const sink = new RingBufferSink(3);
    for (let i = 0; i < 5; i++) {
      sink.write({ timestamp: '', channel: 'public', level: 'info', namespace: 'test', message: `msg-${i}` });
    }
    expect(sink.size).toBe(3);
    expect(sink.getEntries()[0].message).toBe('msg-2'); // oldest dropped
  });

  it('subscribe notifies on new entries', () => {
    const sink = new RingBufferSink();
    const handler = vi.fn();
    sink.subscribe(handler);
    sink.write({ timestamp: '', channel: 'public', level: 'info', namespace: 'test', message: 'hello' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops notifications', () => {
    const sink = new RingBufferSink();
    const handler = vi.fn();
    const unsub = sink.subscribe(handler);
    unsub();
    sink.write({ timestamp: '', channel: 'public', level: 'info', namespace: 'test', message: 'hello' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('getEntriesByLevel filters correctly', () => {
    const sink = new RingBufferSink();
    sink.write({ timestamp: '', channel: 'public', level: 'info', namespace: 'test', message: 'info' });
    sink.write({ timestamp: '', channel: 'public', level: 'error', namespace: 'test', message: 'err' });
    sink.write({ timestamp: '', channel: 'public', level: 'info', namespace: 'test', message: 'info2' });
    expect(sink.getEntriesByLevel('info')).toHaveLength(2);
    expect(sink.getEntriesByLevel('error')).toHaveLength(1);
  });

  it('clear empties the buffer', () => {
    const sink = new RingBufferSink();
    sink.write({ timestamp: '', channel: 'public', level: 'info', namespace: 'test', message: 'hello' });
    sink.clear();
    expect(sink.size).toBe(0);
  });
});

describe('createChannelLogger', () => {
  it('creates logger with three channels', () => {
    const logger = createChannelLogger('test');
    expect(logger.debug).toBeDefined();
    expect(logger.observe).toBeDefined();
    expect(logger.public).toBeDefined();
  });

  it('debug channel writes to debug sinks', () => {
    const sink = new TestSink();
    const logger = createChannelLogger('agent', { debug: [sink] });
    logger.debug.info({ tokens: 100 }, 'iteration complete');
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].channel).toBe('debug');
    expect(sink.entries[0].namespace).toBe('agent');
    expect(sink.entries[0].message).toBe('iteration complete');
  });

  it('observe channel writes to observe sinks', () => {
    const sink = new TestSink();
    const logger = createChannelLogger('storage', { observe: [sink] });
    logger.observe.warn({ adapter: 'turso' }, 'migration failed');
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].channel).toBe('observe');
    expect(sink.entries[0].level).toBe('warn');
  });

  it('public channel writes to public sinks', () => {
    const sink = new TestSink();
    const logger = createChannelLogger('engine', { public: [sink] });
    logger.public.info('Agent run started');
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].channel).toBe('public');
    expect(sink.entries[0].message).toBe('Agent run started');
  });

  it('debug logs go to debug sinks only', () => {
    const debugSink = new TestSink();
    const observeSink = new TestSink();
    const publicSink = new TestSink();

    const logger = createChannelLogger('test', {
      debug: [debugSink],
      observe: [observeSink],
      public: [publicSink],
    });

    logger.debug.info('debug only');

    expect(debugSink.entries).toHaveLength(1);
    expect(observeSink.entries).toHaveLength(0);
    expect(publicSink.entries).toHaveLength(0);
  });

  it('observe logs cascade to debug sinks', () => {
    const debugSink = new TestSink();
    const observeSink = new TestSink();

    const logger = createChannelLogger('test', {
      debug: [debugSink],
      observe: [observeSink],
    });

    logger.observe.info('health metric');

    expect(observeSink.entries).toHaveLength(1);
    expect(debugSink.entries).toHaveLength(1); // cascaded down
    expect(debugSink.entries[0].message).toBe('health metric');
  });

  it('public logs cascade to observe AND debug sinks', () => {
    const debugSink = new TestSink();
    const observeSink = new TestSink();
    const publicSink = new TestSink();

    const logger = createChannelLogger('test', {
      debug: [debugSink],
      observe: [observeSink],
      public: [publicSink],
    });

    logger.public.info('user-visible event');

    expect(publicSink.entries).toHaveLength(1);
    expect(observeSink.entries).toHaveLength(1); // cascaded
    expect(debugSink.entries).toHaveLength(1); // cascaded
  });

  it('observe logs do NOT appear in public sinks', () => {
    const observeSink = new TestSink();
    const publicSink = new TestSink();

    const logger = createChannelLogger('test', {
      observe: [observeSink],
      public: [publicSink],
    });

    logger.observe.info('internal metric');

    expect(observeSink.entries).toHaveLength(1);
    expect(publicSink.entries).toHaveLength(0);
  });

  it('sensitive data is masked in all channels', () => {
    const sink = new TestSink();
    const logger = createChannelLogger('test', { debug: [sink] });

    logger.debug.info({ apiKey: 'sk-secret123', user: 'john' }, 'config loaded');

    expect(sink.entries[0].data?.apiKey).toBe('***');
    expect(sink.entries[0].data?.user).toBe('john');
  });

  it('multiple sinks per channel', () => {
    const sink1 = new TestSink();
    const sink2 = new TestSink();
    const logger = createChannelLogger('test', { debug: [sink1, sink2] });

    logger.debug.info('broadcast');

    expect(sink1.entries).toHaveLength(1);
    expect(sink2.entries).toHaveLength(1);
  });

  it('string-only log messages work', () => {
    const sink = new TestSink();
    const logger = createChannelLogger('test', { observe: [sink] });

    logger.observe.info('simple message');
    logger.observe.error('error message');

    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0].data).toBeUndefined();
  });

  it('entries include timestamp', () => {
    const sink = new TestSink();
    const logger = createChannelLogger('test', { public: [sink] });

    const before = new Date().toISOString();
    logger.public.info('timed');
    const after = new Date().toISOString();

    expect(sink.entries[0].timestamp).toBeDefined();
    expect(sink.entries[0].timestamp >= before).toBe(true);
    expect(sink.entries[0].timestamp <= after).toBe(true);
  });
});
