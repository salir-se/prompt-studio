import { apiErrorFromBody } from '../vendor/api-client';
import { anthropicWireProxyHeaders } from '../anthropic-wire-proxy';
import { LlmHttpError } from '../llm-http-error';
import { fetchLlm, type LlmTransportContext, LlmTransportError } from '../llm-transport';
import { isOverloadStatus, llmOverloadGuard, parseRetryAfterMs } from '../overload-guard';
import { formatProviderErrorDetail } from '../provider-error-detail';
import { isLlmTimeout, requestLifetime } from '../request-lifetime';
import { fetchWithTransientRetry, type TransientFetchAttempt, type TransientRetryResult } from '../transient-retry';
import {
  CHAT_COMPLETIONS_PATH,
  isDirectOpenAI,
  isOpenAiQuotaError,
  log,
  OPENAI_QUOTA_ERROR_MESSAGE,
  openaiCompatRequestUrl,
} from './openai-compat-format';
import type { OpenAIRequests } from './openai-compat-request';

export function createOpenAITransport(requests: OpenAIRequests) {
  const {
    config,
    providerMeta,
    baseUrl,
    timeoutMs,
    usesChatGptSubscription,
    useProxy,
    buildHeaders,
    buildProxyBody,
    directOpenAiBrowserError,
    errorProviderName,
  } = requests;
  function handleErrorResponse(res: Response, body: string): never {
    // Parsed once up front so the queue-level rate-limit retry policy can
    // honor it on both rate-limit paths below — the 401 throw is a
    // credential rejection, never a rate limit, so it is deliberately left
    // without one (#1124).
    const retryAfterMs = parseRetryAfterMs(res.headers?.get?.('retry-after') ?? null);
    let parsedBody: unknown = body;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      // apiErrorFromBody also accepts raw strings; malformed/non-JSON proxy
      // responses simply carry no structured code or correlation id.
    }
    const bffError = usesChatGptSubscription
      ? apiErrorFromBody(parsedBody, res.status, { fallbackMessage: 'ChatGPT subscription request failed' })
      : undefined;
    if (usesChatGptSubscription && (res.status === 401 || res.status === 403)) {
      throw new LlmHttpError(
        res.status,
        'ChatGPT subscription authorization is unavailable. Reconnect ChatGPT, or manually choose API-key authentication or another provider in Settings.',
        { code: bffError?.code, correlationId: bffError?.correlationId },
      );
    }
    if (res.status === 401) {
      throw new LlmHttpError(res.status, 'API key is invalid or expired. Check your API key in Settings.');
    }
    const detail = formatProviderErrorDetail(res, body);
    if (!usesChatGptSubscription && isDirectOpenAI(baseUrl) && isOpenAiQuotaError(res, body)) {
      // An exhausted quota is a property of THIS key (429), not of the fleet —
      // carrying the status lets a pooled key be cooled down and rotated past.
      throw new LlmHttpError(
        res.status,
        `${OPENAI_QUOTA_ERROR_MESSAGE}${detail}`,
        retryAfterMs != null ? { retryAfterMs } : undefined,
      );
    }
    throw new LlmHttpError(
      res.status,
      `${errorProviderName()} API error: ${res.status}${detail || (body ? ` ${body}` : '')}`,
      usesChatGptSubscription
        ? { retryAfterMs, code: bffError?.code, correlationId: bffError?.correlationId }
        : { retryAfterMs },
    );
  }

  /**
   * Fleet-level overload recording (D7): feed 429/503/529 responses into the
   * shared `llmOverloadGuard` so a burst of overloads anywhere in the fleet
   * defers/clamps every LLM job, not just this call. `res.headers?.get?.(...)`
   * is defensively double-optional-chained because several existing test
   * doubles construct a bare `{ ok, status, text }` response with no
   * `headers` property at all.
   */
  function recordOverloadIfApplicable(res: Response): void {
    if (!isOverloadStatus(res.status)) return;
    llmOverloadGuard.recordOverload(res.status, parseRetryAfterMs(res.headers?.get?.('retry-after') ?? null));
  }

  /**
   * One completion request, retried through transient transport failures.
   *
   * Mirrors the Anthropic provider's `fetchOrThrow`. The browser guard runs
   * BEFORE the retry loop on purpose: calling OpenAI directly from a browser
   * is a permanent configuration fault, and retrying it would make the user
   * wait out the full backoff to be told something that was true immediately.
   */
  async function fetchOrThrow<T = never>(
    body: string,
    signal?: AbortSignal,
    path: string = CHAT_COMPLETIONS_PATH,
    consume?: (res: Response) => Promise<T>,
    isPermanentError?: (err: unknown) => boolean,
    context?: LlmTransportContext,
  ): Promise<TransientRetryResult<T>> {
    if (isDirectOpenAI(baseUrl) && !useProxy && typeof window !== 'undefined') {
      throw directOpenAiBrowserError();
    }
    const url = openaiCompatRequestUrl(baseUrl, path);
    const result = await fetchWithTransientRetry(() => fetchWithTimeout(url, body, signal, path, context), {
      // Default the retry reporter to a log line: an unreported backoff is
      // invisible wall-clock, and a caller that supplies its own still wins.
      retry: {
        ...config.retry,
        onRetry:
          config.retry?.onRetry ??
          ((info) => log.warn({ ...info, provider: providerMeta.id }, 'retrying transient LLM failure after backoff')),
      },
      ...(signal ? { signal } : {}),
      onAttempt: recordOverloadIfApplicable,
      // OpenAI returns 429 for both throttling and an exhausted account
      // balance. Only the first is worth waiting out; the second needs a
      // billing change, so retrying it delays the message that says so.
      isPermanent: (r, text) => !usesChatGptSubscription && isDirectOpenAI(baseUrl) && isOpenAiQuotaError(r, text),
      ...(consume ? { consume } : {}),
      // A timeout is OUR OWN budget expiring, not a transport blip: the next attempt gets an
      // identical budget against the same slow model, so it fails identically while the person
      // waits three times as long and the Workspace pays three times over (salir-se/salir#1757
      // measured exactly that — three 30s attempts, 93s, one of them a completed 86s answer).
      // Caller cancellation never reaches here (`isCallerCancellation` short-circuits first).
      isPermanentError: (err) =>
        err instanceof LlmTransportError || isLlmTimeout(err) || Boolean(isPermanentError?.(err)),
    });
    const { res, bodyText } = result;
    if (!res.ok) handleErrorResponse(res, bodyText ?? '');
    return result;
  }

  async function fetchWithTimeout(
    url: string,
    body: string,
    signal?: AbortSignal,
    path: string = CHAT_COMPLETIONS_PATH,
    context?: LlmTransportContext,
  ): Promise<TransientFetchAttempt> {
    if (signal?.aborted) throw new Error('Agent run was cancelled');
    const lifetime = requestLifetime(timeoutMs, signal);

    try {
      const headers = await buildHeaders();
      const proxyHeaders = useProxy && config.proxy ? await anthropicWireProxyHeaders(config.proxy) : headers;
      const response = await fetchLlm(
        { provider: providerMeta.id, url, method: 'POST', headers: proxyHeaders, body, context },
        () =>
          (config.fetch ?? fetch)(useProxy ? config.proxy!.url : url, {
            method: 'POST',
            headers: proxyHeaders,
            body: useProxy ? buildProxyBody(body, path) : body,
            signal: lifetime.signal,
          }),
        lifetime.signal,
        // The subscription BFF owns its upstream URL, body and internal retries.
        // This browser seam cannot attest those requests; API-key proxying can.
        !usesChatGptSubscription,
      );
      return { response, dispose: lifetime.dispose };
    } catch (err) {
      lifetime.dispose();
      if (err instanceof LlmTransportError) throw err;
      if (signal?.aborted) throw new Error('Agent run was cancelled', { cause: err });
      throw err;
    }
  }

  return { fetchOrThrow, fetchWithTimeout };
}
export type OpenAITransport = ReturnType<typeof createOpenAITransport>;
