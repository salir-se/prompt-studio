/** Standard JSON error envelope returned by an HTTP service. */
export interface ApiErrorBody {
  ok: false;
  /** @deprecated use `details.message` — kept for backward compatibility, removed in the contract phase. */
  error: string;
  details: {
    code: string;
    message: string;
    correlationId: string;
    /** Which worker produced the error (e.g. `salir-auth`) — a quick "where" hint for developers. */
    service?: string;
    detail?: unknown;
  };
}

/**
 * Fields used to construct an {@link ApiClientError}. `body` is the raw parsed
 * response body — an escape hatch for callers that need to inspect fields
 * this client doesn't surface directly.
 */
export interface ApiClientErrorInit {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly detail?: unknown;
  readonly body?: unknown;
}

/**
 * Client-side mirror of {@link ApiErrorBody} (ADR-062). Every worker error
 * response is normalized into this shape so the server envelope and the
 * client's error type never drift apart.
 */
export class ApiClientError extends Error {
  override readonly name = 'ApiClientError';
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly detail?: unknown;
  readonly body?: unknown;

  constructor(message: string, init: ApiClientErrorInit) {
    super(message);
    this.status = init.status;
    this.code = init.code;
    this.correlationId = init.correlationId;
    this.detail = init.detail;
    this.body = init.body;
  }
}

/**
 * True iff `error` is an {@link ApiClientError} carrying status 401. A 401 is
 * authoritative — the session really is unauthorized — unlike a network
 * error or a 5xx, so callers use this to skip a same-request retry/fallback
 * instead of masking the real rejection.
 *
 * `instanceof` is the primary check, backed by the class's own stable
 * `name` marker as a fallback: bundling can duplicate the class across
 * chunks, which would make `instanceof` silently miss a real instance (the
 * risk `www/console.salir.se/src/components/admin/error.tsx` and
 * `components/molecules/ApiErrorNotice.tsx` already work around by reading
 * fields off the error instead). Still not duck-typed the other way: a
 * plain object shaped like `{ status: 401 }` with no `name` does not count.
 */
export function isUnauthorizedApiError(error: unknown): error is ApiClientError {
  if (error instanceof ApiClientError) return error.status === 401;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ApiClientError' &&
    (error as { status?: unknown }).status === 401
  );
}

/** Narrow an unknown value to a plain object so property lookups are safe. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * Build an {@link ApiClientError} from a parsed (or raw) response body. Pure
 * and synchronous — never throws, so it's safe to call unconditionally from
 * any error-handling path.
 *
 * Resolution order always prefers the canonical `details` envelope over the
 * deprecated flat top-level siblings some workers still emit additively —
 * never the reverse:
 *   - `code`: `details.code` → top-level `code` → `undefined`
 *   - `correlationId`: `details.correlationId` → `undefined`
 *   - `detail`: `details.detail` → top-level `detail` → `undefined`
 *   - `message`: `details.message` → top-level `error` → top-level `message` →
 *     raw string body → `opts.fallbackMessage` → `Request failed (${status})`
 */
export function apiErrorFromBody(body: unknown, status: number, opts?: { fallbackMessage?: string }): ApiClientError {
  const root = asRecord(body);
  const details = root ? asRecord(root.details) : undefined;

  const code =
    (typeof details?.code === 'string' ? details.code : undefined) ??
    (typeof root?.code === 'string' ? root.code : undefined);

  const correlationId = typeof details?.correlationId === 'string' ? details.correlationId : undefined;

  const detail = details && 'detail' in details ? details.detail : root && 'detail' in root ? root.detail : undefined;

  const message =
    (typeof details?.message === 'string' ? details.message : undefined) ??
    (typeof root?.error === 'string' ? root.error : undefined) ??
    (typeof root?.message === 'string' ? root.message : undefined) ??
    (typeof body === 'string' && body.length > 0 ? body : undefined) ??
    opts?.fallbackMessage ??
    `Request failed (${status})`;

  return new ApiClientError(message, { status, code, correlationId, detail, body });
}

/**
 * Read a `Response` body exactly once and normalize it into an
 * {@link ApiClientError}. Never rejects: a failed JSON parse or body read
 * falls back to `response.statusText`, then a generic message.
 */
export async function parseApiError(response: Response, opts?: { fallbackMessage?: string }): Promise<ApiClientError> {
  const contentType = response.headers.get('content-type') ?? '';
  let body: unknown;

  try {
    body = contentType.includes('application/json') ? await response.json() : await response.text();
  } catch {
    const fallbackMessage = opts?.fallbackMessage || response.statusText || `Request failed (${response.status})`;
    return new ApiClientError(fallbackMessage, { status: response.status });
  }

  return apiErrorFromBody(body, response.status, opts);
}
