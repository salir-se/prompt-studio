/**
 * Record-size normalization for OTLP log records (ADR-241).
 *
 * The BFF relay (`services/bff/src/routes/app-logs.ts`) hard-caps every
 * record it accepts: an 8192-char body, 2048-char string attribute values,
 * and 64 attributes per record. A UI log event can carry a body far past
 * that (a stack trace, a serialized state blob, ...), so shipping it
 * unmodified would just get it rejected at the relay -- and dropping the
 * content outright is not acceptable (UI logs can be huge). This module
 * never drops that content: an oversized record is instead split into
 * multiple smaller records linked by a shared `salir.chunk_id` attribute
 * plus per-chunk `salir.seq`/`salir.chunks` markers, so the original
 * message can be reassembled downstream from however many pieces it took.
 *
 * Pure, synchronous, and never throws -- `shipper.ts`'s `enqueue` depends on
 * this never being the reason a log gets dropped.
 */

import type { OtelKeyValue, OtelLogRecord } from './log-record';

/** Mirrors `services/bff/src/routes/app-logs.ts`'s `MAX_BODY_CHARS` relay cap. */
export const MAX_RECORD_BODY_CHARS = 8192;
/** Mirrors `services/bff/src/routes/app-logs.ts`'s `MAX_STRING_ATTR_CHARS` relay cap. */
export const MAX_ATTR_VALUE_CHARS = 2048;

/**
 * Mirrors `services/bff/src/routes/app-logs.ts`'s `MAX_ATTRIBUTES` relay cap.
 * Kept file-local -- like `log-record.ts`'s own copy of the same constant --
 * rather than imported, since the relay route lives in a different tier.
 */
const MAX_RECORD_ATTRIBUTES = 64;

/**
 * Headroom subtracted from `MAX_RECORD_BODY_CHARS` for each body slice, so a
 * chunked record's body still leaves room for its `salir.chunk_id`/`seq`/
 * `chunks` markers without the record creeping back up near the cap.
 */
const MAX_CHUNK_BODY_CHARS = MAX_RECORD_BODY_CHARS - 64;

export interface NormalizeOptions {
  /**
   * Id generator for the `salir.chunk_id` attribute shared by every chunk
   * produced from one oversized record. Called at most once per
   * `normalizeLogRecords` call. Defaults to `crypto.randomUUID()`; tests
   * inject a deterministic stub.
   */
  chunkIdFn?: () => string;
}

/**
 * Truncate any attribute `value.stringValue` over `MAX_ATTR_VALUE_CHARS` to
 * `MAX_ATTR_VALUE_CHARS - 1` chars plus an ellipsis. When one or more values
 * were truncated, appends a single `salir.truncated_values` marker
 * recording the count -- replacing the LAST attribute instead of exceeding
 * `MAX_RECORD_ATTRIBUTES` when the input is already at (or over) the cap.
 */
function normalizeAttributes(attributes: OtelKeyValue[]): OtelKeyValue[] {
  let truncatedCount = 0;
  const truncated = attributes.map((attr) => {
    const value = attr.value.stringValue;
    if (value === undefined || value.length <= MAX_ATTR_VALUE_CHARS) return attr;
    truncatedCount += 1;
    return { key: attr.key, value: { ...attr.value, stringValue: `${value.slice(0, MAX_ATTR_VALUE_CHARS - 1)}…` } };
  });

  if (truncatedCount === 0) return truncated;

  const marker: OtelKeyValue = { key: 'salir.truncated_values', value: { intValue: String(truncatedCount) } };
  return truncated.length < MAX_RECORD_ATTRIBUTES
    ? [...truncated, marker]
    : [...truncated.slice(0, MAX_RECORD_ATTRIBUTES - 1), marker];
}

/**
 * Keep at most `max` attributes, dropping from the FRONT when over the cap
 * -- callers append fixed trailing chunk markers that must never be the
 * ones dropped.
 */
function capAttributes(attributes: OtelKeyValue[], max: number): OtelKeyValue[] {
  return attributes.length <= max ? attributes : attributes.slice(attributes.length - max);
}

/**
 * Split `text` into consecutive slices of at most `maxChars` UTF-16 code
 * units, never splitting a surrogate pair: if a cut would land right after
 * a lone high surrogate, the boundary backs up by one unit so the pair
 * stays together in the next slice instead of the current one.
 */
function sliceByCodeUnit(text: string, maxChars: number): string[] {
  const slices: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1; // lone high surrogate at the cut -- defer the pair
    }
    if (end <= start) end = start + 1; // guards against a pathological maxChars < 2 (never hit at our fixed cap)
    slices.push(text.slice(start, end));
    start = end;
  }
  return slices;
}

function buildNormalizedRecords(record: OtelLogRecord, opts: NormalizeOptions): OtelLogRecord[] {
  const attributes = normalizeAttributes(record.attributes);
  const bodyText = record.body.stringValue;

  if (bodyText.length <= MAX_RECORD_BODY_CHARS) {
    return [{ ...record, body: { stringValue: bodyText }, attributes }];
  }

  const chunkIdFn = opts.chunkIdFn ?? (() => crypto.randomUUID());
  const slices = sliceByCodeUnit(bodyText, MAX_CHUNK_BODY_CHARS);
  const chunkId = chunkIdFn();
  const chunks = slices.length;
  const correlationAttr = attributes.find((attr) => attr.key === 'correlationId');

  return slices.map((slice, index) => {
    const seq = index + 1;
    const baseAttrs = seq === 1 ? attributes : correlationAttr ? [correlationAttr] : [];
    const chunkAttrs: OtelKeyValue[] = [
      ...baseAttrs,
      { key: 'salir.chunk_id', value: { stringValue: chunkId } },
      { key: 'salir.seq', value: { intValue: String(seq) } },
      { key: 'salir.chunks', value: { intValue: String(chunks) } },
    ];
    return { ...record, body: { stringValue: slice }, attributes: capAttributes(chunkAttrs, MAX_RECORD_ATTRIBUTES) };
  });
}

/**
 * Normalize one OTLP log record so it will always pass the BFF relay's
 * per-record caps: truncate oversized attribute values, and split an
 * oversized body into multiple linked records sharing `timeUnixNano`/
 * `severityNumber`/`severityText`/`traceId`. Returns `[record]` (modulo any
 * attribute truncation) when nothing needs splitting.
 *
 * Pure and never mutates `record`. Never throws: any unexpected shape falls
 * back to shipping the record as-is -- the same behavior as before this
 * normalization existed (CLAUDE.md safe-fallback).
 */
export function normalizeLogRecords(record: OtelLogRecord, opts: NormalizeOptions = {}): OtelLogRecord[] {
  try {
    return buildNormalizedRecords(record, opts);
  } catch {
    return [record];
  }
}
