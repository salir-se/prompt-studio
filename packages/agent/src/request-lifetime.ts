/**
 * Ceiling for ONE completion a person is waiting on (Prompts tools, the Sales
 * Mode Wizard, any other foreground call).
 *
 * Sized from measured provider latency, not from patience: Hosted LLM
 * completions on staging over 26 hours (n=200, every one HTTP 200) ran p50
 * 16.2s, p95 76.1s, max 178.2s. The 30-second budget the Sales app used to
 * apply aborted 27.5% of them — including, in salir-se/salir#1757, a strategy
 * plan the provider answered correctly in 86.4 seconds.
 *
 * A ceiling is not a reservation: a fast answer still returns immediately, so
 * raising it costs nothing except how long we wait before giving up. It is
 * therefore sized above the slowest observed completion rather than near the
 * median, exactly like `CV_EXTRACT_TIMEOUT_MS` and `CRITIC_INBOUND_TIMEOUT_MS`
 * (both 120_000) are sized for their own one-shot calls — this one is longer
 * because those two run server-side against a pinned model, while an
 * interactive call runs against whatever model the Workspace configured.
 */
export const INTERACTIVE_LLM_TIMEOUT_MS = 300_000;

/**
 * True when a rejection is OUR OWN request timer firing — not the caller
 * cancelling, and not the provider failing.
 *
 * {@link requestLifetime} arms `AbortSignal.timeout`, whose abort reason is a
 * `TimeoutError` `DOMException`; Chrome's message for it is the bare
 * `signal timed out` that reached a user in salir-se/salir#1757. Duck-typed on
 * `name` rather than `instanceof DOMException`: the same rejection travels
 * through `AbortSignal.any`, the provider adapters, and test doubles, and every
 * one of those preserves the name while not all preserve the class.
 *
 * `AbortError` is deliberately NOT included. That name is what a CALLER's
 * cancellation produces, and the adapters already translate it ("Agent run was
 * cancelled"); treating it as a timeout would tell a person who pressed Cancel
 * that the model was slow.
 */
export function isLlmTimeout(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';
}

export interface RequestLifetime {
  readonly signal: AbortSignal;
  /** Release fallback listeners after the complete response body has settled. */
  readonly dispose: () => void;
}

/** Keep timeout and caller cancellation attached to fetch through response-body consumption. */
export function requestLifetime(timeoutMs: number, callerSignal?: AbortSignal): RequestLifetime {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!callerSignal) return { signal: timeoutSignal, dispose: () => {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([callerSignal, timeoutSignal]), dispose: () => {} };
  }

  const controller = new AbortController();
  let listening = false;
  const cleanup = (): void => {
    if (!listening) return;
    listening = false;
    callerSignal.removeEventListener('abort', onCallerAbort);
    timeoutSignal.removeEventListener('abort', onTimeout);
  };
  const abortFrom = (source: AbortSignal): void => {
    cleanup();
    controller.abort(source.reason);
  };
  const onCallerAbort = (): void => abortFrom(callerSignal);
  const onTimeout = (): void => abortFrom(timeoutSignal);

  if (callerSignal.aborted) abortFrom(callerSignal);
  else if (timeoutSignal.aborted) abortFrom(timeoutSignal);
  else {
    listening = true;
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  }
  return { signal: controller.signal, dispose: cleanup };
}

/** Preserve the public cancellation error after headers while the response body settles. */
export async function readWithCallerCancellation<T>(body: Promise<T>, callerSignal?: AbortSignal): Promise<T> {
  try {
    return await body;
  } catch (err) {
    if (callerSignal?.aborted) throw new Error('Agent run was cancelled', { cause: err });
    throw err;
  }
}
