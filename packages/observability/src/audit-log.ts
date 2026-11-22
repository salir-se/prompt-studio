/**
 * Process-level audit-log sink registry.
 *
 * Audit events (console page `#/platform/audit`) are written to the admin
 * DB's `security_audit_event` table and the license DB's
 * `security_audit_event_local` table from ~100 call sites scattered across
 * the DB tier — mutation helpers that have no request context (`c`) in
 * scope, and no logger threaded through their signature. Rather than
 * plumbing a logger parameter through every one of those call sites (and
 * every function that calls them), each writer calls {@link emitAuditLogEvent}
 * after a successful insert; a worker's boot path registers the process's
 * pino logger once via {@link setAuditLogSink}. The worker logger's
 * `browser.transmit` tee (`@prompt-studio/worker-http/axiom.ts`) then ships the line
 * to Axiom exactly like any other structured log — no new delivery path.
 *
 * Like `axiom.ts`'s per-isolate singleton, this is module-level state: one
 * worker isolate registers one sink for its lifetime. A DB helper that runs
 * before any sink is registered (a CLI script, a seed script, a unit test)
 * gets a silent no-op — audit *persistence* already happened in the DB; this
 * registry only decides whether that write also produces a log line.
 *
 * Emitting a log line is a SECONDARY concern layered on top of the primary
 * DB mutation the audit row records — it must never be able to break that
 * mutation. `emitAuditLogEvent` therefore never throws, and never logs from
 * its own catch block: the sink IS a logger, so logging failure there would
 * recurse straight back into the call that just failed.
 */

/** Stable pino message text for a persisted audit event. Assert on this in tests. */
export const AUDIT_LOG_MESSAGE = 'security.audit';

/** Which audit table the row landed in. */
export type AuditLogStore = 'admin' | 'license';

export interface AuditLogRecord {
  /** The audit row's primary key. */
  auditId: string;
  actorId: string;
  actionType: string;
  auditStore: AuditLogStore;
  /** ISO-8601 timestamp stored on the row. */
  createdAt: string;
  orgId?: string;
  workspaceId?: string;
  summary?: string;
  subject?: Record<string, unknown>;
  /** MASKED snapshot as persisted — callers pass the post-mask object, never raw input. */
  before?: Record<string, unknown>;
  /** MASKED snapshot as persisted — callers pass the post-mask object, never raw input. */
  after?: Record<string, unknown>;
}

/**
 * Minimal structured-logger surface this registry needs — an `info` that
 * takes a fields object plus a message. Kept narrow so any pino-like logger
 * satisfies it (a worker's `c.var.logger`, `createLogger()`, or a test mock).
 */
export interface AuditSinkLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

let sink: AuditSinkLogger | null = null;

/**
 * Register (or clear with `null`) the process/isolate-wide audit-log sink.
 * Last call wins — a worker's boot path calls this once with its pino
 * logger; tests call it per-case and reset via {@link __resetAuditLogSinkForTests}.
 */
export function setAuditLogSink(logger: AuditSinkLogger | null): void {
  sink = logger;
}

/**
 * Emit one audit line for a persisted {@link AuditLogRecord}. No-op when no
 * sink is registered. MUST NEVER THROW — a sink failure must never surface
 * back into the DB-write call site this follows, so the whole body is
 * wrapped in try/catch and the catch does nothing observable (logging from
 * inside it would recurse into the sink that just failed).
 */
export function emitAuditLogEvent(record: AuditLogRecord): void {
  if (!sink) return;
  try {
    const fields: Record<string, unknown> = {
      auditId: record.auditId,
      actorId: record.actorId,
      actionType: record.actionType,
      auditStore: record.auditStore,
      createdAt: record.createdAt,
    };
    if (record.orgId !== undefined) fields.orgId = record.orgId;
    if (record.workspaceId !== undefined) fields.workspaceId = record.workspaceId;
    if (record.summary !== undefined) fields.summary = record.summary;
    if (record.subject !== undefined) fields.subject = record.subject;
    if (record.before !== undefined) fields.before = record.before;
    if (record.after !== undefined) fields.after = record.after;

    sink.info(fields, AUDIT_LOG_MESSAGE);
  } catch {
    // Fail-open: an audit log emit is secondary to the DB mutation it follows.
  }
}

/**
 * Test-only reset of the module singleton. Exists because `sink` is
 * per-isolate module state — production has exactly one isolate per
 * deployment, but a single test file exercises many registrations across
 * its cases.
 */
export function __resetAuditLogSinkForTests(): void {
  sink = null;
}
