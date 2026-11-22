/**
 * Bounded-timeout, opt-in-retry execution wrapper for libSQL-shaped clients
 * (issue #1342). A 48h staging triage found 500/502s across five workers all
 * reducing to transient Turso/Cloudflare platform failures (520/524/502) —
 * the worst case a `refresh_tokens` INSERT that hung for 73 SECONDS before
 * something else gave up waiting. `@libsql/client`'s 0.17.x HTTP transport
 * does one pipelined hrana POST with no retry, no backoff, and — critically —
 * no `AbortSignal`. `instrumentSqlClient` (this package's sibling) is
 * timing/reporting only; it never bounds or retries anything. This module is
 * the DB-layer equivalent of `boundedFetch` (packages/worker-http/src/fetch.ts):
 * an unconditional per-attempt timeout plus retry restricted to errors
 * classified as transient.
 *
 * TIMEOUT IS A WAIT BOUND, NOT A CANCEL. Because the HTTP transport accepts
 * no `AbortSignal`, there is no way to actually cancel the in-flight hrana
 * request — this wrapper can only stop the CALLER from waiting past the
 * budget. The underlying statement may still complete (commit, or fail) on
 * Turso's side after `resilientSqlClient` has already rejected the caller
 * with `SqlTimeoutError`. That ambiguity is exactly why a timeout is never
 * retried (see `isRetryableSqlError`): there is no evidence whether the
 * statement committed, the same reasoning that makes a bare 520 ambiguous.
 *
 * RETRY IS OPT-IN (`retries: 0` default), for the same reason `boundedFetch`
 * defaults to it: auto-retrying a non-idempotent INSERT/UPDATE duplicates
 * work. A caller enables it only where retrying is known-safe — idempotent
 * reads, or writes already protected by an idempotency key upstream.
 *
 * COMPOSITION ORDER (this is what the license adopter uses, and what makes
 * retried attempts show up truthfully in telemetry):
 *
 *   drizzle({ client: resilientSqlClient(instrumentSqlClient(client, { onQuery: recordDbQuery }), { ... }) })
 *
 * Resilience wraps OUTSIDE instrumentation. Each retried attempt re-enters
 * the instrumented client's `execute`/`batch`, so `onQuery` receives one
 * truthful `SqlQuerySample` per ATTEMPT that actually completed (not one
 * per logical call), and the timeout budget covers the instrumented call —
 * including its (small) reporting overhead — rather than racing underneath
 * it and potentially timing out a call instrumentation never got to see.
 */

export interface SqlResilienceOptions {
  /** Per-call wall-clock budget in ms. Default 5000. */
  timeoutMs?: number;
  /** Retry attempts AFTER the first failure, retryable errors only. Default 0 (opt-in). */
  retries?: number;
  /** Delay before the retry, in ms. Default 100. */
  backoffMs?: number;
  /** Call-site label for degradation events, e.g. 'license'. */
  label?: string;
  /** Invoked once per degradation event. Must NEVER throw out of the wrapper. */
  onDegraded?: (event: SqlDegradationEvent) => void;
  /** Injectable for tests. Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SqlDegradationEvent {
  label?: string;
  kind: 'execute' | 'batch';
  reason: 'timeout' | 'retryable-error';
  /** 1-based attempt that failed. */
  attempt: number;
  willRetry: boolean;
  ms: number;
  /** Message text, safe to log — never the raw error object (may carry driver internals). */
  error: string;
}

/**
 * Thrown when an attempt exceeds its `timeoutMs` budget. NOT a subclass or
 * sibling of libsql's `LibsqlError` — deliberately a plain `Error` so
 * `isRetryableSqlError` has no ambiguity classifying it (see module doc:
 * a timeout is never retryable).
 */
export class SqlTimeoutError extends Error {}

/**
 * Whether `error`, or an error in its `cause` chain (Drizzle wraps the driver's error as `DrizzleQueryError.cause`), is
 * a {@link SqlTimeoutError}: the database did not answer in time, so the same request may succeed in a moment.
 */
export function isSqlTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof SqlTimeoutError) return true;
    current = current.cause;
  }
  return false;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = 100;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Structural match on libsql's `LibsqlError` shape (a `code: string`
 * property) — matched by shape only, never by `instanceof`, so this module
 * never imports `@libsql/client` (see CLAUDE.md: observability must not pick
 * a browser/worker-tier side, and must not invert the dependency direction
 * with `@prompt-studio/worker-http`, which already depends on this package).
 */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** HTTP statuses libsql's `SERVER_ERROR` message embeds for a Turso/Cloudflare platform failure. */
const RETRYABLE_HTTP_STATUSES = ['500', '502', '503', '504', '520', '521', '522', '523', '524'];

/** Transport/network failure signatures — not libsql-specific, so matched on message substrings. */
const RETRYABLE_MESSAGE_PATTERNS = [/fetch failed|failed to fetch/i, /ECONNRESET/i, /socket hang up/i, /network/i];

/**
 * Classifies an error as safe to retry. Deliberately conservative: default to
 * NOT retryable when uncertain — a false retry can duplicate a write (e.g.
 * re-running an INSERT that actually committed before a hung response), a
 * false non-retry only surfaces an error the caller already has to handle.
 *
 * Retryable: transport/network failures (fetch's own `TypeError`, or a
 * message naming a known network failure mode) and libsql's `SERVER_ERROR`
 * carrying one of Turso/Cloudflare's transient platform statuses (the real
 * shape is `{ code: 'SERVER_ERROR', message: 'SERVER_ERROR: Server returned
 * HTTP status 520' }`).
 *
 * NOT retryable: `SqlTimeoutError` (see module doc — no evidence the
 * statement didn't commit), constraint violations (`SQLITE_CONSTRAINT*`),
 * auth failures (`UNAUTHORIZED`, or a 401/403 in the message), SQL
 * syntax/parse errors, and anything unrecognised.
 */
export function isRetryableSqlError(error: unknown): boolean {
  if (error instanceof SqlTimeoutError) return false;

  // Fetch TypeErrors need a transport signature; programmer TypeErrors must propagate.
  const message = describe(error);
  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) return true;

  const code = errorCode(error);
  if (code === 'SERVER_ERROR') return RETRYABLE_HTTP_STATUSES.some((status) => message.includes(status));

  return false;
}

/**
 * Race `invoke()` against a `timeoutMs` deadline. Because the underlying
 * request cannot truly be cancelled (see module doc), a losing `invoke()`
 * keeps running after this function returns/throws — its EVENTUAL settlement
 * must not surface as an unhandled rejection, hence the unconditional no-op
 * `.catch()` attached below (harmless when `invoke()` wins: it just adds an
 * already-observed derived promise, it does not change what `Promise.race`
 * resolves/rejects with).
 */
function withTimeout<T>(invoke: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const inFlight = invoke();
  inFlight.catch(() => {
    // The loser of the race below may still reject later — never let that
    // become an unhandled rejection. This does not affect what the race
    // itself resolves/rejects with.
  });

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SqlTimeoutError(message)), timeoutMs);
  });

  return Promise.race([inFlight, deadline]).finally(() => clearTimeout(timer));
}

interface ResilienceRuntimeOptions {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  label?: string;
  onDegraded?: (event: SqlDegradationEvent) => void;
  sleep: (ms: number) => Promise<void>;
}

/**
 * One logical `execute`/`batch` call, timed-and-retried per the runtime
 * options. `invoke` is called fresh on every attempt (never reused) so each
 * attempt is a genuinely independent request to the underlying client.
 */
async function runResilient<T>(
  kind: 'execute' | 'batch',
  invoke: () => Promise<T>,
  opts: ResilienceRuntimeOptions,
): Promise<T> {
  const { timeoutMs, retries, backoffMs, label, onDegraded, sleep } = opts;
  const prefix = label ? `resilientSqlClient [${label}]` : 'resilientSqlClient';

  for (let attempt = 1; ; attempt++) {
    const start = performance.now();
    try {
      return await withTimeout(invoke, timeoutMs, `${prefix}: ${kind} timed out after ${timeoutMs}ms`);
    } catch (error) {
      const ms = performance.now() - start;
      const timedOut = error instanceof SqlTimeoutError;
      // `isRetryableSqlError` already returns false for `SqlTimeoutError`,
      // but the check is spelled out via `timedOut` too so the `reason`
      // below never has to guess which branch produced the error.
      const retryable = isRetryableSqlError(error);
      const willRetry = retryable && attempt <= retries;

      // onDegraded fires for the two classified degradation reasons only —
      // an unrecognised, non-retryable error (a constraint violation, an
      // auth failure, a syntax error) propagates silently, exactly as it
      // would with no resilience wrapper at all.
      if (timedOut || retryable) {
        const reason: SqlDegradationEvent['reason'] = timedOut ? 'timeout' : 'retryable-error';
        try {
          onDegraded?.({ label, kind, reason, attempt, willRetry, ms, error: describe(error) });
        } catch {
          // Degradation reporting must never break the call it wraps.
        }
      }

      if (!willRetry) throw error;
      await sleep(backoffMs);
    }
  }
}

/** Options for `withRetryableRead`. See its doc comment for the contract. */
export interface WithRetryableReadOptions {
  /** Retry attempts AFTER the first failure, retryable errors only. Default 1. */
  retries?: number;
  /** Delay before the retry, in ms. Default `DEFAULT_BACKOFF_MS` (100). */
  backoffMs?: number;
  /** Call-site label for degradation events, e.g. 'license.findActiveRefreshToken'. */
  label?: string;
  /**
   * Also retry a `SqlTimeoutError` (issue #1826). Default false. A timeout is
   * excluded from retry because it gives no evidence a WRITE did not commit;
   * for a pure read there is nothing to commit, so a caller whose `operation`
   * is a bare `SELECT` may opt in. Each attempt keeps its own timeout budget,
   * so the worst-case wait grows to `(retries + 1) × timeoutMs`.
   */
  retryTimeouts?: boolean;
  /** Invoked once per degradation event. Must NEVER throw out of the wrapper. */
  onDegraded?: (event: SqlDegradationEvent) => void;
  /** Injectable for tests. Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Caller-opt-in retry for ONE known-idempotent SQL read (issue #1371). Unlike
 * `resilientSqlClient`'s `retries`, which is a single client-wide knob shared
 * by every call a wrapped client makes — including non-idempotent writes —
 * this wraps exactly the one `operation` passed in. BY CALLING THIS, THE
 * CALLER ASSERTS `operation` IS AN IDEMPOTENT READ (e.g. a bare `SELECT`).
 * Wrapping a write here can duplicate its effect on a false retry; that is
 * exactly the risk `resilientSqlClient` avoids by defaulting `retries` to 0
 * (see the module doc above).
 *
 * Same classification as `resilientSqlClient`: retries only when
 * `isRetryableSqlError(error)` is true, which already excludes
 * `SqlTimeoutError` (no evidence a timed-out statement didn't commit — see
 * `isRetryableSqlError`'s doc) unless the caller opts in with `retryTimeouts`
 * for a pure read (issue #1826). `onDegraded` fires once per failed attempt
 * that will be retried or was the final attempt, is called synchronously,
 * and can never change the call's outcome — a throwing `onDegraded` is
 * swallowed, mirroring `resilientSqlClient`'s guarantee.
 *
 * Typical composition: the caller's `operation` runs against a `LicenseDB`
 * (or similar) that is ALREADY wrapped in `resilientSqlClient` with its own
 * `retries: 0` — so each attempt here is still individually timeout-bounded,
 * and only the OUTER retry decision is caller-scoped.
 */
export async function withRetryableRead<T>(
  operation: () => Promise<T>,
  options: WithRetryableReadOptions = {},
): Promise<T> {
  const {
    retries = 1,
    backoffMs = DEFAULT_BACKOFF_MS,
    label,
    retryTimeouts = false,
    onDegraded,
    sleep = defaultSleep,
  } = options;

  for (let attempt = 1; ; attempt++) {
    const start = performance.now();
    try {
      return await operation();
    } catch (error) {
      const ms = performance.now() - start;
      // A timeout is retryable here only when the caller opted in (#1826).
      const timedOut = retryTimeouts && error instanceof SqlTimeoutError;
      const retryable = timedOut || isRetryableSqlError(error);
      const willRetry = retryable && attempt <= retries;

      // Mirrors runResilient: onDegraded fires only for the classified
      // reason (never for an unrecognised, non-retryable error), and for a
      // SqlTimeoutError only when `retryTimeouts` made it retryable.
      if (retryable) {
        try {
          onDegraded?.({
            label,
            kind: 'execute',
            reason: timedOut ? 'timeout' : 'retryable-error',
            attempt,
            willRetry,
            ms,
            error: describe(error),
          });
        } catch {
          // Degradation reporting must never break the call it wraps.
        }
      }

      if (!willRetry) throw error;
      await sleep(backoffMs);
    }
  }
}

/**
 * Wrap a libSQL-shaped client so every `execute()`/`batch()` call is bounded
 * by `timeoutMs` and, opt-in via `retries`, retried on classified-transient
 * failures. See the module header for the full contract (composition order,
 * why timeout ≠ cancel, why retry defaults off).
 *
 * `transaction()` is wrapped too (issue #1614): the handle it resolves to is
 * re-wrapped with the same options, so statements issued INSIDE a transaction
 * carry the same budget and classification as statements issued outside one.
 *
 * `T` is preserved exactly, mirroring `instrumentSqlClient`: the Proxy is
 * cast back to `T` at the end, so a caller holding e.g. `Client` from
 * `@libsql/client` keeps that type with no cast at the call site, while this
 * module itself never imports it.
 */
export function resilientSqlClient<T extends object>(client: T, options: SqlResilienceOptions = {}): T {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    backoffMs = DEFAULT_BACKOFF_MS,
    label,
    onDegraded,
    sleep = defaultSleep,
  } = options;

  const runtime: ResilienceRuntimeOptions = { timeoutMs, retries, backoffMs, label, onDegraded, sleep };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return (stmt: unknown, args?: unknown): Promise<unknown> => {
          const execute = (target as Record<string, unknown>).execute as (...a: unknown[]) => Promise<unknown>;
          // Preserve both overloads: execute(stmt) and execute(sql, args).
          // Wrapped in `Promise.resolve().then(...)` so a SYNCHRONOUS throw
          // from a misbehaving client still becomes a rejection `invoke()`
          // can be retried/timed-out around, instead of throwing out of the
          // Proxy trap before the resilience machinery ever engages.
          const invoke = () =>
            Promise.resolve().then(() =>
              args === undefined ? execute.call(target, stmt) : execute.call(target, stmt, args),
            );
          return runResilient('execute', invoke, runtime);
        };
      }
      if (prop === 'batch') {
        return (stmts: unknown, mode?: unknown): Promise<unknown> => {
          const batch = (target as Record<string, unknown>).batch as (...a: unknown[]) => Promise<unknown>;
          const invoke = () => Promise.resolve().then(() => batch.call(target, stmts, mode));
          return runResilient('batch', invoke, runtime);
        };
      }
      // Issue #1614: statements issued through a transaction handle never
      // touch this Proxy's execute/batch traps, so the mailbox daily-send cap
      // and the scheduler's cancel/finalize transactions ran outside the
      // timeout budget and outside the retry classification. Re-wrapping the
      // handle with the SAME options bounds its execute/batch identically,
      // while commit/rollback/close fall through to the bound-original branch
      // below. Only trapped when the underlying client actually has a
      // callable `transaction` — a client without one must keep reporting it
      // absent. Acquiring the transaction is a pass-through: BEGIN is the
      // underlying client's own call, and re-issuing it on a retry would
      // silently open a second transaction.
      if (prop === 'transaction' && typeof (target as Record<string, unknown>).transaction === 'function') {
        return async (...args: unknown[]): Promise<unknown> => {
          const transaction = (target as Record<string, unknown>).transaction as (...a: unknown[]) => Promise<object>;
          return resilientSqlClient(await transaction.apply(target, args), options);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as T;
}
