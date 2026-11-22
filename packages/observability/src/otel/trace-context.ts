/**
 * W3C Trace Context (`traceparent`, version `00`) parse/build/derive — the
 * pure contract ADR-254's distributed-tracing waves build on
 * (docs/adr/ADR-254-distributed-tracing-and-otlp-primary.md).
 *
 * Consumers, once their own waves land:
 *  - `packages/worker-http/src/fetch.ts` (`boundedFetch`) — builds and injects
 *    the outbound `traceparent` header on every call (Phase 1).
 *  - `packages/worker-http` inbound middleware — parses an inbound
 *    `traceparent` to continue (not restart) a trace across a worker hop.
 *  - Hand-rolled span emission (Phase 2/3, this package's `otel/` module) —
 *    mints span ids and stamps `trace_id`/`parent_span_id` on emitted spans.
 *  - `packages/observability/src/otel/log-record.ts` — a later wave rewires
 *    `toOtelLogRecord`'s UUID-branch trace-id derivation to call
 *    `traceIdFromCorrelationId` here instead of its own local regex, and
 *    picks up the non-UUID fallback (a fresh random id) it lacks today.
 *
 * Pure: no I/O, no ambient state, no imports beyond the Web Crypto global
 * (`crypto.getRandomValues`, already relied on ambiently elsewhere in this
 * package — see `otel/normalize.ts`'s `crypto.randomUUID()` default).
 */

/** The only version this module accepts. See `parseTraceparent`'s doc comment
 *  for why higher versions are rejected rather than leniently parsed. */
const TRACEPARENT_VERSION = '00';

/**
 * Case-insensitive UUID match; output is always normalized to lowercase.
 * Deliberately LOCAL to this module rather than imported from
 * `./log-record`'s `CORRELATION_ID_UUID_RE`: `log-record.ts` becomes a
 * CONSUMER of this module in a later wave, and importing the other direction
 * would invert that dependency. Semantics are kept identical to the existing
 * regex so a correlationId that derives a traceId today derives the exact
 * same bytes once log-record.ts is rewired to call `traceIdFromCorrelationId`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEX32_RE = /^[0-9a-f]{32}$/;
const HEX16_RE = /^[0-9a-f]{16}$/;
const FLAGS_RE = /^[0-9a-f]{2}$/;
const ALL_ZERO_TRACE_ID = '0'.repeat(32);
const ALL_ZERO_SPAN_ID = '0'.repeat(16);

/** Parsed W3C traceparent (version 00). */
export interface TraceContext {
  /** 32 lowercase hex chars, not all-zero. */
  traceId: string;
  /** 16 lowercase hex chars, not all-zero; the active span represented by this context. */
  spanId: string;
  /** Calling span for this hop; present only when continuing an inbound traceparent. */
  parentSpanId?: string;
  /** trace-flags bit 0. */
  sampled: boolean;
}

/** The W3C header name, exported so call sites never typo it. */
export const TRACEPARENT_HEADER = 'traceparent';

/**
 * Parse a `traceparent` header per the W3C Trace Context spec, version `00`
 * only.
 *
 * The spec permits a lenient-forward mode where a receiver MAY accept a
 * higher version by parsing only the first four dash-separated fields and
 * ignoring the rest. We deliberately do NOT implement that: this module
 * pins to `00` and returns `null` for any other version, including a
 * well-formed higher-version header. Consequence: if a future `traceparent`
 * spec revision ever reaches this fleet from an upstream caller, this parser
 * treats it as absent (no propagated trace) rather than best-effort
 * salvaging its first four fields — the same fail-closed posture as any
 * other malformed input. KISS over spec-maximal leniency; revisit only if a
 * real upstream sends a higher version, which nothing in this fleet does
 * today (ADR-254 pins version 00 throughout).
 *
 * Returns `null` for: wrong field count (not exactly 4), unsupported
 * version, wrong trace/span id length, non-lowercase-hex trace/span id or
 * flags, an all-zero trace id, an all-zero span id, or a malformed flags
 * field. Surrounding whitespace is trimmed before validation — browsers
 * send clean header values, but an intermediate proxy can pad a header with
 * whitespace, and trimming is harmless since the trimmed content must still
 * pass every other check.
 */
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  if (header === null || header === undefined) return null;

  const trimmed = header.trim();
  if (trimmed === '') return null;

  const fields = trimmed.split('-');
  if (fields.length !== 4) return null;

  const [version, traceId, spanId, flags] = fields;
  if (version !== TRACEPARENT_VERSION) return null;
  if (!HEX32_RE.test(traceId) || traceId === ALL_ZERO_TRACE_ID) return null;
  if (!HEX16_RE.test(spanId) || spanId === ALL_ZERO_SPAN_ID) return null;
  if (!FLAGS_RE.test(flags)) return null;

  const sampled = (Number.parseInt(flags, 16) & 0x01) === 1;
  return { traceId, spanId, sampled };
}

/** Render a traceparent header: `00-<traceId>-<spanId>-<01|00>`. */
export function buildTraceparent(ctx: TraceContext): string {
  return `${TRACEPARENT_VERSION}-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;
}

/** `byteLength` cryptographically random bytes, rendered as lowercase hex. */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Same as `randomHex`, retried on the astronomically unlikely all-zero draw. */
function randomNonZeroHex(byteLength: number): string {
  let hex = randomHex(byteLength);
  while (/^0+$/.test(hex)) hex = randomHex(byteLength);
  return hex;
}

/** 16 random lowercase hex chars, never all-zero. Uses `crypto.getRandomValues`. */
export function generateSpanId(): string {
  return randomNonZeroHex(8);
}

/** 32 random lowercase hex chars, never all-zero. Uses `crypto.getRandomValues`. */
export function generateTraceId(): string {
  return randomNonZeroHex(16);
}

/**
 * ADR-254 Decision (Phase 2): a UUID-shaped `correlationId` derives a
 * traceId by stripping dashes and lowercasing (32 hex chars) — identical
 * bytes whether the id reaches Axiom as a log attribute or a span's
 * `trace_id`. Anything else, including `undefined`, mints a fresh random
 * trace id instead of leaving the field absent (the gap this generalizes
 * away from `toOtelLogRecord`'s current UUID-only branch).
 */
export function traceIdFromCorrelationId(correlationId: string | undefined): string {
  if (correlationId !== undefined && UUID_RE.test(correlationId)) {
    return correlationId.replace(/-/g, '').toLowerCase();
  }
  return generateTraceId();
}
