/**
 * Structured logging for best-effort audit-event write failures.
 *
 * Collapses the pattern repeated ~15× across the license/billing workers —
 * `console.warn('[worker] audit-event write failed for <eventType>', auditErr)` —
 * into one structured, scoped, maskable log line. Audit writes are a SECONDARY
 * (best-effort) path: a failure must never break the primary mutation, so this
 * helper only logs and never rethrows.
 *
 * The event type is a structured `eventType` field (filterable), not a string
 * baked into the message, and the raw error is passed as `err` so the logger's
 * `errSerializer` captures the stack + cause chain.
 */
/** Stable milestone label for audit-write failures (assert on this in tests). */
export const AUDIT_FAILURE_MESSAGE = 'audit-event write failed';

/**
 * Minimal logger surface this helper needs — a structured `warn`. Kept narrower
 * than the full {@link Logger} (no `child`) on purpose so any pino-like logger
 * satisfies it, including hono-pino's request `c.var.logger`.
 */
export interface WarnLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Log a best-effort audit-event write failure at `warn` level. Never throws.
 *
 * @param logger    a structured logger (request `c.var.logger` or `createLogger`)
 * @param eventType the audit event that failed to persist, e.g. `platform.license.issue`
 * @param err       the caught error (passed raw so the stack is preserved)
 * @param fields    optional extra context (orgId, workspaceId, actorId, …)
 */
export function logAuditFailure(
  logger: WarnLogger,
  eventType: string,
  err: unknown,
  fields?: Record<string, unknown>,
): void {
  logger.warn({ eventType, err, ...fields }, AUDIT_FAILURE_MESSAGE);
}
