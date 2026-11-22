/**
 * OTLP/JSON log-record model + pure mapping from pino browser log events.
 *
 * Types mirror the OpenTelemetry Protocol (OTLP) JSON encoding for
 * `ExportLogsServiceRequest` closely enough to satisfy Axiom's `/v1/logs`
 * ingest endpoint, without pulling in the OTel SDK (ADR-114: hand-rolled,
 * zero new dependencies).
 */

import { maskSensitiveData } from '../masking';
import type { TraceContext } from './trace-context';

/** OTLP `AnyValue` restricted to the scalar variants this package emits. */
export interface OtelAttributeValue {
  stringValue?: string;
  boolValue?: boolean;
  /** Decimal string, per OTLP JSON's int64 encoding. */
  intValue?: string;
  doubleValue?: number;
}

export interface OtelKeyValue {
  key: string;
  value: OtelAttributeValue;
}

export interface OtelResource {
  attributes: OtelKeyValue[];
}

export interface OtelLogRecord {
  /** Decimal string nanoseconds since epoch, per OTLP JSON's uint64 encoding. */
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtelKeyValue[];
  /**
   * 32 lowercase hex chars. Set either from an explicit `traceContext` passed
   * to `toOtelLogRecord` (ADR-254) or, absent that, derived from a UUID
   * correlationId found in the event's fields.
   */
  traceId?: string;
  /**
   * 16 lowercase hex chars. Only ever set alongside `traceId` when an explicit
   * `traceContext` was passed to `toOtelLogRecord` -- the UUID-correlationId
   * fallback has no span concept and never sets this. Axiom materializes this
   * as the `span_id` column, joining the log to its owning span.
   */
  spanId?: string;
}

/** Shape of a pino browser `transmit`/`log` event, as this package consumes it. */
export interface PinoBrowserLogEvent {
  ts: number;
  messages: unknown[];
  bindings: Record<string, unknown>[];
  level: { label: string; value: number };
}

const MAX_ATTRIBUTES = 64;
/** Dot-notation nesting levels flattened before deeper values are JSON.stringify'd. */
const MAX_DEPTH = 3;

const CORRELATION_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEVERITY_BY_LEVEL: Record<string, { severityNumber: number; severityText: string }> = {
  trace: { severityNumber: 1, severityText: 'TRACE' },
  debug: { severityNumber: 5, severityText: 'DEBUG' },
  info: { severityNumber: 9, severityText: 'INFO' },
  warn: { severityNumber: 13, severityText: 'WARN' },
  error: { severityNumber: 17, severityText: 'ERROR' },
  fatal: { severityNumber: 21, severityText: 'FATAL' },
};
const DEFAULT_SEVERITY = SEVERITY_BY_LEVEL.info;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** JSON.stringify that never throws and collapses cycles instead of crashing. */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return '"[Unserializable]"';
  }
}

/**
 * Depth-first flatten of a fields record into `[dotted.key, leafValue]` pairs.
 * Plain objects are decomposed up to MAX_DEPTH levels; arrays and anything
 * beyond that depth are left as-is for `toAttributeValue` to stringify.
 * `seen` guards the recursion itself against reference cycles.
 */
function flattenEntry(
  key: string,
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  out: Array<[string, unknown]>,
): void {
  if (value === null || value === undefined) return;

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      out.push([key, '[Circular]']);
      return;
    }
    if (depth >= MAX_DEPTH) {
      out.push([key, safeJsonStringify(value)]);
      return;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) {
      out.push([key, '{}']);
      return;
    }
    seen.add(value);
    for (const [childKey, childValue] of entries) {
      flattenEntry(`${key}.${childKey}`, childValue, depth + 1, seen, out);
    }
    seen.delete(value);
    return;
  }

  out.push([key, value]);
}

function toAttributeValue(value: unknown): OtelAttributeValue {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return { intValue: String(value) };
    if (Number.isFinite(value)) return { doubleValue: value };
    return { stringValue: String(value) };
  }
  if (Array.isArray(value)) return { stringValue: safeJsonStringify(value) };
  return { stringValue: String(value) };
}

/**
 * Mask, flatten, and convert a fields record into OTLP attributes.
 * Masking runs FIRST so nothing sensitive survives into the flattened,
 * capped attribute list. Capped at MAX_ATTRIBUTES; a
 * `salir.truncated_attributes` marker is appended (not counted against the
 * cap) reporting how many attributes were dropped.
 */
export function toOtelAttributes(fields: Record<string, unknown>): OtelKeyValue[] {
  const masked = maskSensitiveData(fields);
  const flat: Array<[string, unknown]> = [];
  const seen = new WeakSet<object>();
  for (const [key, value] of Object.entries(masked)) {
    flattenEntry(key, value, 1, seen, flat);
  }

  const droppedCount = Math.max(0, flat.length - MAX_ATTRIBUTES);
  const kept = droppedCount > 0 ? flat.slice(0, MAX_ATTRIBUTES) : flat;
  const attributes: OtelKeyValue[] = kept.map(([key, value]) => ({ key, value: toAttributeValue(value) }));
  if (droppedCount > 0) {
    attributes.push({ key: 'salir.truncated_attributes', value: { intValue: String(droppedCount) } });
  }
  return attributes;
}

/**
 * Map a pino browser log event to an OTLP log record.
 *
 * Fields come from merging every `bindings` entry then every plain-object
 * `messages` entry (later wins); remaining non-object `messages` entries join
 * with a space to become the body. A `msg` field is always dropped from the
 * attributes — the body already carries it, and OTLP has no use for the
 * duplicate.
 *
 * `traceContext` (ADR-254, optional) is the request's ambient W3C trace
 * context, e.g. `currentTraceContext()` from `@prompt-studio/worker-http`'s ALS. When
 * given, it takes PRECEDENCE over the UUID-correlationId derivation below and
 * also stamps `spanId` (which that derivation never produces) — a real,
 * request-scoped trace hop beats a value re-derived from an id whose primary
 * job is being the operator-facing correlationId attribute. `traceContext` is
 * trusted verbatim: it comes from the frozen `trace-context.ts` module, which
 * already validates its hex shape at parse/generate time, so this function
 * does not re-validate it.
 *
 * Absent `traceContext` (the SPA path, and any worker call site outside a
 * request frame), behaviour is unchanged from before ADR-254: a UUID-shaped
 * `correlationId` found in the merged fields derives `traceId` by stripping
 * dashes and lowercasing, with no `spanId` (there is no span to attach). This
 * deliberately does NOT call `trace-context.ts`'s `traceIdFromCorrelationId`
 * — that helper falls back to a fresh RANDOM trace id for any non-UUID input
 * (its contract for continuing a hand-rolled span's trace when no upstream
 * `traceparent` exists), whereas this function's existing contract is "absent
 * traceId when there's nothing to derive one from". Stamping every SPA log
 * line — which never carries a traceContext — with an unrelated random id
 * would manufacture a false-looking trace join in Axiom, not a real one. So
 * the local regex branch (identical semantics to `trace-context.ts`'s own
 * `UUID_RE`, see that module's comment) is kept rather than switched to the
 * shared helper.
 */
export function toOtelLogRecord(
  event: PinoBrowserLogEvent,
  traceContext?: Pick<TraceContext, 'traceId' | 'spanId'>,
): OtelLogRecord {
  const fields: Record<string, unknown> = {};
  for (const binding of event.bindings) {
    Object.assign(fields, binding);
  }

  const messageParts: string[] = [];
  for (const message of event.messages) {
    if (isPlainObject(message)) {
      Object.assign(fields, message);
    } else if (message !== undefined) {
      messageParts.push(typeof message === 'string' ? message : String(message));
    }
  }
  delete fields.msg;

  const correlationId = fields.correlationId;
  const derivedTraceId =
    typeof correlationId === 'string' && CORRELATION_ID_UUID_RE.test(correlationId)
      ? correlationId.replace(/-/g, '').toLowerCase()
      : undefined;
  const traceId = traceContext?.traceId ?? derivedTraceId;
  const spanId = traceContext?.spanId;

  const severity = SEVERITY_BY_LEVEL[event.level?.label] ?? DEFAULT_SEVERITY;

  return {
    // ts is epoch milliseconds (integer); string-concat avoids float artifacts
    // that `ts * 1e6` would introduce for values beyond Number's exact range.
    timeUnixNano: `${event.ts}000000`,
    severityNumber: severity.severityNumber,
    severityText: severity.severityText,
    body: { stringValue: messageParts.join(' ') },
    attributes: toOtelAttributes(fields),
    ...(traceId ? { traceId } : {}),
    ...(spanId ? { spanId } : {}),
  };
}

/** Build an OTLP resource from a flat string attribute map. */
export function buildResource(attrs: Record<string, string>): OtelResource {
  return {
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: { stringValue: value } })),
  };
}

/** Wrap a resource + records into the OTLP ExportLogsServiceRequest envelope. */
export function buildExportPayload(resource: OtelResource, records: OtelLogRecord[]): unknown {
  return {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: { name: '@prompt-studio/observability' },
            logRecords: records,
          },
        ],
      },
    ],
  };
}
