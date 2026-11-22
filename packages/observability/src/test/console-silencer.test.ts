// @module-tag pure
import { consoleBuffer, installConsoleSilencer } from '@prompt-studio/observability/test/console-silencer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Manual lifecycle: don't use installConsoleSilencer's auto-hooks, drive
// the spies/buffer ourselves so we can assert behaviour without colliding
// with the surrounding test runner.

const originals = {
  log: console.log,
  warn: console.warn,
  info: console.info,
  error: console.error,
  debug: console.debug,
};

describe('consoleBuffer', () => {
  beforeEach(() => {
    consoleBuffer.clear();
    consoleBuffer.setCurrentTest(undefined);
  });

  it('buffers console.log/warn/error/info/debug calls', () => {
    consoleBuffer.push('log', ['hello', 1]);
    consoleBuffer.push('warn', ['oh no']);
    consoleBuffer.push('error', [new Error('boom')]);
    expect(consoleBuffer.length).toBe(3);
    expect(consoleBuffer.entries[0]).toMatchObject({ method: 'log', args: ['hello', 1] });
    expect(consoleBuffer.entries[1]).toMatchObject({ method: 'warn' });
    expect(consoleBuffer.entries[2].args[0]).toBeInstanceOf(Error);
  });

  it('tags entries with the current test name', () => {
    consoleBuffer.setCurrentTest('does the thing');
    consoleBuffer.push('info', ['milestone reached']);
    expect(consoleBuffer.entries[0].testName).toBe('does the thing');
  });

  it('clear() empties the buffer', () => {
    consoleBuffer.push('log', ['x']);
    consoleBuffer.clear();
    expect(consoleBuffer.length).toBe(0);
  });

  it('dump() writes entries to stderr and clears', () => {
    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      consoleBuffer.push('warn', ['important context']);
      consoleBuffer.push('error', [new Error('failure cause')]);
      consoleBuffer.dump('failed: example test');
      const joined = writes.join('');
      expect(joined).toContain('failed: example test');
      expect(joined).toContain('[warn] important context');
      expect(joined).toContain('failure cause');
      expect(consoleBuffer.length).toBe(0);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('dump() is a no-op on empty buffer (silent on pass)', () => {
    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      consoleBuffer.dump('label');
      expect(writes.join('')).toBe('');
    } finally {
      process.stderr.write = orig;
    }
  });
});

describe('installConsoleSilencer', () => {
  // Smoke test that the hooks register without error when called inside a
  // describe. The real proof is that the surrounding test file's logging
  // stays silent on pass — which it does because this file is run under the
  // `setupFiles: ['./src/test/setup.ts']` config.
  it('is callable from a describe block', () => {
    // No-op assertion: vi.spyOn is module-scoped so we don't reinstall here,
    // but the function should not throw on a re-call.
    expect(() => installConsoleSilencer({ filter: () => false })).not.toThrow();
  });

  it('captures via console spies when filter allows', () => {
    // Re-stub directly to avoid global hook side-effects on this test
    consoleBuffer.clear();
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleBuffer.push('warn', args);
    });
    try {
      console.warn('captured');
      expect(consoleBuffer.length).toBe(1);
      expect(consoleBuffer.entries[0].args[0]).toBe('captured');
    } finally {
      spy.mockRestore();
      console.log = originals.log;
    }
  });
});

describe('silence survives a suite resetting its own mocks', () => {
  // Regression: the capture used to be a `vi.spyOn`, so it lived in vitest's
  // mock registry. A test file's own `beforeEach(() => vi.restoreAllMocks())`
  // registers AFTER this setup file's `beforeEach`, so it stripped the capture
  // and every remaining test in that file printed to CI. That is how
  // `services/auth/src/auth/microsoft-oauth.test.ts` leaked boundedFetch
  // degradation logs into a green run. The capture is now a plain assignment,
  // invisible to the mock registry.
  //
  // This file runs under `setupFiles: ['./src/test/setup.ts']`, so the capture
  // is already installed and these tests observe the real wiring.

  it('keeps capturing console.warn after vi.restoreAllMocks()', () => {
    vi.restoreAllMocks();
    consoleBuffer.clear();

    console.warn('must not reach the real console');

    expect(consoleBuffer.entries.map((e) => e.args[0])).toContain('must not reach the real console');
  });

  it('keeps capturing console.error after vi.resetAllMocks()', () => {
    vi.resetAllMocks();
    consoleBuffer.clear();

    console.error('also captured');

    expect(consoleBuffer.entries.map((e) => e.args[0])).toContain('also captured');
  });

  it('leaves a suite-owned console spy alone so its assertions still see calls', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      console.info('suite-owned');
      expect(spy).toHaveBeenCalledWith('suite-owned');
    } finally {
      spy.mockRestore();
    }
  });
});
