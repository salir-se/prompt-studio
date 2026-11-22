// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import type { OtelLogRecord, OtelResource } from './log-record';
import { createLogShipper, type LogShipperConfig } from './shipper';

const resource: OtelResource = { attributes: [{ key: 'service.name', value: { stringValue: 'salir-test' } }] };

function makeRecord(overrides: Partial<OtelLogRecord> = {}): OtelLogRecord {
  return {
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    severityText: 'INFO',
    body: { stringValue: 'test' },
    attributes: [],
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
function makeConfig(overrides: Partial<LogShipperConfig> & { fetchImpl: ReturnType<typeof vi.fn> }): LogShipperConfig {
  return {
    token: 'test-token',
    dataset: 'salir-logs-local',
    resource,
    ...overrides,
  };
}

describe('createLogShipper: enqueue', () => {
  it('never throws and tracks pending count', () => {
    const shipper = createLogShipper(makeConfig({ fetchImpl: vi.fn() }));
    expect(() => shipper.enqueue(makeRecord())).not.toThrow();
    expect(shipper.pending).toBe(1);
    expect(shipper.droppedRecords).toBe(0);
  });

  it('drops the oldest queued record once maxQueueRecords is exceeded', () => {
    const shipper = createLogShipper(makeConfig({ fetchImpl: vi.fn(), maxQueueRecords: 2 }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'first' } }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'second' } }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'third' } }));

    expect(shipper.pending).toBe(2);
    expect(shipper.droppedRecords).toBe(1);
  });
});

describe('createLogShipper: flush request shape', () => {
  it('POSTs to {baseUrl}/v1/logs with exactly the three required headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl, token: 'tok_abc', dataset: 'my-dataset' }));
    shipper.enqueue(makeRecord());

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://eu-central-1.aws.edge.axiom.co/v1/logs');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok_abc',
      'X-Axiom-Dataset': 'my-dataset',
      'Content-Type': 'application/json',
    });
  });

  it('honors a custom baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl, baseUrl: 'https://axiom.example.internal' }));
    shipper.enqueue(makeRecord());

    await shipper.flush();

    expect(fetchImpl.mock.calls[0][0]).toBe('https://axiom.example.internal/v1/logs');
  });

  it('defaults baseUrl to the eu-central-1 edge domain when omitted (ingest is region-pinned)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeRecord());

    await shipper.flush();

    expect(fetchImpl.mock.calls[0][0]).toBe('https://eu-central-1.aws.edge.axiom.co/v1/logs');
  });

  it('wraps the batch in the exact OTLP envelope, scoped to @prompt-studio/observability', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    const record = makeRecord();
    shipper.enqueue(record);

    await shipper.flush();

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(payload).toEqual({
      resourceLogs: [
        {
          resource,
          scopeLogs: [{ scope: { name: '@prompt-studio/observability' }, logRecords: [record] }],
        },
      ],
    });
  });

  it('is a no-op that never calls fetch when the queue is empty', async () => {
    const fetchImpl = vi.fn();
    const shipper = createLogShipper(makeConfig({ fetchImpl }));

    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('empties the queue (pending back to 0) once every batch has shipped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeRecord());
    shipper.enqueue(makeRecord());

    await shipper.flush();

    expect(shipper.pending).toBe(0);
  });
});

describe('createLogShipper: batching limits', () => {
  it('splits into multiple POSTs once maxBatchRecords is exceeded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl, maxBatchRecords: 2 }));
    shipper.enqueue(makeRecord());
    shipper.enqueue(makeRecord());
    shipper.enqueue(makeRecord());

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(firstBody.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2);
    expect(secondBody.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
  });

  it('splits into multiple POSTs once maxBatchBytes is exceeded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const record = makeRecord({ body: { stringValue: 'x'.repeat(50) } });
    const recordBytes = JSON.stringify(record).length;
    // Budget fits exactly one record, not two.
    const shipper = createLogShipper(makeConfig({ fetchImpl, maxBatchBytes: recordBytes + 10 }));
    shipper.enqueue(record);
    shipper.enqueue(record);

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('still ships a single oversized record alone rather than dropping it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const hugeRecord = makeRecord({ body: { stringValue: 'x'.repeat(1000) } });
    const shipper = createLogShipper(makeConfig({ fetchImpl, maxBatchBytes: 10 }));
    shipper.enqueue(hugeRecord);

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
  });

  it('defaults maxBatchRecords to 100', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    for (let i = 0; i < 101; i++) shipper.enqueue(makeRecord());

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(firstBody.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(100);
  });
});

describe('createLogShipper: drop reporting', () => {
  it('tags the first record of the next batch with salir.dropped_records and keeps the cumulative counter monotonic', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl, maxQueueRecords: 2 }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'first' } }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'second' } }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'third' } })); // drops 'first'
    expect(shipper.droppedRecords).toBe(1);

    await shipper.flush();

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const records = body.resourceLogs[0].scopeLogs[0].logRecords as OtelLogRecord[];
    expect(records.map((r) => r.body.stringValue)).toEqual(['second', 'third']);
    expect(records[0].attributes).toContainEqual({ key: 'salir.dropped_records', value: { intValue: '1' } });
    expect(records[1].attributes.some((a) => a.key === 'salir.dropped_records')).toBe(false);
    // Cumulative counter is unaffected by reporting -- it only grows.
    expect(shipper.droppedRecords).toBe(1);
  });

  it('does not tag anything when nothing has been dropped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeRecord());

    await shipper.flush();

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const [record] = body.resourceLogs[0].scopeLogs[0].logRecords as OtelLogRecord[];
    expect(record.attributes.some((a) => a.key === 'salir.dropped_records')).toBe(false);
  });
});

describe('createLogShipper: failure handling', () => {
  it('requeues a failed batch once, then drops it on a second consecutive failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(badResponse(500));
    const onError = vi.fn();
    const shipper = createLogShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeRecord());

    await shipper.flush(); // 1st failure -> requeued, not dropped
    expect(shipper.pending).toBe(1);
    expect(shipper.droppedRecords).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);

    await shipper.flush(); // 2nd failure -> dropped
    expect(shipper.pending).toBe(0);
    expect(shipper.droppedRecords).toBe(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a rejected fetch (network error) the same as a non-2xx response', async () => {
    const networkError = new Error('network down');
    const fetchImpl = vi.fn().mockRejectedValue(networkError);
    const onError = vi.fn();
    const shipper = createLogShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeRecord());

    await expect(shipper.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(networkError);
    expect(shipper.pending).toBe(1); // requeued for its one retry
  });

  it('never rejects even when fetchImpl throws synchronously', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const onError = vi.fn();
    const shipper = createLogShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeRecord());

    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('never breaks the shipper when onError itself throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(badResponse(500));
    const onError = vi.fn().mockImplementation(() => {
      throw new Error('onError exploded');
    });
    const shipper = createLogShipper(makeConfig({ fetchImpl, onError }));
    shipper.enqueue(makeRecord());

    await expect(shipper.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(shipper.pending).toBe(1);
  });

  it('flush never throws or rejects even without an onError handler configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(badResponse(500));
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeRecord());

    await expect(shipper.flush()).resolves.toBeUndefined();
  });
});

describe('createLogShipper: oversized record normalization (ADR-241)', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CHUNK_BODY_CAP = 8192 - 64;

  it('splits an oversized record into N linked chunks at enqueue time, growing pending by N', () => {
    const shipper = createLogShipper(makeConfig({ fetchImpl: vi.fn() }));
    const hugeBody = 'x'.repeat(8193); // 1 char over the relay body cap -> 2 chunks

    shipper.enqueue(makeRecord({ body: { stringValue: hugeBody } }));

    expect(shipper.pending).toBe(2);
  });

  it('leaves a normal-sized record as a single queued item (no chunking)', () => {
    const shipper = createLogShipper(makeConfig({ fetchImpl: vi.fn() }));

    shipper.enqueue(makeRecord());

    expect(shipper.pending).toBe(1);
  });

  it('flushes every chunk of an oversized record in one POST, using the default crypto.randomUUID chunkIdFn', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    const hugeBody = 'x'.repeat(8193);
    shipper.enqueue(
      makeRecord({
        body: { stringValue: hugeBody },
        attributes: [{ key: 'correlationId', value: { stringValue: 'req-xyz' } }],
      }),
    );

    await shipper.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const records = payload.resourceLogs[0].scopeLogs[0].logRecords as OtelLogRecord[];
    expect(records).toHaveLength(2);

    // Slice sizes and full reconstruction.
    expect(records[0].body.stringValue).toHaveLength(CHUNK_BODY_CAP);
    expect(records[1].body.stringValue).toHaveLength(hugeBody.length - CHUNK_BODY_CAP);
    expect(records.map((r) => r.body.stringValue).join('')).toBe(hugeBody);

    // Shared chunk_id (real UUID, since enqueue never overrides chunkIdFn), 1-based seq, total chunks.
    const chunkId1 = records[0].attributes.find((a) => a.key === 'salir.chunk_id')?.value.stringValue;
    const chunkId2 = records[1].attributes.find((a) => a.key === 'salir.chunk_id')?.value.stringValue;
    expect(chunkId1).toMatch(UUID_RE);
    expect(chunkId1).toBe(chunkId2);
    expect(records[0].attributes.find((a) => a.key === 'salir.seq')?.value.intValue).toBe('1');
    expect(records[1].attributes.find((a) => a.key === 'salir.seq')?.value.intValue).toBe('2');
    expect(records[0].attributes.find((a) => a.key === 'salir.chunks')?.value.intValue).toBe('2');
    expect(records[1].attributes.find((a) => a.key === 'salir.chunks')?.value.intValue).toBe('2');

    // Chunk 1 keeps the full attribute set; chunk 2 keeps only correlationId (+ chunk markers).
    expect(records[0].attributes).toContainEqual({ key: 'correlationId', value: { stringValue: 'req-xyz' } });
    const chunk2NonMarkerKeys = records[1].attributes.filter((a) => !a.key.startsWith('salir.')).map((a) => a.key);
    expect(chunk2NonMarkerKeys).toEqual(['correlationId']);

    expect(shipper.pending).toBe(0);
  });
});

describe('createLogShipper: concurrent flush coalescing', () => {
  it('sequences concurrent flush() calls -- no interleaved double-send of the same records', async () => {
    let resolveFirst: (value: Response) => void = () => {};
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchImpl = vi.fn().mockReturnValueOnce(firstFetch).mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl, maxBatchRecords: 1 }));
    shipper.enqueue(makeRecord({ body: { stringValue: 'one' } }));

    const flush1 = shipper.flush();
    // Wait for flush1's request to actually go out before introducing 'two' --
    // this proves the SECOND flush() call is the one that ships it, not that
    // both records raced into a single send.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(shipper.pending).toBe(0); // 'one' already drained into the in-flight request

    shipper.enqueue(makeRecord({ body: { stringValue: 'two' } }));
    const flush2 = shipper.flush();
    // flush2 is chained behind flush1's still-unresolved request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirst(okResponse());
    await Promise.all([flush1, flush2]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(secondCallBody.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue).toBe('two');
    expect(shipper.pending).toBe(0);
  });

  it('returns a settled promise from every call once all chained flushes complete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const shipper = createLogShipper(makeConfig({ fetchImpl }));
    shipper.enqueue(makeRecord());

    const [r1, r2] = await Promise.all([shipper.flush(), shipper.flush()]);
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
  });
});
