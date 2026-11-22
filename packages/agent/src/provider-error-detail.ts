import { describeSalirErrorEnvelope, parseSalirErrorEnvelope } from './salir-error-envelope';

/**
 * Format an upstream LLM provider's error response into a single suffix
 * that embeds the detail any operator would want when triaging a
 * failed `testConnection` or chat call. Folds in:
 *
 *   - The provider's parsed error message. Anthropic responses use
 *     `{ type: 'error', error: { type, message } }`; OpenAI / OpenRouter
 *     use `{ error: { message, type, code } }`. The shape we read is
 *     the inner `error.message` (and `error.type` when present).
 *   - The upstream `request-id` (or `x-request-id`) header. Anthropic
 *     stamps one on every response; support tickets reference it
 *     directly. Without it the upstream often can't correlate.
 *
 * The returned string is empty (no leading separator) when we can't
 * extract anything useful — callers concatenate verbatim.
 *
 * Returns the prefix `" — "` so the call site reads naturally as
 * `"Invalid API key (401 Unauthorized) — request-id=req_xyz, …"`.
 *
 * Non-JSON bodies (e.g. an HTML error page from a misconfigured
 * baseUrl) are surfaced verbatim, capped at 200 chars so a stray
 * Cloudflare error page doesn't drown the log entry.
 */
export function formatProviderErrorDetail(res: Response, body: string): string {
  // A Salir Worker (the Hosted LLM Worker) answers its own envelope: its message is already the plain cause, and its
  // correlation id is the one support needs. Echoing the JSON put `{"ok":false,...}` in front of the user.
  const envelope = body ? parseSalirErrorEnvelope(body) : null;
  if (envelope) return ` — ${describeSalirErrorEnvelope(envelope)}`;
  const parts: string[] = [];
  // `res.headers` is always present on a real `Response`. Older test
  // mocks duck-type the response with `{ ok, status, text }` only, so
  // we guard the read — losing the request id in tests is acceptable;
  // crashing the error path is not.
  const requestId = res.headers?.get('request-id') ?? res.headers?.get('x-request-id');
  if (requestId) parts.push(`request-id=${requestId}`);

  if (body) {
    let message: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown; type?: unknown } };
      const inner = parsed.error;
      if (inner) {
        const innerMessage = typeof inner.message === 'string' ? inner.message : undefined;
        const innerType = typeof inner.type === 'string' ? inner.type : undefined;
        message = innerMessage && innerType ? `${innerType}: ${innerMessage}` : (innerMessage ?? innerType);
      }
    } catch {
      message = body.length > 200 ? `${body.slice(0, 197)}…` : body;
    }
    if (message) parts.push(message);
  }

  return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
}
