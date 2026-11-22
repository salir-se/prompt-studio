/**
 * OTLP/JSON span model + batching, fail-open span shipper (ADR-254 Phase 2/3:
 * docs/adr/ADR-254-distributed-tracing-and-otlp-primary.md).
 *
 * Hand-rolled minimal OTLP, same posture as `./log-record.ts` and
 * `./shipper.ts` -- no OTel SDK dependency (ADR-114/ADR-241's standing
 * zero-new-deps commitment). This module mirrors `shipper.ts`'s architecture
 * and fail-open contract on purpose: `enqueue` never throws (a malformed
 * span is dropped and reported via `onError` instead), `flush` never
 * rejects (a failed batch is dropped and reported via `onError` -- there is
 * no `droppedRecords` counter here, unlike the log shipper, because the
 * public contract below intentionally keeps this first cut minimal; see
 * `SpanShipper`), and no timers live here -- callers own scheduling.
 *
 * Runtime consumers:
 *  - `packages/worker-http` request middleware emits one SERVER span.
 *  - `packages/worker-http/src/fetch.ts` emits one CLIENT span per logical
 *    `boundedFetch` call, child of the ambient request span.
 *
 * `./tracing.ts`'s internal `createTracer()` remains a no-op until a runtime
 * caller needs INTERNAL spans.
 */

import type { OtelKeyValue, OtelResource } from './log-record';
import { toOtelAttributes } from './log-record';
import { MAX_ATTR_VALUE_CHARS } from './normalize';

/** OTLP span kind enum, restricted to the values this package emits. */
export const SPAN_KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3 } as const;

/** OTLP span status code enum. */
export const SPAN_STATUS = { UNSET: 0, OK: 1, ERROR: 2 } as const;

/** OTLP/JSON span, minimal subset Axiom's `/v1/traces` ingest accepts. */
export interface OtelSpan {
  /** 32 lowercase hex chars. */
  traceId: string;
  /** 16 lowercase hex chars. */
  spanId: string;
  /** 16 lowercase hex chars, absent for root spans. */
  parentSpanId?: string;
  name: string;
  /** One of `SPAN_KIND`'s values. */
  kind: number;
  /** Decimal string nanoseconds since epoch, per OTLP JSON's uint64 encoding. */
  startTimeUnixNano: string;
  /** Decimal string nanoseconds since epoch, per OTLP JSON's uint64 encoding. */
  endTimeUnixNano: string;
  attributes: OtelKeyValue[];
  /** One of `SPAN_STATUS`'s values. */
  status: { code: number; message?: string };
}

export interface SpanShipperConfig {
  /**
   * Ingest edge host, e.g. `AXIOM_INGEST_BASE_URL` from `./dataset.ts`.
   * Deliberately REQUIRED (unlike `LogShipperConfig.baseUrl`): the caller
   * (worker-http's next wave) always has the region-pinned host in hand
   * already, so this module carries no default of its own to keep in sync.
   */
  baseUrl: string;
  token: string;
  dataset: string;
  resource: OtelResource;
  fetchImpl?: typeof fetch;
  onError?: (err: unknown) => void;
  /** Max spans per POST; a bigger queue splits into multiple sequential POSTs. */
  maxBatch?: number;
}

export interface SpanShipper {
  enqueue(span: OtelSpan): void;
  /** Never rejects (fail-open). */
  flush(): Promise<void>;
  readonly pending: number;
}

// Matches `shipper.ts`'s DEFAULT_MAX_BATCH_RECORDS.
const DEFAULT_MAX_BATCH = 100;

// Mirrors trace-context.ts's HEX32_RE/HEX16_RE (unexported there, and that
// module is meant to be a leaf the otel/ module depends on, not the reverse
// -- see trace-context.ts's own header comment on that direction). Kept
// local rather than imported to avoid inverting the dependency.
const HEX32_RE = /^[0-9a-f]{32}$/;
const HEX16_RE = /^[0-9a-f]{16}$/;

/** Mirrors `shipper.ts`'s private `safeOnError` -- not exported there. */
function safeOnError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    onError?.(error);
  } catch {
    // onError must never break the shipper's fail-open guarantee.
  }
}

/**
 * Structural validation for a span about to be queued. Deliberately minimal
 * (id shapes + a non-empty name) -- enough to catch a caller bug (a
 * malformed id, an empty name) without re-validating everything `buildSpan`
 * already guarantees for its own callers.
 */
function assertValidSpan(span: OtelSpan): void {
  if (!HEX32_RE.test(span.traceId)) {
    throw new Error(`Invalid OtelSpan: traceId must be 32 lowercase hex chars, got "${span.traceId}"`);
  }
  if (!HEX16_RE.test(span.spanId)) {
    throw new Error(`Invalid OtelSpan: spanId must be 16 lowercase hex chars, got "${span.spanId}"`);
  }
  if (span.parentSpanId !== undefined && !HEX16_RE.test(span.parentSpanId)) {
    throw new Error(`Invalid OtelSpan: parentSpanId must be 16 lowercase hex chars, got "${span.parentSpanId}"`);
  }
  if (span.name.length === 0) {
    throw new Error('Invalid OtelSpan: name must be non-empty');
  }
}

/** Wrap a resource + spans into the OTLP ExportTraceServiceRequest envelope. */
export function buildTraceExportPayload(resource: OtelResource, spans: OtelSpan[]): unknown {
  return {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: '@prompt-studio/observability' },
            spans,
          },
        ],
      },
    ],
  };
}

/**
 * ms -> decimal-string nanoseconds. BigInt avoids the float precision loss a
 * plain `ms * 1e6` risks once `ms` grows large -- cheap insurance, and it
 * removes the caveat entirely rather than bounding it.
 */
function msToNanoString(ms: number): string {
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

/**
 * Cap `name` at `MAX_ATTR_VALUE_CHARS`, mirroring `normalize.ts`'s
 * `normalizeAttributes` truncation shape (slice + trailing ellipsis) rather
 * than importing it -- that helper is private to `normalize.ts` and scoped
 * to `OtelKeyValue.value.stringValue`, not a bare span name.
 */
function capName(name: string): string {
  if (name.length <= MAX_ATTR_VALUE_CHARS) return name;
  return `${name.slice(0, MAX_ATTR_VALUE_CHARS - 1)}…`;
}

/**
 * Build an `OtelSpan` from caller-supplied millisecond timestamps and a
 * plain attributes record. No `Date.now()` inside -- times always come from
 * the caller, both for testability and because a Workers isolate's clock can
 * be frozen/reused across requests (see `shipper.ts`'s neighboring modules
 * for the same caveat applied to log records).
 *
 * Attributes reuse `toOtelAttributes` verbatim (masking, dot-flattening, and
 * the `MAX_ATTRIBUTES` cap + `salir.truncated_attributes` marker `log-record
 * .ts` already implements) rather than re-deriving that discipline here.
 */
export function buildSpan(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeMs: number;
  endTimeMs: number;
  attributes?: Record<string, unknown>;
  status?: { code: number; message?: string };
}): OtelSpan {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    ...(input.parentSpanId !== undefined ? { parentSpanId: input.parentSpanId } : {}),
    name: capName(input.name),
    kind: input.kind,
    startTimeUnixNano: msToNanoString(input.startTimeMs),
    endTimeUnixNano: msToNanoString(input.endTimeMs),
    attributes: toOtelAttributes(input.attributes ?? {}),
    status: input.status ?? { code: SPAN_STATUS.UNSET },
  };
}

export function createSpanShipper(config: SpanShipperConfig): SpanShipper {
  const maxBatch = config.maxBatch ?? DEFAULT_MAX_BATCH;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  const queue: OtelSpan[] = [];
  let inFlight: Promise<void> | null = null;

  function enqueue(span: OtelSpan): void {
    try {
      assertValidSpan(span);
      queue.push(span);
    } catch (error) {
      safeOnError(config.onError, error);
    }
  }

  /**
   * Drain the whole queue into batches of at most `maxBatch` spans each --
   * no auto-flush trigger on enqueue, matching `shipper.ts`'s
   * `drainBatches`: `maxBatch`/`maxBatchRecords` only shape how many spans
   * land in one POST once `flush()` is explicitly called.
   */
  function drainBatches(): OtelSpan[][] {
    const batches: OtelSpan[][] = [];
    while (queue.length > 0) {
      batches.push(queue.splice(0, maxBatch));
    }
    return batches;
  }

  async function sendBatch(batch: OtelSpan[]): Promise<void> {
    try {
      const payload = buildTraceExportPayload(config.resource, batch);
      const body = JSON.stringify(payload);

      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl}/v1/traces`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'X-Axiom-Dataset': config.dataset,
            'Content-Type': 'application/json',
          },
          body,
        });
      } catch (error) {
        // Network error: batch is dropped (never requeued -- see the module
        // header comment on why this shipper has no droppedRecords counter).
        safeOnError(config.onError, error);
        return;
      }

      if (!response.ok) {
        safeOnError(config.onError, new Error(`Axiom trace export failed: HTTP ${response.status}`));
      }
    } catch (error) {
      safeOnError(config.onError, error);
    }
  }

  async function runFlush(): Promise<void> {
    let batches: OtelSpan[][];
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
   * so concurrent callers never run drainBatches()/sendBatch() interleaved --
   * mirrors `shipper.ts`'s `flush` verbatim.
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
  };
}
