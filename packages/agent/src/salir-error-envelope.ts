/**
 * The error envelope a Salir Worker answers with (`apiError` in `@prompt-studio/worker-http`):
 * `{ ok: false, error, details: { code, message, correlationId, service?, detail? } }`.
 *
 * The Hosted LLM provider talks to a Salir Worker (`services/ai`), not to a vendor, so its failures arrive in this
 * shape rather than OpenAI's `{ error: { message, type } }`. Reading it lets a run say what went wrong in the
 * Worker's own words, and lets the transient retry honour what the Worker knows about retrying (ADR-280, 2026-10-20).
 */

export interface SalirErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The envelope in a response body, or `null` when the body is not one (a vendor body, HTML, empty). */
export function parseSalirErrorEnvelope(body: string): SalirErrorEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const root = record(parsed);
  const details = record(root?.details);
  if (root?.ok !== false || typeof details?.code !== 'string' || typeof details.message !== 'string') return null;
  const detail = record(details.detail);
  return {
    code: details.code,
    message: details.message,
    ...(typeof details.correlationId === 'string' ? { correlationId: details.correlationId } : {}),
    ...(detail ? { detail } : {}),
  };
}

/** `<message> (<code>, correlationId=<id>)`: the cause first, then what support needs to find the call. */
export function describeSalirErrorEnvelope(envelope: SalirErrorEnvelope): string {
  const refs = [envelope.code, ...(envelope.correlationId ? [`correlationId=${envelope.correlationId}`] : [])];
  return `${envelope.message} (${refs.join(', ')})`;
}

/** The Hosted LLM Worker's codes for a Workers AI failure (`services/ai/src/upstream-failure.ts`). */
export const HOSTED_UPSTREAM_CODES: ReadonlySet<string> = new Set([
  'upstream_timeout',
  'upstream_capacity',
  'upstream_memory',
  'upstream_error',
]);

export type HostedUpstreamCode = 'upstream_timeout' | 'upstream_capacity' | 'upstream_memory' | 'upstream_error';

/** A Hosted upstream failure as a run's error text carries it (`describeSalirErrorEnvelope`). */
export interface HostedUpstreamFailureText {
  readonly code: HostedUpstreamCode;
  /** The Worker's plain-language cause, the text between the provider prefix and the code. */
  readonly cause: string;
  readonly correlationId?: string;
}

const HOSTED_UPSTREAM_TEXT =
  /(?:^|— )([^—]*?) \((upstream_(?:timeout|capacity|memory|error))(?:, correlationId=([^)\s]+))?\)\s*$/;

/**
 * The Hosted upstream failure a run's error text names, or `null`. A run's error is a string by the time it reaches
 * the scheduler and the Logs view on older stored logs, so the compatibility fallback reads back the text
 * `describeSalirErrorEnvelope` wrote: `Hosted LLM API error: 504 — <cause> (upstream_timeout, correlationId=<id>)`.
 */
export function hostedUpstreamFailureFromText(text: string | undefined): HostedUpstreamFailureText | null {
  const match = text ? HOSTED_UPSTREAM_TEXT.exec(text) : null;
  if (!match) return null;
  return {
    code: match[2] as HostedUpstreamCode,
    cause: match[1].trim(),
    ...(match[3] ? { correlationId: match[3] } : {}),
  };
}

/** Expand-only fields on run results and stored logs; the Worker's reference differs from the run's own anchor. */
export interface HostedErrorMetadata {
  errorCode?: string;
  errorCorrelationId?: string;
  errorMessage?: string;
}

/** Structured metadata is authoritative; only older workers and stored logs need the text fallback. */
export function hostedUpstreamFailure(
  text: string | undefined,
  metadata?: HostedErrorMetadata,
): HostedUpstreamFailureText | null {
  if (metadata?.errorCode === undefined) return hostedUpstreamFailureFromText(text);
  if (!HOSTED_UPSTREAM_CODES.has(metadata.errorCode)) return null;
  return {
    code: metadata.errorCode as HostedUpstreamCode,
    cause: metadata.errorMessage ?? text ?? '',
    ...(metadata.errorCorrelationId ? { correlationId: metadata.errorCorrelationId } : {}),
  };
}

/**
 * Whether another attempt within the same model turn cannot help. A Workers AI timeout gets the same budget against
 * the same slow model on the next attempt, as our own request timer does (`isLlmTimeout`); a failure the Worker marks
 * `retryable: false` (no capacity, out of memory) fails the same way seconds later. Either ends the turn at once, and
 * the run reports it; a later run may succeed.
 */
export function isFinalForTurn(body: string): boolean {
  const envelope = parseSalirErrorEnvelope(body);
  if (!envelope || !HOSTED_UPSTREAM_CODES.has(envelope.code)) return false;
  return envelope.code === 'upstream_timeout' || envelope.detail?.retryable === false;
}
