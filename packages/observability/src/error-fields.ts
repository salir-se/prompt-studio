/**
 * Duck-typed `{ code, correlationId, status }` extraction for anything an API
 * client might throw or reject with.
 *
 * The identical ~6-line routine below used to be reimplemented independently
 * in six places across the SPAs (`error-trace.ts`, both `ApiErrorNotice`
 * components, `ScoutView.tsx`, `SalesModeWizard.tsx`, and an inline copy in
 * console's `admin/error.tsx`) — each with its own doc comment re-explaining
 * the same rationale. This is the one shared place for it.
 *
 * Duck-typed, not `instanceof ApiClientError` (`@prompt-studio/worker-http/client`):
 * bundling can duplicate that class across chunks, so an `instanceof` check
 * at the display boundary would silently miss real instances. Property
 * presence is the only check that survives that duplication.
 *
 * Deliberately out of scope:
 *  - **Message resolution.** Callers have picked at least three different,
 *    individually-justified message policies (local-copy-only, verbatim
 *    `Error.message` preservation, `instanceof`-only refusal) — unifying that
 *    behaviour here would regress at least one of them. This helper returns
 *    identifiers only; the human-readable message stays the caller's call.
 *  - **Correlation-id fallback.** Some callers fall back to a SPA-local,
 *    tab-scoped id (e.g. `getSessionCorrelationId()`) when the error never
 *    made a server round trip. That id is app-specific, not observability's
 *    concern — callers layer that fallback on top of what this returns.
 *
 * The next agent hitting this problem should read this instead of writing a
 * seventh copy.
 */

/** Narrow, duck-typed view of the fields an `ApiClientError`-shaped value carries. */
export interface ErrorFields {
  code?: string;
  correlationId?: string;
  status?: number;
}

/**
 * Pull `{ code, correlationId, status }` out of anything a catch block or a
 * rejected promise might hand back. Total and pure: any `unknown` in, a
 * (possibly empty) {@link ErrorFields} out — never throws, and non-matching
 * property types (e.g. a numeric `code`) are dropped rather than coerced.
 */
export function resolveErrorFields(error: unknown): ErrorFields {
  const candidate = error as { code?: unknown; correlationId?: unknown; status?: unknown } | null | undefined;
  if (typeof candidate !== 'object' || candidate === null) return {};

  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const correlationId = typeof candidate.correlationId === 'string' ? candidate.correlationId : undefined;
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;

  return { code, correlationId, status };
}
