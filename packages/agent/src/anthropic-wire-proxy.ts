/**
 * Shared client contract for the authenticated Salir Anthropic-wire proxy
 * (`POST /api/app/workspaces/:groupId/llm/messages`).
 *
 * z.ai's gateway answers CORS preflights on its real API routes with no
 * `Access-Control-Allow-Origin`, so a browser-direct POST to
 * `${baseUrl}/v1/messages` is blocked before the request ever reaches the
 * network — it surfaces as `TypeError: Failed to fetch`. The BFF proxy holds
 * the vendor key server-side and forwards the request.
 *
 * TWO call paths speak this wire format and both must agree byte for byte:
 *   - `./providers/anthropic.ts` — the `LlmProvider` adapter (interactive runs
 *     and every OpenAI-compatible-style caller);
 *   - `./api.ts` — the legacy `callWithRetry`/`callWithRetryStreaming` agent
 *     loop, which is what a QUEUED Scout/Researcher/Closer run actually takes.
 *
 * The envelope shape and the proxy-vs-vendor error attribution therefore live
 * here once, rather than being copied into the second call site where they
 * could drift.
 */

/** Session headers for one proxied call. A getter is resolved on every
 *  fetch so a rotated Access token is sent instead of a snapshotted bearer. */
export type AnthropicWireProxyHeaders =
  Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

/** Runtime routing for one Anthropic-wire call: where to POST, and what
 *  session headers the authenticated proxy needs. Never carries the vendor
 *  API key — that travels inside the envelope body, not a header. */
export interface AnthropicWireProxy {
  url: string;
  headers?: AnthropicWireProxyHeaders;
}

/**
 * Response header the BFF sets once a request actually reached the vendor.
 * A browser can read it solely because the BFF names it in
 * `Access-Control-Expose-Headers` (see services/bff/src/index.ts), which is
 * why its ABSENCE is never treated as proof of a proxy failure.
 */
export const SALIR_LLM_UPSTREAM_HEADER = 'X-Salir-LLM-Upstream';

/**
 * Headers for a proxied Anthropic-wire request. Deliberately carries NO
 * `x-api-key`, `anthropic-version`, or
 * `anthropic-dangerous-direct-browser-access` — the proxy attaches the vendor
 * credentials upstream, and putting the key in a browser-visible header would
 * both leak it and be ignored.
 */
export async function anthropicWireProxyHeaders(proxy: AnthropicWireProxy): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', ...(await resolveDynamicHeaders(proxy.headers)) };
}

/**
 * Resolve a static header bag or a per-fetch getter to a concrete map.
 *
 * Shared by every transport that carries session headers rather than a vendor
 * key — the Anthropic-wire proxy above and the Hosted LLM direct transport
 * (`LlmProviderConfig.authHeaders`, ADR-280) — so a rotated Access token is
 * read at fetch time by all of them, never snapshotted once at construction.
 */
export async function resolveDynamicHeaders(
  headers: AnthropicWireProxyHeaders | undefined,
): Promise<Record<string, string>> {
  if (!headers) return {};
  return typeof headers === 'function' ? ((await headers()) ?? {}) : headers;
}

/**
 * Wrap a verbatim Anthropic Messages request body in the proxy envelope.
 *
 * The envelope is frozen (`AnthropicMessagesProxyBody` in services/bff —
 * `'+': 'reject'`), so it must be exactly these three keys.
 *
 * SECURITY: the returned string contains the vendor API key. It belongs in the
 * `fetch` body ONLY — never in an `fetchLlm` descriptor (which
 * `llm-journal.ts` persists verbatim into the super-admin journal), a log
 * line, or an error message.
 */
export function buildAnthropicWireProxyBody(baseUrl: string, apiKey: string, body: string): string {
  return JSON.stringify({ baseUrl, apiKey, request: JSON.parse(body) });
}

/**
 * Recognise the canonical Salir error envelope so a failure raised by our own
 * worker can be told apart from a vendor rejection WITHOUT relying on a
 * response header the browser may have stripped.
 *
 * `apiError` in `@prompt-studio/worker-http` emits exactly
 * `{ ok: false, error: string, details: { code, message, correlationId, service?, detail? } }`
 * — the `details.code` string is the discriminator; no Anthropic-wire vendor
 * error (`{ type: 'error', error: { type, message } }`) carries one.
 *
 * Returns the code, or `null` when the body is not a Salir envelope.
 */
export function salirApiErrorCode(body: string): string | null {
  if (!body.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const details = (parsed as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * True when the response carries the proxy's upstream marker.
 *
 * `res.headers?.get?.(...)` is defensively double-optional-chained because
 * several existing test doubles construct a bare `{ ok, status, text }`
 * response with no `headers` property at all.
 */
export function hasSalirLlmUpstreamMarker(res: { headers?: Headers }): boolean {
  return Boolean(res.headers?.get?.(SALIR_LLM_UPSTREAM_HEADER));
}

/**
 * Decide whether a failed PROXIED response should be attributed to Salir
 * rather than the vendor, returning the user-facing message when it should
 * and `null` when the failure belongs to the vendor (fail open).
 *
 * The marker is a POSITIVE signal only: treating its ABSENCE as proof of a
 * proxy failure fails CLOSED — one header-exposure regression and every vendor
 * rejection reads as "Salir is down", which is the misattribution this marker
 * exists to prevent, inverted. So absence only wins where it is independently
 * corroborated:
 *   - a 404, which is the deploy-skew case (the route isn't there yet);
 *   - a body shaped like the canonical Salir `apiError` envelope, which only a
 *     Salir worker emits.
 * Anything else falls through to vendor attribution, which is both the more
 * common truth and the safer default.
 *
 * Callers must only reach this when a proxy is actually configured.
 */
export function anthropicWireProxyFailureMessage(args: {
  status: number;
  body: string;
  hasUpstreamMarker: boolean;
}): string | null {
  if (args.hasUpstreamMarker) return null;
  if (args.status === 404) {
    // Deploy-skew case: a new SPA build calling workers that don't have
    // the proxy route yet.
    return 'The Salir LLM proxy is unavailable (404 Not Found). Reload the app to pick up the latest version, then try again.';
  }
  const proxyErrorCode = salirApiErrorCode(args.body);
  if (proxyErrorCode) {
    return `Salir LLM proxy request failed (${proxyErrorCode}): ${args.status}${args.body ? ` ${args.body}` : ''}`;
  }
  return null;
}
