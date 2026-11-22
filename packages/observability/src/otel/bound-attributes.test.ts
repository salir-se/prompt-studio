// @module-tag pure
import { describe, expect, it } from 'vitest';
import { boundLogAttributes, boundOtelAttributes, INDEXED_LOG_ATTRIBUTE_KEYS } from './bound-attributes';
import type { OtelKeyValue } from './log-record';
import { MAX_ATTR_VALUE_CHARS } from './normalize';

describe('boundLogAttributes: allowlisted keys', () => {
  it('passes an allowlisted key through unchanged', () => {
    const result = boundLogAttributes({ correlationId: 'c-1', runId: 'r-1' });

    expect(result).toEqual({ correlationId: 'c-1', runId: 'r-1' });
  });

  // Outreach event log: a conversation's history is filtered by these two ids.
  it("keeps an outreach event's lead and message ids as their own columns", () => {
    const result = boundLogAttributes({
      kind: 'outreach-event',
      leadId: 'lead-1',
      messageId: 'msg-1',
      fromStatus: 'sent',
    });

    expect(result).toMatchObject({ kind: 'outreach-event', leadId: 'lead-1', messageId: 'msg-1' });
    expect(JSON.parse(result.extra as string)).toEqual({ fromStatus: 'sent' });
  });

  it('every allowlisted key round-trips unchanged in one call', () => {
    const attrs = Object.fromEntries([...INDEXED_LOG_ATTRIBUTE_KEYS].map((key) => [key, `value-${key}`]));

    const result = boundLogAttributes(attrs);

    expect(result).toEqual(attrs);
  });
});

describe('boundLogAttributes: novel key folding', () => {
  it('folds a novel key into extra and does not surface it as its own key', () => {
    const result = boundLogAttributes({ correlationId: 'c-1', weirdNewKey: 'x' });

    expect(result.correlationId).toBe('c-1');
    expect(result).not.toHaveProperty('weirdNewKey');
    expect(typeof result.extra).toBe('string');
    expect(JSON.parse(result.extra as string)).toEqual({ weirdNewKey: 'x' });
  });

  it('folds multiple novel keys into one extra attribute', () => {
    const result = boundLogAttributes({ foo: 1, bar: 'two', baz: true });

    expect(Object.keys(result)).toEqual(['extra']);
    expect(JSON.parse(result.extra as string)).toEqual({ foo: 1, bar: 'two', baz: true });
  });

  it('nests an incoming extra key inside the relay-authored fold map', () => {
    const result = boundLogAttributes({ extra: 'client-supplied', weirdNewKey: 'x' });

    const parsed = JSON.parse(result.extra as string) as Record<string, unknown>;
    expect(parsed.extra).toBe('client-supplied');
    expect(parsed.weirdNewKey).toBe('x');
  });

  it('produces no extra key when every input key is allowlisted', () => {
    const result = boundLogAttributes({ correlationId: 'c-1' });

    expect(result).not.toHaveProperty('extra');
  });
});

describe('boundLogAttributes: flattened dotted err/req/res keys', () => {
  // The SPA client flattens `err`/`req`/`res` into dotted top-level keys
  // before shipping (log-record.ts's flattenEntry), so this is the shape the
  // relay actually sees -- these keys are listed directly in
  // INDEXED_LOG_ATTRIBUTE_KEYS, not derived from the object-pruning branch.
  it('passes err.message and req.url through unfolded as literal dotted keys', () => {
    const result = boundLogAttributes({
      'err.message': 'The operation was aborted',
      'err.stack': 'Error: boom\n  at x',
      'req.url': '/api/app/logs?x=1',
      'req.method': 'POST',
      'res.status': 500,
    });

    expect(result).toEqual({
      'err.message': 'The operation was aborted',
      'err.stack': 'Error: boom\n  at x',
      'req.url': '/api/app/logs?x=1',
      'req.method': 'POST',
      'res.status': 500,
    });
    expect(result).not.toHaveProperty('extra');
  });

  it('folds a dotted DOMException constant (err.INDEX_SIZE_ERR) into extra, not through as its own key', () => {
    const result = boundLogAttributes({ 'err.message': 'boom', 'err.INDEX_SIZE_ERR': 1 });

    expect(result['err.message']).toBe('boom');
    expect(result).not.toHaveProperty('err.INDEX_SIZE_ERR');
    expect(JSON.parse(result.extra as string)).toEqual({ 'err.INDEX_SIZE_ERR': 1 });
  });
});

describe('boundLogAttributes: err/req/res pruning', () => {
  it('prunes a DOMException-shaped err object to the known subkeys, dropping enumerable constants', () => {
    const err = {
      name: 'AbortError',
      message: 'The operation was aborted',
      stack: 'Error: boom\n  at x',
      ABORT_ERR: 20,
      INDEX_SIZE_ERR: 1,
      NOT_FOUND_ERR: 8,
    };

    const result = boundLogAttributes({ err });

    expect(result.err).toEqual({
      name: 'AbortError',
      message: 'The operation was aborted',
      stack: 'Error: boom\n  at x',
    });
    expect(result.err).not.toHaveProperty('ABORT_ERR');
    expect(result.err).not.toHaveProperty('INDEX_SIZE_ERR');
    expect(result.err).not.toHaveProperty('NOT_FOUND_ERR');
    // Dropped subkeys are dropped, never folded into extra.
    expect(result).not.toHaveProperty('extra');
  });

  it('prunes req to method/route/url only', () => {
    const result = boundLogAttributes({
      req: { method: 'GET', route: '/api/app/logs', url: '/api/app/logs?x=1', headers: { cookie: 'secret' } },
    });

    expect(result.req).toEqual({ method: 'GET', route: '/api/app/logs', url: '/api/app/logs?x=1' });
  });

  it('prunes res to status only', () => {
    const result = boundLogAttributes({ res: { status: 500, body: 'huge payload' } });

    expect(result.res).toEqual({ status: 500 });
  });

  it('passes a non-object err value through as-is', () => {
    const result = boundLogAttributes({ err: 'Simple string error' });

    expect(result.err).toBe('Simple string error');
  });

  it('passes a non-object req/res value through as-is', () => {
    const result = boundLogAttributes({ req: 'n/a', res: 42 });

    expect(result.req).toBe('n/a');
    expect(result.res).toBe(42);
  });
});

describe('boundLogAttributes: extra truncation', () => {
  it('truncates the folded extra JSON at MAX_ATTR_VALUE_CHARS with a trailing ellipsis', () => {
    const result = boundLogAttributes({ weirdNewKey: 'x'.repeat(MAX_ATTR_VALUE_CHARS * 2) });

    const extra = result.extra as string;
    expect(extra.length).toBe(MAX_ATTR_VALUE_CHARS);
    expect(extra.endsWith('…')).toBe(true);
  });

  it('does not truncate extra JSON at or under the cap', () => {
    const result = boundLogAttributes({ weirdNewKey: 'x' });

    const extra = result.extra as string;
    expect(extra.length).toBeLessThanOrEqual(MAX_ATTR_VALUE_CHARS);
    expect(extra.endsWith('…')).toBe(false);
  });
});

describe('boundLogAttributes: worker-leg keys (#1489 follow-up)', () => {
  it('passes ms and endpoint through unchanged while folding sql into extra', () => {
    const result = boundLogAttributes({ ms: 12, endpoint: '/v1/chat', sql: 'select 1' });

    expect(result.ms).toBe(12);
    expect(result.endpoint).toBe('/v1/chat');
    expect(result).not.toHaveProperty('sql');
    expect(JSON.parse(result.extra as string)).toEqual({ sql: 'select 1' });
  });

  it('passes every worker-leg key through unchanged in one call', () => {
    const attrs = {
      op: 'get',
      store: 'kv',
      cacheKey: 'k-1',
      ttlSeconds: 60,
      ms: 12,
      rows: 3,
      endpoint: '/v1/chat',
      upstreamStatus: 429,
      openaiRequestId: 'req_1',
      errorType: 'rate_limit',
      errorCode: 'rate_limit_exceeded',
      errorParam: 'messages',
      errorMessage: 'boom',
      model: 'gpt-5',
      hasTools: true,
      reasoningEffort: 'low',
      tursoDbName: 'grp-1',
    };

    const result = boundLogAttributes(attrs);

    expect(result).toEqual(attrs);
  });

  it('folds worker-side non-indexed keys (family, target, sql, argCount, stream, payloadBytes) into extra', () => {
    const result = boundLogAttributes({
      ms: 12,
      family: 'groups',
      target: 'leads',
      sql: 'select 1',
      argCount: 2,
      stream: true,
      payloadBytes: 512,
    });

    expect(result.ms).toBe(12);
    for (const key of ['family', 'target', 'sql', 'argCount', 'stream', 'payloadBytes']) {
      expect(result).not.toHaveProperty(key);
    }
    expect(JSON.parse(result.extra as string)).toEqual({
      family: 'groups',
      target: 'leads',
      sql: 'select 1',
      argCount: 2,
      stream: true,
      payloadBytes: 512,
    });
  });

  it('folds the salir.truncated_attributes marker key into extra', () => {
    const result = boundLogAttributes({ ms: 12, 'salir.truncated_attributes': 3 });

    expect(result.ms).toBe(12);
    expect(result).not.toHaveProperty('salir.truncated_attributes');
    expect(JSON.parse(result.extra as string)).toEqual({ 'salir.truncated_attributes': 3 });
  });
});

describe('boundLogAttributes: empty/undefined input', () => {
  it('returns {} for undefined input', () => {
    expect(boundLogAttributes(undefined)).toEqual({});
  });

  it('returns {} for an empty input record', () => {
    expect(boundLogAttributes({})).toEqual({});
  });
});

describe('boundOtelAttributes: OTLP-level wrap/unwrap round-trip', () => {
  it('round-trips an allowlisted string, bool, int, and double attribute unchanged', () => {
    const input: OtelKeyValue[] = [
      { key: 'correlationId', value: { stringValue: 'c-1' } },
      { key: 'code', value: { boolValue: true } },
      { key: 'count', value: { intValue: '3' } },
      { key: 'durationMs', value: { doubleValue: 1.5 } },
    ];

    const result = boundOtelAttributes(input);

    expect(result).toEqual([
      { key: 'correlationId', value: { stringValue: 'c-1' } },
      { key: 'code', value: { boolValue: true } },
      { key: 'count', value: { intValue: '3' } },
      { key: 'durationMs', value: { doubleValue: 1.5 } },
    ]);
  });

  it('folds a non-allowlisted key into a stringValue extra attribute', () => {
    const result = boundOtelAttributes([
      { key: 'correlationId', value: { stringValue: 'c-1' } },
      { key: 'weirdNewKey', value: { stringValue: 'x' } },
    ]);

    expect(result).toContainEqual({ key: 'correlationId', value: { stringValue: 'c-1' } });
    const extra = result.find((attr) => attr.key === 'extra');
    expect(extra?.value.stringValue).toBeDefined();
    expect(JSON.parse(extra?.value.stringValue as string)).toEqual({ weirdNewKey: 'x' });
  });

  it('folds a dotted DOMException constant, keeping the allowlisted err.message attribute', () => {
    const result = boundOtelAttributes([
      { key: 'err.message', value: { stringValue: 'aborted' } },
      { key: 'err.ABORT_ERR', value: { intValue: '20' } },
    ]);

    expect(result).toContainEqual({ key: 'err.message', value: { stringValue: 'aborted' } });
    expect(result.find((attr) => attr.key === 'err.ABORT_ERR')).toBeUndefined();
    const extra = result.find((attr) => attr.key === 'extra');
    expect(JSON.parse(extra?.value.stringValue as string)).toEqual({ 'err.ABORT_ERR': 20 });
  });

  it('returns [] for an empty input list', () => {
    expect(boundOtelAttributes([])).toEqual([]);
  });
});
