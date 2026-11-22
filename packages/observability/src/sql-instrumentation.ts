/**
 * Shared libSQL client instrumentation — the single seam both tiers proxy
 * their client through instead of hand-rolling a near-identical `Proxy`:
 * packages/storage's `TursoAdapter` (browser, no reporter — debug log only)
 * and services/bff's group-DB fan-out (worker, debug log today). Both already
 * share the pure parsing helpers below (`normalizeSqlText`/`sqlTarget`/
 * `argCount`, ./sql-log.ts); this extracts the Proxy plumbing itself so the
 * two call sites stop drifting statement-shape-by-statement-shape.
 *
 * Ports-and-adapters seam: `onQuery` is a plain callback, not an import of
 * worker code. The worker tier will accumulate `SqlQuerySample`s per request
 * via an `AsyncLocalStorage` in `@prompt-studio/worker-http` and emit one rolled-up
 * OTel span; the browser tier has no ALS and has no reason to ever construct
 * one. Keeping the port here — instead of this module importing the
 * accumulator — is what lets @prompt-studio/observability instrument BOTH tiers
 * without depending on either's runtime.
 *
 * NEVER logs or reports arg VALUES — only `argCount()`. Collection KEYS
 * surfaced by `sqlTarget` (e.g. "config", "mailboxQuotaState") are the one
 * exception: they are not secrets, whereas row data and other arg values are.
 * Instrumentation must never break the call it wraps: a throwing `onQuery`
 * or `logger` is swallowed, never allowed to alter the wrapped call's result
 * or its rejection.
 */

import { argCount, normalizeSqlText, sqlTarget } from './sql-log';

/**
 * Structural stand-in for libSQL's `InStatement` — matched by shape only so
 * this module never depends on `@libsql/client` (the browser and worker
 * tiers import different subpaths of that package; observability must not
 * pick a side). Covers all three ways a statement can be passed: a bare SQL
 * string, a `[sql, args]` tuple, or an `{ sql, args }` object.
 */
type SqlStatementLike = string | [string, unknown?] | { sql: string; args?: unknown };

/** One instrumented SQL statement's timing. NEVER carries arg VALUES. */
export interface SqlQuerySample {
  /** Table/collection the statement targets, from `sqlTarget()`. */
  target: string;
  /** Whitespace-normalized, length-capped SQL text, from `normalizeSqlText()`. */
  sql: string;
  /** Wall-clock milliseconds for the statement. NOT rounded. */
  ms: number;
  /** Rows returned; 0 for writes or an unexpected result shape. */
  rows: number;
  kind: 'execute' | 'batch';
}

export type SqlQueryReporter = (sample: SqlQuerySample) => void;

/** Minimal structural logger surface — lets tests pass a fake instead of a real pino logger. */
export interface SqlDebugLogger {
  debug(obj: object, msg: string): void;
}

export interface InstrumentSqlClientOptions {
  logger?: SqlDebugLogger;
  onQuery?: SqlQueryReporter;
  /** Log message for the debug line. Default: 'turso.sql'. */
  message?: string;
}

/** Extract the SQL text from any InStatement shape (object, string, or tuple). */
function stmtSql(stmt: SqlStatementLike): string {
  if (typeof stmt === 'string') return stmt;
  if (Array.isArray(stmt)) return stmt[0];
  return stmt.sql;
}

/** Extract the positional/named args from any InStatement shape. */
function stmtArgs(stmt: SqlStatementLike): unknown {
  if (typeof stmt === 'string') return [];
  if (Array.isArray(stmt)) return stmt[1] ?? [];
  return stmt.args;
}

/** Best-effort row count from a statement result — never throws even on an unexpected shape. */
function resultRowCount(result: unknown): number {
  return (result as { rows?: unknown[] } | null | undefined)?.rows?.length ?? 0;
}

/**
 * Wrap a libSQL-shaped client so every `execute()`/`batch()` call is timed
 * and, optionally, both debug-logged and handed to `onQuery`. Silent (no
 * logger, no reporter) by default — a caller opts into either or both.
 *
 * `transaction()` is wrapped too (issue #1614): the handle it resolves to is
 * re-wrapped with the same options, so statements issued INSIDE a transaction
 * are reported exactly like statements issued outside one.
 *
 * `T` is preserved exactly: the Proxy is cast back to `T` at the end, so a
 * caller holding e.g. `Client` from `@libsql/client` keeps that type with no
 * cast at the call site, while this module itself never imports it.
 */
export function instrumentSqlClient<T extends object>(client: T, options: InstrumentSqlClientOptions = {}): T {
  const { logger, onQuery, message = 'turso.sql' } = options;

  const report = (stmt: SqlStatementLike, ms: number, rows: number, kind: 'execute' | 'batch'): void => {
    // Instrumentation must never break the call it wraps. `report()` runs
    // AFTER the wrapped execute()/batch() has already resolved, so this outer
    // try/catch covers sample construction itself (stmtSql/stmtArgs/
    // sqlTarget/normalizeSqlText) — not just the onQuery/logger calls below —
    // otherwise a malformed statement (e.g. a non-string `sql` field) would
    // turn an already-successful query into a thrown rejection.
    try {
      const text = stmtSql(stmt);
      const args = stmtArgs(stmt);
      const sample: SqlQuerySample = { target: sqlTarget(text, args), sql: normalizeSqlText(text), ms, rows, kind };

      // Two independent inner guards so a throwing reporter still lets the
      // logger run, and vice versa.
      try {
        onQuery?.(sample);
      } catch {
        // never break the call
      }
      try {
        logger?.debug(
          { target: sample.target, sql: sample.sql, args: argCount(args), rows, ms: Math.round(ms), kind },
          message,
        );
      } catch {
        // never break the call
      }
    } catch {
      // never break the call — sample construction itself must not throw out.
    }
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return async (stmt: SqlStatementLike, args?: unknown): Promise<unknown> => {
          const start = performance.now();
          const execute = (target as Record<string, unknown>).execute as (...a: unknown[]) => Promise<unknown>;
          // Preserve both overloads: execute(stmt) and execute(sql, args).
          const res = args === undefined ? await execute.call(target, stmt) : await execute.call(target, stmt, args);
          report(stmt, performance.now() - start, resultRowCount(res), 'execute');
          return res;
        };
      }
      if (prop === 'batch') {
        return async (stmts: SqlStatementLike[], mode?: unknown): Promise<unknown> => {
          const start = performance.now();
          const batch = (target as Record<string, unknown>).batch as (...a: unknown[]) => Promise<unknown[]>;
          const res = await batch.call(target, stmts, mode);
          const each = (performance.now() - start) / Math.max(stmts.length, 1);
          stmts.forEach((s, i) => {
            report(s, each, resultRowCount(res[i]), 'batch');
          });
          return res;
        };
      }
      // Issue #1614: statements issued through a transaction handle never
      // touch this Proxy's execute/batch traps, so they used to escape
      // instrumentation entirely. Re-wrapping the handle with the SAME
      // options instruments its execute/batch identically, while commit/
      // rollback/close fall through to the bound-original branch below.
      // Only trapped when the underlying client actually has a callable
      // `transaction` — a client without one must keep reporting it absent.
      if (prop === 'transaction' && typeof (target as Record<string, unknown>).transaction === 'function') {
        return async (...args: unknown[]): Promise<unknown> => {
          const transaction = (target as Record<string, unknown>).transaction as (...a: unknown[]) => Promise<object>;
          return instrumentSqlClient(await transaction.apply(target, args), options);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as T;
}
