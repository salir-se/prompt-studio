/**
 * A failed LLM request, carrying the HTTP status that caused it.
 *
 * Callers have to tell three very different failures apart: a credential the
 * provider rejected (401/403), one it throttled or found out of credit (429),
 * and everything else (a 5xx, a timeout, a transport error). The app's
 * secret-pool rotation feedback turns exactly that distinction into burn /
 * cooldown / do-nothing — see `agent-run-lifecycle.ts` and ADR-155's
 * `classifyPoolFailure`.
 *
 * Before this existed the only signal was the error's prose, so the app
 * matched the 401 sentence and nothing else: a pooled key that hit its rate
 * limit could not be told from a provider outage, and was never rotated away
 * from (ADR-232 closed the same gap on the MCP side, which had the status all
 * along).
 *
 * The `message` is unchanged from what each throw site produced before, so
 * every existing consumer that reads or matches it keeps working — this only
 * adds a field. `instanceof Error` still holds.
 */
export class LlmHttpError extends Error {
  /** HTTP status of the provider response that failed. */
  readonly status: number;

  /**
   * Parsed `Retry-After` delay in milliseconds, when the provider response carried
   * one that parsed to a usable value. A response can omit the header, or send one
   * this package's parser can't read (non-numeric, negative, not finite) — either
   * way that must not change the shape of this error, so it degrades to
   * `undefined` rather than surfacing as `null` or `NaN`.
   */
  readonly retryAfterMs?: number;

  /** Stable BFF error code, when this failure crossed a Salir HTTP boundary. */
  readonly code?: string;

  /** BFF request join key, safe to show and copy for support. */
  readonly correlationId?: string;

  /** The Salir Worker's plain-language cause, independent of the diagnostic prefix and references. */
  readonly providerMessage?: string;

  constructor(
    status: number,
    message: string,
    options?: ErrorOptions & {
      retryAfterMs?: number | null;
      code?: string;
      correlationId?: string;
      providerMessage?: string;
    },
  ) {
    super(message, options);
    this.name = 'LlmHttpError';
    this.status = status;
    const retryAfterMs = options?.retryAfterMs;
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      this.retryAfterMs = retryAfterMs;
    }
    if (options?.code) this.code = options.code;
    if (options?.correlationId) this.correlationId = options.correlationId;
    if (options?.providerMessage) this.providerMessage = options.providerMessage;
  }
}

/**
 * The HTTP status carried by `err`, or `undefined` when it carries none.
 *
 * Structural rather than an `instanceof` check on purpose: an error can cross
 * a bundle boundary, a worker `postMessage`, or a structured-clone round trip
 * and arrive as a plain object that still holds the field. A non-numeric or
 * out-of-range `status` is treated as absent rather than trusted.
 */
export function llmHttpStatus(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== 'number' || !Number.isInteger(status)) return undefined;
  return status >= 100 && status <= 599 ? status : undefined;
}

/**
 * The parsed `Retry-After` delay (in ms) carried by `err`, or `undefined` when it
 * carries none.
 *
 * Structural rather than an `instanceof` check on purpose: an error can cross
 * a bundle boundary, a worker `postMessage`, or a structured-clone round trip
 * and arrive as a plain object that still holds the field. A non-numeric,
 * negative, or non-finite `retryAfterMs` is treated as absent rather than trusted.
 */
export function llmRetryAfterMs(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const retryAfterMs = (err as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs)) return undefined;
  return retryAfterMs >= 0 ? retryAfterMs : undefined;
}
