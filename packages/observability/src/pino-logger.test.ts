// @module-tag pure
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PinoBrowserLogEvent } from './otel/log-record';
import {
  browserTransmitSend,
  browserWrite,
  clearBrowserLogTransmit,
  clearLoggerContext,
  configureBrowserLogTransmit,
  createLogger,
  errSerializer,
  formatBrowserLogForConsole,
  getLoggerContext,
  rootLogger,
  setLoggerContext,
  setLogLevel,
} from './pino-logger';
import { consoleBuffer } from './test';

describe('pino browser logger formatting', () => {
  it('masks sensitive fields and inline secrets before console output', () => {
    const formatted = formatBrowserLogForConsole({
      level: 30,
      ns: 'salir:test',
      msg: 'using sk-1234567890abcdef for ada@example.com',
      authorization: 'Bearer abcdefghijklmnop',
      nested: {
        apiKey: 'key-1234567890abcdef',
        email: 'ada@example.com',
        safe: 'ok',
      },
    });

    const output = JSON.stringify(formatted.args);
    expect(output).toContain('sk-***');
    expect(output).toContain('***@***');
    expect(output).toContain('ok');
    expect(output).not.toContain('1234567890abcdef');
    expect(output).not.toContain('ada@example.com');
    expect(output).not.toContain('abcdefghijklmnop');
  });

  it('applies mutable logger context to formatted console attrs', () => {
    setLoggerContext({ app: 'unit-test', route: 'Settings', workspaceId: 'ws-1' });

    const formatted = formatBrowserLogForConsole({
      level: 30,
      ns: 'salir:test',
      msg: 'context check',
      requestId: 'req-1',
    });

    expect(formatted.args[3]).toEqual(
      expect.objectContaining({
        app: 'unit-test',
        route: 'Settings',
        workspaceId: 'ws-1',
        requestId: 'req-1',
      }),
    );

    clearLoggerContext('route');
    expect(getLoggerContext()).not.toHaveProperty('route');
  });
});

describe('errSerializer', () => {
  it('turns a raw Error into a structured object with type, message, and stack', () => {
    const out = errSerializer(new Error('boom')) as Record<string, unknown>;
    expect(typeof out).toBe('object');
    expect(out.type).toBe('Error');
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
  });

  it('preserves the cause chain', () => {
    const root = new Error('root cause');
    const wrapped = new Error('wrapper', { cause: root });
    const out = errSerializer(wrapped) as Record<string, unknown>;
    // pino's std err serializer nests the cause as another serialized error
    expect(JSON.stringify(out)).toContain('root cause');
  });

  it('serializes the cause chain into a JSON-safe array, uniform across pino builds (#1367)', () => {
    // The worker bundle ships pino's BROWSER build, whose serializer copies
    // `cause` by reference — an Error-typed cause then serializes as {} because
    // its message/stack are non-enumerable (staging 2026-08-27: the license
    // DrizzleQueryError logged cause:{} hiding the LibsqlError reason).
    // errSerializer must walk the chain itself so the shape is identical in
    // Node and worker builds, and survive JSON.stringify.
    const deepest = new Error('deeper cause');
    const root = new Error('root cause', { cause: deepest });
    const wrapped = new Error('wrapper', { cause: root });
    const out = errSerializer(wrapped) as Record<string, unknown>;

    const json = JSON.parse(JSON.stringify(out)) as { cause: Array<{ type?: string; msg?: string }> };
    expect(Array.isArray(json.cause)).toBe(true);
    expect(json.cause).toHaveLength(2);
    expect(json.cause[0]).toMatchObject({ type: 'Error', msg: 'root cause' });
    expect(json.cause[1]).toMatchObject({ type: 'Error', msg: 'deeper cause' });
  });

  it('caps the walked cause chain at 5 levels (cycle-safe)', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b; // cycle
    const out = errSerializer(b) as Record<string, unknown>;
    const json = JSON.parse(JSON.stringify(out)) as { cause: unknown[] };
    expect(json.cause.length).toBeLessThanOrEqual(5);
  });

  it('passes non-Error values through unchanged (string)', () => {
    expect(errSerializer('plain string error')).toBe('plain string error');
  });

  it('passes non-Error values through unchanged (plain object identity)', () => {
    const obj = { code: 'E_X' };
    expect(errSerializer(obj)).toBe(obj);
  });

  it('drops DOMException legacy code constants, keeping code/name/retryable (#1427 Axiom column bomb)', () => {
    // workerd's DOMException exposes its legacy ABORT_ERR/NETWORK_ERR/... constants
    // (26 of them) as own enumerable props; pino's for-in-based std err serializer
    // then copies every one of them onto the logged `err` object, minting 26 Axiom
    // columns from a single `logger.warn({ err })` call and burning the dataset's
    // 257-column budget (staging incident, 2026-09-02, salir-corporate).
    const workerdShaped = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
      code: 20,
      ABORT_ERR: 20,
      NETWORK_ERR: 19,
      QUOTA_EXCEEDED_ERR: 22,
      retryable: true,
    });
    const out = errSerializer(workerdShaped) as Record<string, unknown>;
    expect(Object.keys(out).some((k) => /^[A-Z][A-Z0-9_]*_ERR$/.test(k))).toBe(false);
    expect(out.type).toBe('Error');
    expect(out.message).toBe('The operation was aborted');
    expect(typeof out.stack).toBe('string');
    expect(out.code).toBe(20);
    expect(out.name).toBe('AbortError');
    expect(out.retryable).toBe(true);

    if (typeof DOMException !== 'undefined') {
      // A real DOMException: Node exposes the same legacy constants as enumerable
      // (inherited) properties, which pino's `for (const key in err)` walk picks up
      // exactly like own props — this is why the fix must not rely on an
      // `instanceof DOMException` check (also unreliable across runtimes).
      const domException = new DOMException('aborted', 'AbortError');
      Object.defineProperty(domException, 'retryable', { value: true, enumerable: true, configurable: true });
      const domOut = errSerializer(domException) as Record<string, unknown>;
      expect(Object.keys(domOut).some((k) => /^[A-Z][A-Z0-9_]*_ERR$/.test(k))).toBe(false);
      expect(domOut.code).toBe(20);
      expect(domOut.name).toBe('AbortError');
      expect(domOut.retryable).toBe(true);
    }
  });
});

describe('errSerializer wired into pino', () => {
  /**
   * Proves `errSerializer` structures the `err` field through pino's real
   * serializer pipeline — the same `serializers: { err: errSerializer }` wiring
   * createLogger/rootLogger use. A custom destination stream gives deterministic
   * capture (the singleton's node transport writes straight to fd 1 via
   * sonic-boom, which bypasses a `process.stdout.write` spy). Without the
   * serializer a raw Error logs as `{}` (its fields are non-enumerable).
   */
  function captureWith(serializers: Record<string, (v: unknown) => unknown>, fn: (l: pino.Logger) => void) {
    const records: Array<Record<string, unknown>> = [];
    const stream = {
      write: (s: string) => {
        records.push(JSON.parse(s) as Record<string, unknown>);
      },
    };
    const log = pino({ level: 'error', serializers }, stream as unknown as pino.DestinationStream);
    fn(log);
    return records;
  }

  it('serializes a raw { err: Error } to a structured object', () => {
    const records = captureWith({ err: errSerializer }, (log) => {
      log.error({ err: new Error('kaboom') }, 'failed here');
    });

    expect(records).toHaveLength(1);
    const err = records[0].err as Record<string, unknown>;
    expect(err.type).toBe('Error');
    expect(err.message).toBe('kaboom');
    expect(typeof err.stack).toBe('string');
  });

  it('leaves a non-Error err value untouched', () => {
    const records = captureWith({ err: errSerializer }, (log) => {
      log.error({ err: 'plain string error' }, 'failed here');
    });

    expect(records[0].err).toBe('plain string error');
  });
});

describe('formatBrowserLogForConsole + serialized err', () => {
  it('passes a pre-serialized err object through to console attrs unchanged', () => {
    const serialized = { type: 'Error', message: 'boom', stack: 'Error: boom\n    at ...' };
    const formatted = formatBrowserLogForConsole({ level: 50, ns: 'salir:test', msg: 'fail', err: serialized });
    const attrs = formatted.args[3] as Record<string, unknown>;
    expect(attrs.err).toEqual(serialized);
  });
});

describe('browser log transmit dual gate (ADR-241)', () => {
  /**
   * pino's `browser.write`/`browser.transmit.send` hooks only fire when the
   * BROWSER build of pino is loaded (the real Vite client bundle, via Vite's
   * `browser` resolve condition). Under vitest `import pino from 'pino'`
   * resolves to pino's NODE build instead (confirmed empirically: building
   * rootLogger with the exact same `browser: {...}` options used here writes
   * raw NDJSON straight to stdout and never calls `write`/`transmit.send` at
   * all) — the same reason `errSerializer wired into pino` above builds its
   * own throwaway `pino({...}, stream)` instance rather than exercising
   * rootLogger's console path directly.
   *
   * So these tests call `browserWrite`/`browserTransmitSend` directly with
   * hand-built event shapes — exactly what pino's browser build passes them
   * at runtime — and additionally assert on `rootLogger.level` to prove
   * pino's OWN outer gate (which decides whether either hook fires at all in
   * a real browser) is recomputed correctly by configureBrowserLogTransmit /
   * clearBrowserLogTransmit / setLogLevel.
   */

  function eventAt(label: 'debug' | 'info' | 'warn' | 'error', value: number, msg: string): PinoBrowserLogEvent {
    return { ts: Date.now(), messages: [msg], bindings: [{ ns: 'salir:gate' }], level: { label, value } };
  }
  const debugEvent = (msg: string) => eventAt('debug', 20, msg);
  const infoEvent = (msg: string) => eventAt('info', 30, msg);
  const warnEvent = (msg: string) => eventAt('warn', 40, msg);
  const errorEvent = (msg: string) => eventAt('error', 50, msg);

  /** The flattened object shape pino's `asObject` output hands to `browser.write`. */
  function logObjectFor(event: PinoBrowserLogEvent): Record<string, unknown> {
    return { level: event.level.value, ns: event.bindings[0]?.ns, msg: event.messages[0] };
  }

  function deliver(event: PinoBrowserLogEvent): void {
    browserWrite(logObjectFor(event));
    browserTransmitSend(event.level.label, event);
  }

  beforeEach(() => {
    clearBrowserLogTransmit();
    setLogLevel('silent');
  });

  afterEach(() => {
    clearBrowserLogTransmit();
    setLogLevel('silent');
  });

  it('(a) default state — console silent, no handler: an error produces no console output and reaches no handler', () => {
    expect(rootLogger.level).toBe('silent');

    deliver(errorEvent('boom'));

    expect(consoleBuffer.entries).toHaveLength(0);
  });

  it('(b) handler at warn + console silent: error/warn reach only the handler; info reaches neither', () => {
    const handler = vi.fn();
    configureBrowserLogTransmit(handler, 'warn');
    expect(rootLogger.level).toBe('warn'); // effective level widened to the transmit floor, console still silent

    const err = errorEvent('e1');
    deliver(err);
    expect(consoleBuffer.entries).toHaveLength(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(err);

    handler.mockClear();
    const warn = warnEvent('w1');
    deliver(warn);
    expect(consoleBuffer.entries).toHaveLength(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(warn);

    handler.mockClear();
    deliver(infoEvent('i1'));
    expect(consoleBuffer.entries).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('(c) console debug + handler warn: debug prints to console but does not reach the handler; error does both', () => {
    const handler = vi.fn();
    setLogLevel('debug');
    configureBrowserLogTransmit(handler, 'warn');
    expect(rootLogger.level).toBe('debug'); // console already more verbose than the transmit floor

    deliver(debugEvent('d1'));
    expect(consoleBuffer.entries).toHaveLength(1);
    expect(handler).not.toHaveBeenCalled();

    consoleBuffer.clear();
    deliver(errorEvent('e1'));
    expect(consoleBuffer.entries).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('(d) after clearBrowserLogTransmit + console silent: back to (a) — no console output, no handler call', () => {
    const handler = vi.fn();
    configureBrowserLogTransmit(handler, 'warn');

    clearBrowserLogTransmit();
    setLogLevel('silent');
    expect(rootLogger.level).toBe('silent');

    deliver(errorEvent('e1'));
    expect(consoleBuffer.entries).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('(e) a throwing handler does not break logging — console still works, no exception escapes', () => {
    const handler = vi.fn(() => {
      throw new Error('handler exploded');
    });
    // Non-silent so this test can observe "console still works" independent of the handler.
    setLogLevel('error');
    configureBrowserLogTransmit(handler, 'warn');

    const err = errorEvent('e1');
    expect(() => browserTransmitSend(err.level.label, err)).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);

    expect(() => browserWrite(logObjectFor(err))).not.toThrow();
    expect(consoleBuffer.entries).toHaveLength(1);
  });

  it('ships only allowlisted info events while preserving warn and error events', () => {
    const handler = vi.fn();
    configureBrowserLogTransmit(
      handler,
      'info',
      (event) =>
        event.level.value >= 40 ||
        event.messages.some((message) => typeof message === 'object' && message !== null && 'kind' in message),
    );
    expect(rootLogger.level).toBe('info');

    const ordinaryInfo = infoEvent('ordinary');
    deliver(ordinaryInfo);
    expect(handler).not.toHaveBeenCalled();

    const milestone = infoEvent('milestone');
    milestone.messages.unshift({ kind: 'onboarding-readiness' });
    deliver(milestone);
    deliver(warnEvent('warning'));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, milestone);
  });

  it('never lets an info allowlist suppress warnings', () => {
    const handler = vi.fn();
    configureBrowserLogTransmit(handler, 'info', () => false);

    deliver(infoEvent('ordinary'));
    deliver(warnEvent('warning'));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ level: { label: 'warn', value: 40 } }));
  });

  it('widens loggers created before shipping is configured', () => {
    const earlyLogger = createLogger('early');
    expect(earlyLogger.level).toBe('silent');

    configureBrowserLogTransmit(vi.fn(), 'info');

    expect(earlyLogger.level).toBe('info');
  });
});

describe('worker runtime compatibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads when FinalizationRegistry is unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('FinalizationRegistry', undefined);

    await expect(import('./pino-logger')).resolves.toBeDefined();
  });
});
