/**
 * Batching, fail-open shipper for OTLP log records to Axiom's `/v1/logs`.
 *
 * Fail-open by construction: `enqueue` and `flush` never throw, a full queue
 * drops the oldest record rather than blocking the caller, and a batch that
 * fails twice is dropped (reported via `onError` and `droppedRecords`, never
 * via a logger — logging from inside the log shipper is a recursion hazard).
 * No timers live here; callers own scheduling (interval, page-hide, etc.).
 */

import { AXIOM_INGEST_BASE_URL } from './dataset';
import type { OtelLogRecord, OtelResource } from './log-record';
import { buildExportPayload } from './log-record';
import { normalizeLogRecords } from './normalize';

export interface LogShipperConfig {
  baseUrl?: string;
  token: string;
  dataset: string;
  resource: OtelResource;
  maxBatchRecords?: number;
  maxBatchBytes?: number;
  maxQueueRecords?: number;
  fetchImpl?: typeof fetch;
  onError?: (error: unknown) => void;
}

export interface LogShipper {
  enqueue(record: OtelLogRecord): void;
  flush(): Promise<void>;
  readonly pending: number;
  readonly droppedRecords: number;
}

// Region-pinned datasets: ingest MUST hit the edge domain (see dataset.ts).
const DEFAULT_BASE_URL = AXIOM_INGEST_BASE_URL;
const DEFAULT_MAX_BATCH_RECORDS = 100;
const DEFAULT_MAX_BATCH_BYTES = 60_000;
const DEFAULT_MAX_QUEUE_RECORDS = 1_000;

interface QueuedRecord {
  record: OtelLogRecord;
  /** Set once a batch containing this record has already failed and been requeued. */
  retriedOnce: boolean;
}

function safeOnError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    onError?.(error);
  } catch {
    // onError must never break the shipper's fail-open guarantee.
  }
}

export function createLogShipper(config: LogShipperConfig): LogShipper {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const maxBatchRecords = config.maxBatchRecords ?? DEFAULT_MAX_BATCH_RECORDS;
  const maxBatchBytes = config.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
  const maxQueueRecords = config.maxQueueRecords ?? DEFAULT_MAX_QUEUE_RECORDS;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  const queue: QueuedRecord[] = [];
  // Cumulative, monotonic, public-facing counter — never decremented.
  let droppedRecordsTotal = 0;
  // Portion of the total not yet surfaced via a `salir.dropped_records` attribute.
  let unreportedDropped = 0;
  let inFlight: Promise<void> | null = null;

  function enqueue(record: OtelLogRecord): void {
    try {
      // Oversized records (ADR-241: normalize.ts) become 1+ linked records
      // before ever touching the queue -- each is then subject to the same
      // drop-oldest cap individually, just like any other queued record.
      for (const normalized of normalizeLogRecords(record)) {
        if (queue.length >= maxQueueRecords) {
          queue.shift(); // drop the OLDEST queued record to make room
          droppedRecordsTotal += 1;
          unreportedDropped += 1;
        }
        queue.push({ record: normalized, retriedOnce: false });
      }
    } catch (error) {
      safeOnError(config.onError, error);
    }
  }

  /** Tag the first record of the next batch with any unreported drop count. */
  function tagPendingDrops(): void {
    if (unreportedDropped <= 0 || queue.length === 0) return;
    const head = queue[0];
    queue[0] = {
      ...head,
      record: {
        ...head.record,
        attributes: [
          ...head.record.attributes,
          { key: 'salir.dropped_records', value: { intValue: String(unreportedDropped) } },
        ],
      },
    };
    unreportedDropped = 0;
  }

  /** Drain the whole queue into batches respecting maxBatchRecords/maxBatchBytes. */
  function drainBatches(): QueuedRecord[][] {
    tagPendingDrops();

    const batches: QueuedRecord[][] = [];
    let current: QueuedRecord[] = [];
    let currentBytes = 0;

    while (queue.length > 0) {
      const item = queue[0];
      // Size is the sum of each record's own JSON length, not the full
      // enveloped POST body — a documented approximation that keeps batching
      // O(n) instead of re-stringifying a growing envelope per record.
      const size = JSON.stringify(item.record).length;
      const wouldOverflow =
        current.length > 0 && (current.length >= maxBatchRecords || currentBytes + size > maxBatchBytes);
      if (wouldOverflow) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      // current is empty here at minimum, so an oversized record still ships alone.
      current.push(item);
      currentBytes += size;
      queue.shift();
      if (current.length >= maxBatchRecords) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  function handleBatchFailure(batch: QueuedRecord[], error: unknown): void {
    const toRetry: QueuedRecord[] = [];
    let droppedNow = 0;
    for (const item of batch) {
      if (item.retriedOnce) {
        droppedNow += 1;
      } else {
        toRetry.push({ ...item, retriedOnce: true });
      }
    }
    if (toRetry.length > 0) {
      queue.unshift(...toRetry);
    }
    if (droppedNow > 0) {
      droppedRecordsTotal += droppedNow;
      unreportedDropped += droppedNow;
    }
    safeOnError(config.onError, error);
  }

  async function sendBatch(batch: QueuedRecord[]): Promise<void> {
    try {
      const records = batch.map((item) => item.record);
      const payload = buildExportPayload(config.resource, records);
      const body = JSON.stringify(payload);

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/logs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'X-Axiom-Dataset': config.dataset,
            'Content-Type': 'application/json',
          },
          body,
        });
      } catch (error) {
        handleBatchFailure(batch, error);
        return;
      }

      if (!response.ok) {
        handleBatchFailure(batch, new Error(`Axiom log export failed: HTTP ${response.status}`));
      }
    } catch (error) {
      handleBatchFailure(batch, error);
    }
  }

  async function runFlush(): Promise<void> {
    let batches: QueuedRecord[][];
    try {
      batches = drainBatches();
    } catch (error) {
      safeOnError(config.onError, error);
      return;
    }
    for (const batch of batches) {
      await sendBatch(batch);
    }
  }

  /**
   * Coalescing flush: every call appends to the tail of the current chain,
   * so concurrent callers never run drainBatches()/sendBatch() interleaved —
   * a later call simply awaits the earlier one, then drains whatever is left.
   */
  function flush(): Promise<void> {
    const previous = inFlight ?? Promise.resolve();
    const next = previous
      .then(() => runFlush())
      .finally(() => {
        if (inFlight === next) inFlight = null;
      });
    inFlight = next;
    return next;
  }

  return {
    enqueue,
    flush,
    get pending() {
      return queue.length;
    },
    get droppedRecords() {
      return droppedRecordsTotal;
    },
  };
}
