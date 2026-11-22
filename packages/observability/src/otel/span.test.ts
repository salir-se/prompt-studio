// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import type { OtelResource } from './log-record';
import {
  buildSpan,
  buildTraceExportPayload,
  createSpanShipper,
  type OtelSpan,
  SPAN_KIND,
  SPAN_STATUS,
  type SpanShipperConfig,
} from './span';

const resource: OtelResource = { attributes: [{ key: 'service.name', value: { stringValue: 'salir-test' } }] };

const TRACE_ID = 'a'.repeat(32);
const SPAN_ID = 'b'.repeat(16);
const PARENT_SPAN_ID = 'c'.repeat(16);

function makeSpan(overrides: Partial<OtelSpan> = {}): OtelSpan {
  return {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: 'GET /health',
    kind: SPAN_KIND.SERVER,
    startTimeUnixNano: '1700000000000000000',
    endTimeUnixNano: '1700000000100000000',
    attributes: [],
    status: { code: SPAN_STATUS.UNSET },
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200 } as unknown as Response;
}

function badResponse(status = 500): Response {
  return { ok: false, status } as unknown as Response;
}

// Every test injects its own fetchImpl mock -- the package's shared test setup
// installs a global-fetch network guard, so stubbing globalThis.fetch is both
// unnecessary and would be caught by that guard.
function makeConfig(
  overrides: Partial<SpanShipperConfig> & { fetchImpl: ReturnType<typeof vi.fn> },
): SpanShipperConfig {
  return {
    baseUrl: 'https://eu-central-1.aws.edge.axiom.co',
    token: 'test-token',
    dataset: 'salir-traces-local',
    resource,
    ...overrides,
  };
}

describe('buildSpan', () => {
  it('converts millisecond timestamps to exact nanosecond decimal strings without float precision loss', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.INTERNAL,
      startTimeMs: 1787000000123,
      endTimeMs: 1787000000456,
    });

    expect(span.startTimeUnixNano).toBe('1787000000123000000');
    expect(span.endTimeUnixNano).toBe('1787000000456000000');
  });

  it('omits parentSpanId entirely when absent (not even as an undefined key)', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.INTERNAL,
      startTimeMs: 0,
      endTimeMs: 1,
    });

    expect('parentSpanId' in span).toBe(false);
  });

  it('includes parentSpanId when provided', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      parentSpanId: PARENT_SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.CLIENT,
      startTimeMs: 0,
      endTimeMs: 1,
    });

    expect(span.parentSpanId).toBe(PARENT_SPAN_ID);
  });

  it('defaults status to UNSET when omitted', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.INTERNAL,
      startTimeMs: 0,
      endTimeMs: 1,
    });

    expect(span.status).toEqual({ code: SPAN_STATUS.UNSET });
  });

  it('passes an explicit status through unchanged', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.INTERNAL,
      startTimeMs: 0,
      endTimeMs: 1,
      status: { code: SPAN_STATUS.ERROR, message: 'boom' },
    });

    expect(span.status).toEqual({ code: SPAN_STATUS.ERROR, message: 'boom' });
  });

  it('converts attributes using the same encoding + MAX_ATTRIBUTES clamp as log-record attributes', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) many[`key${i}`] = i;

    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.INTERNAL,
      startTimeMs: 0,
      endTimeMs: 1,
      attributes: many,
    });

    // 64-attribute cap + one 'salir.truncated_attributes' marker (log-record.ts's MAX_ATTRIBUTES).
    expect(span.attributes).toHaveLength(65);
    expect(span.attributes.find((a) => a.key === 'key0')).toEqual({ key: 'key0', value: { intValue: '0' } });
    expect(span.attributes.some((a) => a.key === 'salir.truncated_attributes')).toBe(true);
  });

  it('defaults attributes to an empty array when omitted', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'op',
      kind: SPAN_KIND.INTERNAL,
      startTimeMs: 0,
      endTimeMs: 1,
    });

    expect(span.attributes).toEqual([]);
  });

  it('carries traceId, spanId, name, and kind through unchanged', () => {
    const span = buildSpan({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: 'POST /orders',
      kind: SPAN_KIND.SERVER,
      startTimeMs: 0,
      endTimeMs: 1,
    });

    expect(span.traceId).toBe(TRACE_ID);
    expect(span.spanId).toBe(SPAN_ID);
    expect(span.name).toBe('POST /orders');
    expect(span.kind).toBe(SPAN_KIND.SERVER);
  });
});

describe('buildTraceExportPayload', () => {
  it('wraps spans in the exact OTLP ExportTraceServiceRequest envelope, scoped to @prompt-studio/observability', () => {
    const span = makeSpan();

    const payload = buildTraceExportPayload(resource, [span]);

    expect(payload).toEqual({
      resourceSpans: [
        {
          resource,
          scopeSpans: [{ scope: { name: '@prompt-studio/observability' }, spans: [span] }],
        },
      ],
    });
  });

  it('carries an empty spans array through unchanged', () => {
    const payload = buildTraceExportPayload(resource, []);

    expect(payload).toEqual({
      resourceSpans: [
        {
          resource,
          scopeSpans: [{ scope: { name: '@prompt-studio/observability' }, spans: [] }],
        },
      ],
    });
  });
});

describe('createSpanShipper: enqueue', () => {
  it('never throws and tracks pending count', () => {
    const shipper = createSpanShipper(makeConfig({ fetchImpl: vi.fn() }));
    expect(() => shipper.enqueue(makeSpan())).not.toThrow();
    expect(shipper.pending).toBe(1);
  });

  it('drops a malformed span (invalid traceId shape) via onError instead of throwing', () => {
    const onError = vi.fn();
    const shipper = createSpanShipper(makeConfig({ fetchImpl: vi.fn(), onError }));

    expect(() => shipper.enqueue(makeSpan({ traceId: 'not-hex' }))).not.toThrow();

    expect(shipper.pending).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('drops a malformed span (invalid spanId shape) via onError instead of throwing', () => {
    const onError = vi.fn();
    const shipper = createSpanShipper(makeConfig({ fetchImpl: vi.fn(), onError }));

    shipper.enqueue(makeSpan({ spanId: 'too-short' }));

    expect(shipper.pending).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('never breaks the shipper when onError itself throws', () => {
    const onError = vi.fn().mockImplementation(() => {
      throw new Error('onError exploded');
    });
    const shipper = createSpanShipper(makeConfig({ fetchImpl: vi.fn(), onError }));

    expect(() => shipper.enqueue(makeSpan({ traceId: 'bad' }))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('createSpanShipper: flush request shape', () => {
  it('POSTs to {baseUrl}/v1/traces with exactly the three required headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl, token: 'tok_abc', dataset: 'my-dataset' }));
    shipper.enqueue(makeSpan());

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://eu-central-1.aws.edge.axiom.co/v1/traces');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok_abc',
      'X-Axiom-Dataset': 'my-dataset',
      'Content-Type': 'application/json',
    });
  });

  it('honors the caller-supplied baseUrl exactly (no built-in default)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl, baseUrl: 'https://axiom.example.internal' }));
    shipper.enqueue(makeSpan());

    await shipper.flush();

    expect(fetchImpl.mock.calls[0][0]).toBe('https://axiom.example.internal/v1/traces');
  });

  it('wraps the batch in the exact OTLP envelope via buildTraceExportPayload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl }));
    const span = makeSpan();
    shipper.enqueue(span);

    await shipper.flush();

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(payload).toEqual(buildTraceExportPayload(resource, [span]));
  });

  it('is a no-op that never calls fetch when the queue is empty', async () => {
    const fetchImpl = vi.fn();
    const shipper = createSpanShipper(makeConfig({ fetchImpl }));

    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('empties the queue (pending back to 0) once every batch has shipped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeSpan());
    shipper.enqueue(makeSpan());

    await shipper.flush();

    expect(shipper.pending).toBe(0);
  });
});

describe('createSpanShipper: batching (mirrors log shipper maxBatchRecords semantics)', () => {
  it('splits into multiple POSTs once maxBatch is exceeded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl, maxBatch: 2 }));
    shipper.enqueue(makeSpan());
    shipper.enqueue(makeSpan());
    shipper.enqueue(makeSpan());

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(firstBody.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(secondBody.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('defaults maxBatch to 100, matching the log shipper default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl }));
    for (let i = 0; i < 101; i++) shipper.enqueue(makeSpan());

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(firstBody.resourceSpans[0].scopeSpans[0].spans).toHaveLength(100);
  });

  it('does not auto-flush on enqueue -- maxBatch only shapes how an explicit flush() splits POSTs', () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl, maxBatch: 1 }));

    shipper.enqueue(makeSpan());
    shipper.enqueue(makeSpan());

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(shipper.pending).toBe(2);
  });
});

describe('createSpanShipper: failure handling', () => {
  it('resolves (never rejects) on a non-2xx response and reports it via onError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(badResponse(500));
    const onError = vi.fn();
    const shipper = createSpanShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeSpan());

    await expect(shipper.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('treats a rejected fetch (network error) the same as a non-2xx response', async () => {
    const networkError = new Error('network down');
    const fetchImpl = vi.fn().mockRejectedValue(networkError);
    const onError = vi.fn();
    const shipper = createSpanShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeSpan());

    await expect(shipper.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(networkError);
  });

  it('never rejects even when fetchImpl throws synchronously', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const onError = vi.fn();
    const shipper = createSpanShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeSpan());

    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('never breaks the shipper when onError itself throws during flush', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(badResponse(500));
    const onError = vi.fn().mockImplementation(() => {
      throw new Error('onError exploded');
    });
    const shipper = createSpanShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeSpan());

    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('flush never throws or rejects even without an onError handler configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(badResponse(500));
    const shipper = createSpanShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeSpan());

    await expect(shipper.flush()).resolves.toBeUndefined();
  });
});

describe('createSpanShipper: concurrent flush coalescing', () => {
  it('sequences concurrent flush() calls -- no interleaved double-send of the same spans', async () => {
    let resolveFirst: (value: Response) => void = () => {};
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchImpl = vi.fn().mockReturnValueOnce(firstFetch).mockResolvedValue(okResponse());
    const shipper = createSpanShipper(makeConfig({ fetchImpl, maxBatch: 1 }));
    shipper.enqueue(makeSpan({ name: 'one' }));

    const flush1 = shipper.flush();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(shipper.pending).toBe(0);

    shipper.enqueue(makeSpan({ name: 'two' }));
    const flush2 = shipper.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirst(okResponse());
    await Promise.all([flush1, flush2]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(secondCallBody.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('two');
    expect(shipper.pending).toBe(0);
  });
});
