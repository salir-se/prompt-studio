/**
 * Retry for transient LLM transport failures, applied where the fetch happens.
 *
 * WHY THIS EXISTS. `runner.ts` grew two dispatch paths. The legacy one calls
 * `callWithRetry(..., 3, 1000, ...)`; the registered-provider one calls
 * `provider.chat(...)` bare. Every provider added since the provider
 * abstraction landed therefore had no retry at all, and a single dropped
 * socket ended a whole agent run. A paced 41-scenario harness run lost 24% of
 * its scenarios to exactly that — misread at first as provider rate limiting.
 *
 * WHY AT THE PROVIDER, NOT THE CALL SITE. Wrapping `runner.ts` would leave
 * Critic Inbound, the evaluation harness, and anything built directly on
 * `createProvider` unprotected, and would let the next provider added
 * reintroduce the gap. Retrying around the fetch covers every consumer.
 *
 * SAFE TO RETRY. An LLM completion is a pure read — a retried request creates
 * nothing, so no idempotency key is needed. The unsafe cases are enumerated in
 * {@link isTransientStatus} and in the cancellation check below, and each has
 * a test in `provider-transient-retry.test.ts`.
 */

import { parseRetryAfterMs } from './overload-guard';
import { isFinalForTurn } from './salir-error-envelope';

/** Tuning for {@link fetchWithTransientRetry}. */
export interface TransientRetryConfig {
  /** Total attempts including the first (default: 3). `1` disables retry. */
  readonly maxAttempts?: number;
  /** Delay before the first retry, doubling thereafter (default: 1000ms). */
  readonly baseDelayMs?: number;
  /**
   * Delay before the first retry of a RATE LIMIT, doubling thereafter
   * (default: 5000ms). Separate from `baseDelayMs` because a limiter measures
   * a window while a 5xx is usually a blip — one cadence cannot serve both.
   */
  readonly rateLimitDelayMs?: number;
  /** Injected for tests, which assert the delay rather than sit through it. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Called before each backoff, so waiting is visible.
   *
   * A silent retry is invisible time: a run can spend most of its wall-clock
   * in backoff with nothing in the log to say so, which is the condition under
   * which someone concludes the harness is slow and optimises the wrong thing.
   * `status` is absent for a transport failure, which never got one.
   */
  readonly onRetry?: (info: { readonly status?: number; readonly delayMs: number; readonly attempt: number }) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * A rate limiter's window is far longer than a transient blip's.
 *
 * The first sharded harness run proved this the expensive way: four workers
 * tripped z.ai's request limit, the provider retried at 1s and 2s, and both
 * retries came back 429 code 1302 because the window had not moved. Retrying
 * at the wrong CADENCE is indistinguishable from not retrying at all.
 */
const DEFAULT_RATE_LIMIT_DELAY_MS = 5000;

/**
 * Ceiling on any single wait, including one a server asked for.
 *
 * `retry-after: 3600` is a legal response and would otherwise park an agent
 * run for an hour with no way to tell it apart from a hang. Past a minute,
 * failing and letting the caller decide beats waiting silently.
 */
const MAX_BACKOFF_MS = 60_000;

/**
 * Whether an HTTP status is worth trying again.
 *
 * Deliberately narrow. 401/403 mean the credential was rejected — retrying
 * cannot fix it and, under ADR-155 pooled keys, repeated rejections burn a key
 * that was merely misconfigured. 4xx generally means the request itself is
 * malformed and will fail identically forever.
 *
 * 408 (timeout) and 425 (too early) are included alongside the obvious 429 and
 * 5xx because both describe a request that never got a verdict on its merits.
 */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Whether a thrown error is the caller cancelling, rather than a transport
 * fault.
 *
 * The caller's own signal is authoritative. The request also has an internal
 * timeout signal, whose AbortError/TimeoutError is retryable; classifying by
 * error name would mistake that timeout for a user cancellation.
 */
function isCallerCancellation(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  if (!signal) return (sleep ?? realSleep)(delayMs);
  if (signal.aborted) throw new Error('Agent run was cancelled');

  if (!sleep) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Agent run was cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Agent run was cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(delayMs), cancelled]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * How long to wait before the next attempt.
 *
 * A `retry-after` header wins outright: the server knows its own window, and
 * guessing over an explicit instruction is how a client gets itself throttled
 * harder. Absent one, a rate limit backs off on the longer schedule and
 * everything else on the ordinary one. Both double per attempt and both are
 * capped.
 */
function backoffFor(res: Response | undefined, attempt: number, config: TransientRetryConfig): number {
  const askedFor = res ? parseRetryAfterMs(res.headers?.get?.('retry-after') ?? null) : null;
  if (askedFor !== null) return Math.min(askedFor, MAX_BACKOFF_MS);

  const base =
    res?.status === 429
      ? (config.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS)
      : (config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** A settled attempt: the response, plus its body when the response failed. */
export interface TransientRetryResult<T = never> {
  readonly res: Response;
  /**
   * Body text of a failed response, read exactly once here. `undefined` for a
   * successful response when no `consume` callback was supplied.
   */
  readonly bodyText?: string;
  /** Decoded/consumed successful body when `consume` owns it inside the retry attempt. */
  readonly value?: T;
}

/** A response whose request-lifetime listeners must be released after its body settles. */
export interface TransientFetchAttempt {
  readonly response: Response;
  readonly dispose: () => void;
}

class DisposableAttemptConsumerError extends TypeError {}

/**
 * Run `doFetch` until it yields a non-transient result or attempts run out.
 *
 * `doFetch` must perform a COMPLETE single attempt, including building its own
 * timeout — a retry reusing an expired timer would abort instantly.
 *
 * `onAttempt` fires for every response received, not just the returned one, so
 * fleet-wide overload accounting sees each 429/529 rather than only the last.
 * Under-reporting there would hide a provider outage exactly when it matters.
 *
 * `isPermanent` exists because status alone is not always enough to classify a
 * failure. OpenAI answers BOTH "you are going too fast" and "your account is
 * out of credit" with 429; the first clears in a second, the second will not
 * clear until someone pays a bill. Retrying the latter three times just makes
 * a billing error take three seconds longer to surface.
 *
 * By default a success is returned with its body untouched. Callers that pass
 * `consume` keep successful body parsing inside the retry attempt; failed
 * responses are still read exactly once here for typed provider errors.
 */
export async function fetchWithTransientRetry<T = never>(
  doFetch: () => Promise<Response | TransientFetchAttempt>,
  options: {
    readonly retry?: TransientRetryConfig;
    readonly signal?: AbortSignal;
    readonly onAttempt?: (res: Response) => void;
    /** Classify a transient-looking failure as permanent, given its body. */
    readonly isPermanent?: (res: Response, bodyText: string) => boolean;
    /** Consume a successful body inside the attempt so transport failures can retry safely. */
    readonly consume?: (res: Response) => Promise<T>;
    /** Stop retrying a permanent fetch failure or a consumer failure after visible effects. */
    readonly isPermanentError?: (err: unknown) => boolean;
  } = {},
): Promise<TransientRetryResult<T>> {
  const retry = options.retry ?? {};
  const maxAttempts = Math.max(1, retry.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let failed: Response | undefined;
    let consuming = false;
    let dispose: (() => void) | undefined;
    try {
      const fetched = await doFetch();
      const disposable = 'response' in fetched;
      const res = disposable ? fetched.response : fetched;
      dispose = disposable ? fetched.dispose : undefined;
      options.onAttempt?.(res);
      if (res.ok) {
        if (disposable && !options.consume) {
          await res.body?.cancel().catch(() => {});
          throw new DisposableAttemptConsumerError('Disposable fetch attempts require a body consumer');
        }
        if (!options.consume) return { res };
        consuming = true;
        return { res, value: await options.consume(res) };
      }

      const bodyText = await res.text();
      // Hand the failed response back so the caller raises its own typed error
      // rather than a generic "retries exhausted" that loses the status.
      if (!isTransientStatus(res.status)) return { res, bodyText };
      if (options.isPermanent?.(res, bodyText)) return { res, bodyText };
      // A Salir Worker that says another attempt this turn cannot help (a Workers AI timeout, no capacity) is
      // believed: three four-minute timeouts once spent a whole Salir bot window on one turn (2026-10-20).
      if (isFinalForTurn(bodyText)) return { res, bodyText };
      if (attempt === maxAttempts) return { res, bodyText };
      failed = res;
    } catch (err) {
      if (isCallerCancellation(options.signal)) throw err;
      if (err instanceof DisposableAttemptConsumerError) throw err;
      lastError = err;
      if (options.isPermanentError?.(err) || (consuming && err instanceof SyntaxError)) throw err;
      if (attempt === maxAttempts) throw err;
    } finally {
      dispose?.();
    }
    const delayMs = backoffFor(failed, attempt, retry);
    retry.onRetry?.({ ...(failed ? { status: failed.status } : {}), delayMs, attempt });
    await waitForRetry(delayMs, options.signal, retry.sleep);
  }

  /* c8 ignore next 2 -- unreachable: the loop always returns or throws. */
  throw lastError ?? new Error('fetchWithTransientRetry: all attempts exhausted');
}
