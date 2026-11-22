// @module-tag pure
import { describe, expect, it } from 'vitest';
import type { OtelKeyValue, OtelLogRecord } from './log-record';
import { MAX_ATTR_VALUE_CHARS, MAX_RECORD_BODY_CHARS, normalizeLogRecords } from './normalize';

function makeRecord(overrides: Partial<OtelLogRecord> = {}): OtelLogRecord {
  return {
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    severityText: 'INFO',
    body: { stringValue: 'hello' },
    attributes: [],
    ...overrides,
  };
}

function attr(key: string, stringValue: string): OtelKeyValue {
  return { key, value: { stringValue } };
}

describe('normalizeLogRecords: fast path', () => {
  it('returns a single record unchanged when body and attributes are within caps', () => {
    const record = makeRecord({ attributes: [attr('userId', 'u1')] });

    const results = normalizeLogRecords(record);

    expect(results).toHaveLength(1);
    expect(results[0].body).toEqual({ stringValue: 'hello' });
    expect(results[0].attributes).toEqual([attr('userId', 'u1')]);
    expect(results[0].timeUnixNano).toBe(record.timeUnixNano);
    expect(results[0].severityNumber).toBe(record.severityNumber);
    expect(results[0].severityText).toBe(record.severityText);
  });

  it('preserves traceId on the fast path', () => {
    const record = makeRecord({ traceId: '550e8400e29b41d4a716446655440000' });

    const [result] = normalizeLogRecords(record);

    expect(result.traceId).toBe('550e8400e29b41d4a716446655440000');
  });

  it('omits traceId on the fast path when the input never had one', () => {
    const record = makeRecord();

    const [result] = normalizeLogRecords(record);

    expect('traceId' in result).toBe(false);
  });

  it('does not mutate the input record', () => {
    const record = makeRecord({ attributes: [attr('a', 'x'.repeat(MAX_ATTR_VALUE_CHARS + 1))] });
    const snapshot = JSON.parse(JSON.stringify(record));

    normalizeLogRecords(record);

    expect(record).toEqual(snapshot);
  });
});

describe('normalizeLogRecords: attribute value truncation', () => {
  it('truncates a value over MAX_ATTR_VALUE_CHARS to MAX_ATTR_VALUE_CHARS-1 chars plus an ellipsis, and appends a count marker', () => {
    const longValue = 'a'.repeat(MAX_ATTR_VALUE_CHARS + 1); // 2049 chars
    const record = makeRecord({ attributes: [attr('big', longValue)] });

    const [result] = normalizeLogRecords(record);

    const bigAttr = result.attributes.find((a) => a.key === 'big');
    expect(bigAttr?.value.stringValue).toHaveLength(MAX_ATTR_VALUE_CHARS);
    expect(bigAttr?.value.stringValue).toBe(`${'a'.repeat(MAX_ATTR_VALUE_CHARS - 1)}…`);
    expect(result.attributes).toContainEqual({ key: 'salir.truncated_values', value: { intValue: '1' } });
  });

  it('does not truncate a value exactly at MAX_ATTR_VALUE_CHARS', () => {
    const value = 'a'.repeat(MAX_ATTR_VALUE_CHARS);
    const record = makeRecord({ attributes: [attr('ok', value)] });

    const [result] = normalizeLogRecords(record);

    expect(result.attributes).toContainEqual({ key: 'ok', value: { stringValue: value } });
    expect(result.attributes.some((a) => a.key === 'salir.truncated_values')).toBe(false);
  });

  it('counts every truncated attribute in a single marker', () => {
    const longValue = 'a'.repeat(MAX_ATTR_VALUE_CHARS + 10);
    const record = makeRecord({ attributes: [attr('a', longValue), attr('b', longValue), attr('c', 'short')] });

    const [result] = normalizeLogRecords(record);

    expect(result.attributes).toContainEqual({ key: 'salir.truncated_values', value: { intValue: '2' } });
    expect(result.attributes.filter((a) => a.key === 'salir.truncated_values')).toHaveLength(1);
  });

  it('replaces the LAST attribute with the marker instead of exceeding 64 attributes when already at the cap', () => {
    const attributes: OtelKeyValue[] = Array.from({ length: 63 }, (_, i) => attr(`field${i}`, 'short'));
    attributes.push(attr('field63', 'z'.repeat(MAX_ATTR_VALUE_CHARS + 1))); // 64th attribute, overlong
    const record = makeRecord({ attributes });

    const [result] = normalizeLogRecords(record);

    expect(result.attributes).toHaveLength(64);
    expect(result.attributes[63]).toEqual({ key: 'salir.truncated_values', value: { intValue: '1' } });
    // field63's own (truncated) value was dropped entirely to make room for the marker.
    expect(result.attributes.some((a) => a.key === 'field63')).toBe(false);
    for (let i = 0; i < 63; i++) {
      expect(result.attributes[i]).toEqual({ key: `field${i}`, value: { stringValue: 'short' } });
    }
  });
});

describe('normalizeLogRecords: body chunking', () => {
  it('keeps a single record when the body is exactly at MAX_RECORD_BODY_CHARS', () => {
    const body = 'x'.repeat(MAX_RECORD_BODY_CHARS);
    const record = makeRecord({ body: { stringValue: body } });

    const results = normalizeLogRecords(record);

    expect(results).toHaveLength(1);
    expect(results[0].body.stringValue).toHaveLength(MAX_RECORD_BODY_CHARS);
  });

  it('splits into exactly 2 records when the body is one char over the cap', () => {
    const body = 'x'.repeat(MAX_RECORD_BODY_CHARS + 1);
    const record = makeRecord({ body: { stringValue: body } });
    const chunkBodyCap = MAX_RECORD_BODY_CHARS - 64;

    const results = normalizeLogRecords(record, { chunkIdFn: () => 'chunk-fixed' });

    expect(results).toHaveLength(2);
    expect(results[0].body.stringValue).toHaveLength(chunkBodyCap);
    expect(results[1].body.stringValue).toHaveLength(body.length - chunkBodyCap);
    expect(results.map((r) => r.body.stringValue).join('')).toBe(body);
  });

  it('shares timeUnixNano/severityNumber/severityText/traceId, a single chunk_id, and 1-based seq/chunks across all chunks', () => {
    const body = 'x'.repeat(MAX_RECORD_BODY_CHARS * 2 + 500); // forces 3 chunks
    const record = makeRecord({ body: { stringValue: body }, traceId: '550e8400e29b41d4a716446655440000' });

    const results = normalizeLogRecords(record, { chunkIdFn: () => 'fixed-chunk-id' });

    expect(results).toHaveLength(3);
    for (const [i, r] of results.entries()) {
      expect(r.timeUnixNano).toBe(record.timeUnixNano);
      expect(r.severityNumber).toBe(record.severityNumber);
      expect(r.severityText).toBe(record.severityText);
      expect(r.traceId).toBe(record.traceId);
      expect(r.attributes).toContainEqual({ key: 'salir.chunk_id', value: { stringValue: 'fixed-chunk-id' } });
      expect(r.attributes).toContainEqual({ key: 'salir.seq', value: { intValue: String(i + 1) } });
      expect(r.attributes).toContainEqual({ key: 'salir.chunks', value: { intValue: '3' } });
    }
  });

  it('gives chunk 1 the full normalized attributes and later chunks only the correlationId attribute', () => {
    const body = 'x'.repeat(MAX_RECORD_BODY_CHARS + 1);
    const record = makeRecord({
      body: { stringValue: body },
      attributes: [attr('correlationId', 'req-1234'), attr('userId', 'u1'), attr('workspaceId', 'w1')],
    });

    const [chunk1, chunk2] = normalizeLogRecords(record);

    expect(chunk1.attributes).toContainEqual(attr('correlationId', 'req-1234'));
    expect(chunk1.attributes).toContainEqual(attr('userId', 'u1'));
    expect(chunk1.attributes).toContainEqual(attr('workspaceId', 'w1'));

    const chunk2NonMarkerKeys = chunk2.attributes.filter((a) => !a.key.startsWith('salir.')).map((a) => a.key);
    expect(chunk2NonMarkerKeys).toEqual(['correlationId']);
    expect(chunk2.attributes).toContainEqual(attr('correlationId', 'req-1234'));
  });

  it('gives later chunks no non-marker attributes when correlationId is absent', () => {
    const body = 'x'.repeat(MAX_RECORD_BODY_CHARS + 1);
    const record = makeRecord({ body: { stringValue: body }, attributes: [attr('userId', 'u1')] });

    const [, chunk2] = normalizeLogRecords(record);

    const chunk2NonMarkerKeys = chunk2.attributes.filter((a) => !a.key.startsWith('salir.'));
    expect(chunk2NonMarkerKeys).toHaveLength(0);
  });

  it('uses the injected chunkIdFn exactly once, reused across every chunk, rather than generating a real UUID', () => {
    const body = 'x'.repeat(MAX_RECORD_BODY_CHARS + 1);
    const record = makeRecord({ body: { stringValue: body } });
    let calls = 0;
    const chunkIdFn = () => {
      calls += 1;
      return `stub-${calls}`;
    };

    const results = normalizeLogRecords(record, { chunkIdFn });

    expect(calls).toBe(1);
    for (const r of results) {
      expect(r.attributes).toContainEqual({ key: 'salir.chunk_id', value: { stringValue: 'stub-1' } });
    }
  });
});

describe('normalizeLogRecords: surrogate-pair safety', () => {
  it('never splits a surrogate pair across a chunk boundary', () => {
    const chunkBodyCap = MAX_RECORD_BODY_CHARS - 64;
    const emoji = '\u{1F600}'; // U+1F600, a 2-code-unit surrogate pair
    // The high surrogate lands exactly where a naive fixed-width slice would cut.
    const body = `${'x'.repeat(chunkBodyCap - 1)}${emoji}${'y'.repeat(200)}`;
    const record = makeRecord({ body: { stringValue: body } });

    const results = normalizeLogRecords(record);

    expect(results.length).toBeGreaterThan(1);
    for (const r of results) {
      expect(r.body.stringValue).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
    expect(results.map((r) => r.body.stringValue).join('')).toBe(body);
  });
});

describe('normalizeLogRecords: never throws', () => {
  it('handles an empty body', () => {
    const record = makeRecord({ body: { stringValue: '' } });

    expect(() => normalizeLogRecords(record)).not.toThrow();
    const [result] = normalizeLogRecords(record);
    expect(result.body).toEqual({ stringValue: '' });
  });

  it('handles zero attributes', () => {
    const record = makeRecord({ attributes: [] });

    expect(() => normalizeLogRecords(record)).not.toThrow();
    const [result] = normalizeLogRecords(record);
    expect(result.attributes).toEqual([]);
  });

  it('never throws even on a malformed record shape', () => {
    const malformed = { ...makeRecord(), attributes: null } as unknown as OtelLogRecord;

    expect(() => normalizeLogRecords(malformed)).not.toThrow();
  });
});

describe('normalizeLogRecords: relay-cap compliance', () => {
  it('every output record satisfies the BFF relay caps (body <= 8192, attrs <= 64, attr stringValue <= 2048)', () => {
    const RELAY_MAX_BODY_CHARS = 8192;
    const RELAY_MAX_ATTRIBUTES = 64;
    const RELAY_MAX_STRING_ATTR_CHARS = 2048;

    const bigAttrs: OtelKeyValue[] = Array.from({ length: 70 }, (_, i) =>
      attr(`field${i}`, i % 2 === 0 ? 'z'.repeat(3000) : 'short'),
    );
    const record = makeRecord({ body: { stringValue: 'x'.repeat(20_000) }, attributes: bigAttrs });

    const results = normalizeLogRecords(record);

    expect(results.length).toBeGreaterThan(1);
    for (const r of results) {
      expect(r.body.stringValue.length).toBeLessThanOrEqual(RELAY_MAX_BODY_CHARS);
      expect(r.attributes.length).toBeLessThanOrEqual(RELAY_MAX_ATTRIBUTES);
      for (const a of r.attributes) {
        if (a.value.stringValue !== undefined) {
          expect(a.value.stringValue.length).toBeLessThanOrEqual(RELAY_MAX_STRING_ATTR_CHARS);
        }
      }
    }
  });
});
