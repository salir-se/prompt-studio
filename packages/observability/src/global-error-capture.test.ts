// @vitest-environment happy-dom
/**
 * global-error-capture contract tests.
 *
 * Locks the five guarantees both apps depend on:
 *   1. installGlobalErrorCapture() is idempotent (StrictMode-safe).
 *   2. unhandledrejection is logged at error level with a useful
 *      message + stack and the current route.
 *   3. window.error is logged at error level with filename + line + col.
 *   4. rejectionhandled is logged at warn level so late-handled
 *      promises leave a paper trail without paging.
 *   5. Chrome-extension noise (message-channel-closed,
 *      ResizeObserver-loop-completed) is demoted to debug, not
 *      error-logged, so real failures don't drown.
 */ // @module-tag dom
// @module-tag dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
};
vi.mock('./pino-logger', () => ({
  createLogger: () => log,
  setLogLevel: vi.fn(),
}));

const { __resetGlobalErrorCaptureForTest, installGlobalErrorCapture } = await import('./global-error-capture');

let handlers: {
  unhandledrejection?: EventListener;
  rejectionhandled?: EventListener;
  error?: EventListener;
};

/** Capture the listeners installed by installGlobalErrorCapture()
 *  so tests can invoke them directly. happy-dom's
 *  window.dispatchEvent doesn't reliably trigger 'error' /
 *  'unhandledrejection' listeners attached via addEventListener,
 *  so we route around it. */
function installAndCapture(): void {
  handlers = {};
  const real = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, opts) => {
    if (type === 'unhandledrejection') handlers.unhandledrejection = listener as EventListener;
    if (type === 'rejectionhandled') handlers.rejectionhandled = listener as EventListener;
    if (type === 'error') handlers.error = listener as EventListener;
    return real(type, listener as EventListener, opts);
  });
  installGlobalErrorCapture();
}

beforeEach(() => {
  __resetGlobalErrorCaptureForTest();
  log.error.mockClear();
  log.warn.mockClear();
  log.debug.mockClear();
});

afterEach(() => {
  __resetGlobalErrorCaptureForTest();
  vi.restoreAllMocks();
});

function lastPayloadForMethod(method: 'error' | 'warn' | 'debug'): Record<string, unknown> | undefined {
  const calls = log[method].mock.calls;
  if (calls.length === 0) return undefined;
  const last = calls[calls.length - 1];
  return last.find(
    (a: unknown): a is Record<string, unknown> => typeof a === 'object' && a !== null && !(a instanceof Error),
  );
}

function entriesForMethod(method: 'error' | 'warn' | 'debug') {
  return log[method].mock.calls;
}

describe('installGlobalErrorCapture — idempotency', () => {
  it('two install calls bind only one listener of each type (StrictMode-safe)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    installGlobalErrorCapture();
    installGlobalErrorCapture();
    const unhandledCalls = addSpy.mock.calls.filter(([type]) => type === 'unhandledrejection').length;
    const handledCalls = addSpy.mock.calls.filter(([type]) => type === 'rejectionhandled').length;
    const errorCalls = addSpy.mock.calls.filter(([type]) => type === 'error').length;
    expect(unhandledCalls).toBe(1);
    expect(handledCalls).toBe(1);
    expect(errorCalls).toBe(1);
    addSpy.mockRestore();
  });
});

describe('installGlobalErrorCapture — unhandledrejection', () => {
  it('logs an Error rejection at error level with message + stack', () => {
    installAndCapture();
    const error = new Error('the database is on fire');
    handlers.unhandledrejection?.({ reason: error } as unknown as Event);
    expect(entriesForMethod('error').length).toBeGreaterThan(0);
    const payload = lastPayloadForMethod('error') ?? {};
    expect(payload.message).toBe('the database is on fire');
    expect(payload.kind).toBe('unhandledrejection');
    expect(payload.status).toBe('failed');
    expect(typeof payload.stack).toBe('string');
  });

  it('logs a string rejection with the string as the message', () => {
    installAndCapture();
    handlers.unhandledrejection?.({ reason: 'plain-string-reason' } as unknown as Event);
    const payload = lastPayloadForMethod('error') ?? {};
    expect(payload.message).toBe('plain-string-reason');
  });

  it('serializes a non-Error object rejection without crashing', () => {
    installAndCapture();
    handlers.unhandledrejection?.({ reason: { code: 'X', detail: 'oops' } } as unknown as Event);
    const payload = lastPayloadForMethod('error') ?? {};
    expect(payload.message).toBe('non-Error rejection');
    expect(payload.raw).toBe('{"code":"X","detail":"oops"}');
  });

  it('demotes the Chrome-extension message-channel-closed warning to debug', () => {
    installAndCapture();
    const noise =
      'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';
    handlers.unhandledrejection?.({ reason: noise } as unknown as Event);
    expect(entriesForMethod('error')).toHaveLength(0);
    expect(entriesForMethod('debug').length).toBeGreaterThan(0);
    expect(lastPayloadForMethod('debug')?.status).toBe('noise');
  });
});

describe('installGlobalErrorCapture — rejectionhandled', () => {
  it('logs late-handled rejections at warn level (status=recovered)', () => {
    installAndCapture();
    const error = new Error('would-be-orphan rejection');
    handlers.rejectionhandled?.({ reason: error } as unknown as Event);
    expect(entriesForMethod('warn').length).toBeGreaterThan(0);
    const payload = lastPayloadForMethod('warn') ?? {};
    expect(payload.kind).toBe('rejectionhandled');
    expect(payload.status).toBe('recovered');
    expect(payload.message).toBe('would-be-orphan rejection');
  });
});

describe('installGlobalErrorCapture — window.error', () => {
  it('logs an uncaught Error with filename + lineno + colno', () => {
    installAndCapture();
    const error = new Error('boom in render');
    handlers.error?.({
      error,
      message: 'boom in render',
      filename: 'https://app.salir.se/static/js/main.js',
      lineno: 42,
      colno: 7,
    } as unknown as Event);
    expect(entriesForMethod('error').length).toBeGreaterThan(0);
    const payload = lastPayloadForMethod('error') ?? {};
    expect(payload.message).toBe('boom in render');
    expect(payload.filename).toBe('https://app.salir.se/static/js/main.js');
    expect(payload.lineno).toBe(42);
    expect(payload.colno).toBe(7);
    expect(payload.kind).toBe('window-error');
  });

  it('demotes ResizeObserver-loop noise to debug', () => {
    installAndCapture();
    handlers.error?.({
      message: 'ResizeObserver loop completed with undelivered notifications.',
    } as unknown as Event);
    expect(entriesForMethod('error')).toHaveLength(0);
    expect(entriesForMethod('debug').length).toBeGreaterThan(0);
  });
});
