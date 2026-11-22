// @module-tag pure
import { describe, expect, it } from 'vitest';
import {
  buildExportPayload,
  buildResource,
  type PinoBrowserLogEvent,
  toOtelAttributes,
  toOtelLogRecord,
} from './log-record';

describe('toOtelAttributes', () => {
  it('maps strings, booleans, safe integers, and finite non-integer numbers to the matching value kind', () => {
    const attrs = toOtelAttributes({ name: 'salir', active: true, count: 42, ratio: 1.5 });
    expect(attrs).toEqual([
      { key: 'name', value: { stringValue: 'salir' } },
      { key: 'active', value: { boolValue: true } },
      { key: 'count', value: { intValue: '42' } },
      { key: 'ratio', value: { doubleValue: 1.5 } },
    ]);
  });

  it('skips null and undefined fields entirely', () => {
    const attrs = toOtelAttributes({ a: null, b: undefined, c: 'kept' });
    expect(attrs).toEqual([{ key: 'c', value: { stringValue: 'kept' } }]);
  });

  it('JSON.stringify arrays instead of decomposing them', () => {
    const attrs = toOtelAttributes({ tags: ['a', 'b', 'c'] });
    expect(attrs).toEqual([{ key: 'tags', value: { stringValue: '["a","b","c"]' } }]);
  });

  it('String()-coerces values that are none of string/boolean/number/array/plain-object', () => {
    // bigint's typeof is neither 'object' nor 'string', so maskSensitiveData's
    // generic object-clone traversal (out of scope here) leaves it untouched --
    // unlike a Date/Map/class instance, which maskSensitiveData duck-types as a
    // plain object (via Object.entries) since it only branches on typeof, and
    // reconstructs it losing the original type before this module ever sees it.
    const attrs = toOtelAttributes({ big: 10n });
    expect(attrs).toEqual([{ key: 'big', value: { stringValue: '10' } }]);
  });

  it('flattens nested plain objects into dot-notation keys', () => {
    const attrs = toOtelAttributes({ user: { id: 'u1', active: true } });
    expect(attrs).toEqual(
      expect.arrayContaining([
        { key: 'user.id', value: { stringValue: 'u1' } },
        { key: 'user.active', value: { boolValue: true } },
      ]),
    );
    expect(attrs).toHaveLength(2);
  });

  it('flattens exactly to depth 3 and JSON.stringifies anything deeper', () => {
    const withinDepth = toOtelAttributes({ a: { b: { c: 5 } } });
    expect(withinDepth).toEqual([{ key: 'a.b.c', value: { intValue: '5' } }]);

    const beyondDepth = toOtelAttributes({ a: { b: { c: { d: 1 } } } });
    expect(beyondDepth).toEqual([{ key: 'a.b.c', value: { stringValue: '{"d":1}' } }]);
  });

  it('guards against reference cycles instead of throwing or hanging', () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;

    // maskSensitiveData (upstream, out of scope) runs first per the frozen
    // contract and is not itself cycle-identity-aware -- it clones several
    // levels deep before its own depth cap hands back the raw cyclic
    // reference, so this flatten stage never sees a bare 1-level
    // self-reference. What matters is that toOtelAttributes still terminates
    // safely (this module's own depth cap + WeakSet + safeJsonStringify) and
    // represents the residual cycle rather than throwing or hanging.
    let attrs: ReturnType<typeof toOtelAttributes> | undefined;
    expect(() => {
      attrs = toOtelAttributes({ a: cyclic });
    }).not.toThrow();
    expect(attrs).toBeDefined();
    expect(JSON.stringify(attrs)).toContain('[Circular]');
  });

  it('caps at 64 attributes and appends a salir.truncated_attributes marker with the drop count', () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) fields[`field${i}`] = i;

    const attrs = toOtelAttributes(fields);
    expect(attrs).toHaveLength(65); // 64 kept + 1 marker
    expect(attrs.slice(0, 64)).toEqual(
      Array.from({ length: 64 }, (_, i) => ({ key: `field${i}`, value: { intValue: String(i) } })),
    );
    expect(attrs[64]).toEqual({ key: 'salir.truncated_attributes', value: { intValue: '6' } });
  });

  it('does not append a truncation marker when under the cap', () => {
    const attrs = toOtelAttributes({ a: 1, b: 2 });
    expect(attrs.some((a) => a.key === 'salir.truncated_attributes')).toBe(false);
  });

  it('masks sensitive field values before they reach the output attributes', () => {
    const rawToken = 'super-secret-raw-token-value';
    const attrs = toOtelAttributes({ token: rawToken, userId: 'u1' });

    const tokenAttr = attrs.find((a) => a.key === 'token');
    expect(tokenAttr?.value.stringValue).toBe('***');
    expect(JSON.stringify(attrs)).not.toContain(rawToken);
    expect(attrs).toContainEqual({ key: 'userId', value: { stringValue: 'u1' } });
  });

  it('masks an inline email pattern found inside a non-sensitive-keyed string', () => {
    const attrs = toOtelAttributes({ note: 'contact person@example.com for details' });
    const noteAttr = attrs.find((a) => a.key === 'note');
    expect(noteAttr?.value.stringValue).not.toContain('person@example.com');
    expect(noteAttr?.value.stringValue).toContain('***@***');
  });
});

describe('toOtelLogRecord', () => {
  function makeEvent(overrides: Partial<PinoBrowserLogEvent> = {}): PinoBrowserLogEvent {
    return {
      ts: 1_700_000_000_123,
      messages: ['hello world'],
      bindings: [],
      level: { label: 'info', value: 30 },
      ...overrides,
    };
  }

  it.each([
    ['trace', 1, 'TRACE'],
    ['debug', 5, 'DEBUG'],
    ['info', 9, 'INFO'],
    ['warn', 13, 'WARN'],
    ['error', 17, 'ERROR'],
    ['fatal', 21, 'FATAL'],
  ] as const)(
    'maps pino level label %s to severityNumber %d / severityText %s',
    (label, severityNumber, severityText) => {
      const record = toOtelLogRecord(makeEvent({ level: { label, value: 0 } }));
      expect(record.severityNumber).toBe(severityNumber);
      expect(record.severityText).toBe(severityText);
    },
  );

  it('defaults an unknown level label to info/9', () => {
    const record = toOtelLogRecord(makeEvent({ level: { label: 'silly', value: 0 } }));
    expect(record.severityNumber).toBe(9);
    expect(record.severityText).toBe('INFO');
  });

  it('formats timeUnixNano as epoch-ms concatenated with 6 zeros (no float artifacts)', () => {
    const record = toOtelLogRecord(makeEvent({ ts: 1_700_000_000_123 }));
    expect(record.timeUnixNano).toBe('1700000000123000000');
    expect(record.timeUnixNano).not.toContain('.');
  });

  it('derives a 32-hex lowercase traceId from a UUID correlationId and keeps it as an attribute too', () => {
    const record = toOtelLogRecord(
      makeEvent({ bindings: [{ correlationId: '550E8400-E29B-41D4-A716-446655440000' }] }),
    );
    expect(record.traceId).toBe('550e8400e29b41d4a716446655440000');
    expect(record.attributes).toContainEqual({
      key: 'correlationId',
      value: { stringValue: '550E8400-E29B-41D4-A716-446655440000' },
    });
  });

  it('leaves traceId unset when correlationId does not match the UUID shape', () => {
    const record = toOtelLogRecord(makeEvent({ bindings: [{ correlationId: 'req_12345' }] }));
    expect(record.traceId).toBeUndefined();
    expect('traceId' in record).toBe(false);
    expect(record.attributes).toContainEqual({ key: 'correlationId', value: { stringValue: 'req_12345' } });
  });

  it('merges bindings then object messages in order, later wins', () => {
    const record = toOtelLogRecord(
      makeEvent({
        bindings: [{ a: 1 }, { a: 2, b: 'from-binding' }],
        messages: [{ a: 3 }, 'trailing text'],
      }),
    );
    expect(record.attributes).toContainEqual({ key: 'a', value: { intValue: '3' } });
    expect(record.attributes).toContainEqual({ key: 'b', value: { stringValue: 'from-binding' } });
    expect(record.body).toEqual({ stringValue: 'trailing text' });
  });

  it('joins non-object message entries with a space to form the body', () => {
    const record = toOtelLogRecord(makeEvent({ messages: ['User', 'logged in'] }));
    expect(record.body).toEqual({ stringValue: 'User logged in' });
  });

  it('allows an empty body when every message entry is a plain object', () => {
    const record = toOtelLogRecord(makeEvent({ messages: [{ userId: 'u1' }] }));
    expect(record.body).toEqual({ stringValue: '' });
    expect(record.attributes).toContainEqual({ key: 'userId', value: { stringValue: 'u1' } });
  });

  it('drops a redundant msg field from attributes -- the body already carries it', () => {
    const record = toOtelLogRecord(makeEvent({ messages: [{ msg: 'hello', userId: 'u1' }, 'trailing'] }));
    expect(record.attributes.some((a) => a.key === 'msg')).toBe(false);
    expect(record.attributes).toContainEqual({ key: 'userId', value: { stringValue: 'u1' } });
    expect(record.body).toEqual({ stringValue: 'trailing' });
  });

  describe('explicit traceContext (ADR-254)', () => {
    const TRACE_CONTEXT = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' };

    it('stamps both traceId and spanId verbatim when an explicit traceContext is given', () => {
      const record = toOtelLogRecord(makeEvent(), TRACE_CONTEXT);
      expect(record.traceId).toBe(TRACE_CONTEXT.traceId);
      expect(record.spanId).toBe(TRACE_CONTEXT.spanId);
    });

    it('an explicit traceContext WINS over a UUID correlationId in bindings', () => {
      const record = toOtelLogRecord(
        makeEvent({ bindings: [{ correlationId: '550E8400-E29B-41D4-A716-446655440000' }] }),
        TRACE_CONTEXT,
      );
      expect(record.traceId).toBe(TRACE_CONTEXT.traceId);
      expect(record.traceId).not.toBe('550e8400e29b41d4a716446655440000');
      expect(record.spanId).toBe(TRACE_CONTEXT.spanId);
      // The correlationId attribute itself is untouched -- it's still the join key.
      expect(record.attributes).toContainEqual({
        key: 'correlationId',
        value: { stringValue: '550E8400-E29B-41D4-A716-446655440000' },
      });
    });

    it('no traceContext + UUID correlationId -> traceId only, no spanId (existing behaviour)', () => {
      const record = toOtelLogRecord(
        makeEvent({ bindings: [{ correlationId: '550E8400-E29B-41D4-A716-446655440000' }] }),
      );
      expect(record.traceId).toBe('550e8400e29b41d4a716446655440000');
      expect(record.spanId).toBeUndefined();
      expect('spanId' in record).toBe(false);
    });

    it('no traceContext + non-UUID correlationId -> neither traceId nor spanId', () => {
      const record = toOtelLogRecord(makeEvent({ bindings: [{ correlationId: 'req_12345' }] }));
      expect(record.traceId).toBeUndefined();
      expect(record.spanId).toBeUndefined();
      expect('traceId' in record).toBe(false);
      expect('spanId' in record).toBe(false);
    });
  });
});

describe('buildResource', () => {
  it('maps a flat string attribute map to OTLP key/value pairs', () => {
    expect(buildResource({ 'service.name': 'salir-web', 'deployment.environment': 'staging' })).toEqual({
      attributes: [
        { key: 'service.name', value: { stringValue: 'salir-web' } },
        { key: 'deployment.environment', value: { stringValue: 'staging' } },
      ],
    });
  });

  it('produces an empty attributes array for an empty map', () => {
    expect(buildResource({})).toEqual({ attributes: [] });
  });
});

describe('buildExportPayload', () => {
  it('wraps resource + records in the exact OTLP ExportLogsServiceRequest envelope', () => {
    const resource = buildResource({ 'service.name': 'salir-web' });
    const record = toOtelLogRecord({
      ts: 1_700_000_000_000,
      messages: ['hi'],
      bindings: [],
      level: { label: 'info', value: 30 },
    });

    expect(buildExportPayload(resource, [record])).toEqual({
      resourceLogs: [
        {
          resource,
          scopeLogs: [
            {
              scope: { name: '@prompt-studio/observability' },
              logRecords: [record],
            },
          ],
        },
      ],
    });
  });

  it('passes a record with spanId through untouched (structural wrap only)', () => {
    const resource = buildResource({ 'service.name': 'salir-web' });
    const record = toOtelLogRecord(
      { ts: 1_700_000_000_000, messages: ['hi'], bindings: [], level: { label: 'info', value: 30 } },
      { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' },
    );

    const payload = buildExportPayload(resource, [record]) as {
      resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<{ spanId?: string; traceId?: string }> }> }>;
    };
    const shippedRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(shippedRecord.spanId).toBe('00f067aa0ba902b7');
    expect(shippedRecord.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});
