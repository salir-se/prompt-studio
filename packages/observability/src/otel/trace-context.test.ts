// @module-tag pure
import { describe, expect, it } from 'vitest';
import {
  buildTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  type TraceContext,
  traceIdFromCorrelationId,
  TRACEPARENT_HEADER,
} from './trace-context';

// W3C spec's own worked example (https://www.w3.org/TR/trace-context/#traceparent-header-field-values).
const VALID_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const VALID_SPAN_ID = '00f067aa0ba902b7';

describe('TRACEPARENT_HEADER', () => {
  it('is the W3C header name', () => {
    expect(TRACEPARENT_HEADER).toBe('traceparent');
  });
});

describe('parseTraceparent', () => {
  it('parses a valid sampled header', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`)).toEqual({
      traceId: VALID_TRACE_ID,
      spanId: VALID_SPAN_ID,
      sampled: true,
    });
  });

  it('parses a valid unsampled header', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-00`)).toEqual({
      traceId: VALID_TRACE_ID,
      spanId: VALID_SPAN_ID,
      sampled: false,
    });
  });

  it('reads sampled from bit 0 of the flags byte only', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-02`)?.sampled).toBe(false); // 0b010, bit0=0
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-03`)?.sampled).toBe(true); // 0b011, bit0=1
  });

  it('rejects an unsupported version (01)', () => {
    expect(parseTraceparent(`01-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`)).toBeNull();
  });

  it('rejects an unsupported version (ff, the spec-reserved "invalid" version)', () => {
    expect(parseTraceparent(`ff-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`)).toBeNull();
  });

  it('rejects too few fields', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}`)).toBeNull();
  });

  it('rejects too many fields', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01-extra`)).toBeNull();
  });

  it('rejects uppercase hex in the trace id', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID.toUpperCase()}-${VALID_SPAN_ID}-01`)).toBeNull();
  });

  it('rejects uppercase hex in the span id', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID.toUpperCase()}-01`)).toBeNull();
  });

  it('rejects a trace id shorter than 32 hex chars', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID.slice(0, 31)}-${VALID_SPAN_ID}-01`)).toBeNull();
  });

  it('rejects a trace id longer than 32 hex chars', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}a-${VALID_SPAN_ID}-01`)).toBeNull();
  });

  it('rejects a span id shorter than 16 hex chars', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID.slice(0, 15)}-01`)).toBeNull();
  });

  it('rejects a span id longer than 16 hex chars', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}a-01`)).toBeNull();
  });

  it('rejects an all-zero trace id', () => {
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${VALID_SPAN_ID}-01`)).toBeNull();
  });

  it('rejects an all-zero span id', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${'0'.repeat(16)}-01`)).toBeNull();
  });

  it('rejects a malformed flags field', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-1`)).toBeNull();
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-xy`)).toBeNull();
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-`)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseTraceparent(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseTraceparent(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseTraceparent('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(parseTraceparent('   ')).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(parseTraceparent(`  00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01  \n`)).toEqual({
      traceId: VALID_TRACE_ID,
      spanId: VALID_SPAN_ID,
      sampled: true,
    });
  });

  it('rejects garbage input', () => {
    expect(parseTraceparent('not-a-traceparent-header')).toBeNull();
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00--01')).toBeNull();
  });
});

describe('buildTraceparent', () => {
  it('renders a sampled context', () => {
    expect(buildTraceparent({ traceId: VALID_TRACE_ID, spanId: VALID_SPAN_ID, sampled: true })).toBe(
      `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`,
    );
  });

  it('renders an unsampled context', () => {
    expect(buildTraceparent({ traceId: VALID_TRACE_ID, spanId: VALID_SPAN_ID, sampled: false })).toBe(
      `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-00`,
    );
  });
});

describe('parseTraceparent(buildTraceparent(x)) round-trip', () => {
  const cases: TraceContext[] = [
    { traceId: VALID_TRACE_ID, spanId: VALID_SPAN_ID, sampled: true },
    { traceId: VALID_TRACE_ID, spanId: VALID_SPAN_ID, sampled: false },
    { traceId: '1'.repeat(32), spanId: '2'.repeat(16), sampled: true },
    { traceId: `${'a'.repeat(31)}1`, spanId: 'f'.repeat(16), sampled: false },
  ];

  it.each(cases)('round-trips $traceId/$spanId/$sampled', (ctx) => {
    expect(parseTraceparent(buildTraceparent(ctx))).toEqual(ctx);
  });
});

describe('generateSpanId', () => {
  it('produces 16 lowercase hex chars', () => {
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is never all-zero', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSpanId()).not.toBe('0'.repeat(16));
    }
  });

  it('differs across consecutive calls', () => {
    expect(generateSpanId()).not.toBe(generateSpanId());
  });
});

describe('generateTraceId', () => {
  it('produces 32 lowercase hex chars', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is never all-zero', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTraceId()).not.toBe('0'.repeat(32));
    }
  });

  it('differs across consecutive calls', () => {
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
});

describe('traceIdFromCorrelationId', () => {
  it('normalizes a dashed UUID (mixed case) to 32 lowercase hex', () => {
    expect(traceIdFromCorrelationId('4BF92F35-77B3-4DA6-A3CE-929D0E0E4736')).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('normalizes an already-lowercase UUID identically', () => {
    expect(traceIdFromCorrelationId('4bf92f35-77b3-4da6-a3ce-929d0e0e4736')).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('mints a random 32-hex trace id for a non-UUID string', () => {
    expect(traceIdFromCorrelationId('not-a-uuid')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints different random trace ids across calls for the same non-UUID string', () => {
    expect(traceIdFromCorrelationId('req-123')).not.toBe(traceIdFromCorrelationId('req-123'));
  });

  it('mints a random 32-hex trace id for undefined', () => {
    expect(traceIdFromCorrelationId(undefined)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints different random trace ids across calls for undefined', () => {
    expect(traceIdFromCorrelationId(undefined)).not.toBe(traceIdFromCorrelationId(undefined));
  });
});
