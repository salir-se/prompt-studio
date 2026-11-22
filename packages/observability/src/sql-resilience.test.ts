// @module-tag pure
import { afterEach, describe, expect, it, vi } from 'vitest';
import { instrumentSqlClient, type SqlQuerySample } from './sql-instrumentation';
import {
  isRetryableSqlError,
  resilientSqlClient,
  type SqlDegradationEvent,
  SqlTimeoutError,
  withRetryableRead,
} from './sql-resilience';

/** Same three shapes libSQL's `InStatement` union allows — matched structurally. */
type Stmt = string | [string, unknown?] | { sql: string; args?: unknown };

/** Instant backoff — skips the real `setTimeout` delay so retry tests stay fast without fake timers. */
const noBackoff = async (): Promise<void> => {};

/** Build a libsql-`LibsqlError`-shaped error by structure only (never import `@libsql/client`). */
function serverError(status: number): Error & { code: string } {
  return Object.assign(new Error(`SERVER_ERROR: Server returned HTTP status ${status}`), { code: 'SERVER_ERROR' });
}

/**
 * Minimal libSQL-shaped fake: `execute`/`batch` (the two Proxy-intercepted
 * members) plus one pass-through method that reads `this` — proving the
 * fallback branch binds to the underlying `target`, not the Proxy receiver.
 */
function createFakeClient(
  overrides: Partial<{
    execute: (stmt: Stmt, args?: unknown) => Promise<unknown>;
    batch: (stmts: Stmt[], mode?: unknown) => Promise<unknown>;
    transaction: (mode?: unknown) => Promise<FakeTransaction>;
  }> = {},
) {
  const tx = createFakeTransaction();
  return {
    closed: false,
    execute: overrides.execute ?? (async () => ({ rows: [] })),
    batch: overrides.batch ?? (async (stmts: Stmt[]) => stmts.map(() => ({ rows: [] }))),
    transaction: overrides.transaction ?? (async () => tx),
    isClosed(this: { closed: boolean }): boolean {
      return this.closed;
    },
  };
}

type FakeTransaction = ReturnType<typeof createFakeTransaction>;

/**
 * Minimal libSQL-shaped transaction handle: the same `execute`/`batch` pair
 * plus the `commit`/`rollback` lifecycle members, which read `this` so a
 * pass-through that lost its receiver would throw (issue #1614).
 */
function createFakeTransaction(
  overrides: Partial<{
    execute: (stmt: Stmt, args?: unknown) => Promise<unknown>;
    batch: (stmts: Stmt[], mode?: unknown) => Promise<unknown>;
  }> = {},
) {
  return {
    lifecycle: [] as string[],
    execute: overrides.execute ?? (async () => ({ rows: [] })),
    batch: overrides.batch ?? (async (stmts: Stmt[]) => stmts.map(() => ({ rows: [] }))),
    async commit(this: { lifecycle: string[] }): Promise<void> {
      this.lifecycle.push('commit');
    },
    async rollback(this: { lifecycle: string[] }): Promise<void> {
      this.lifecycle.push('rollback');
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('isRetryableSqlError', () => {
  it('treats a bare TypeError (fetch network failure) as retryable', () => {
    expect(isRetryableSqlError(new TypeError('fetch failed'))).toBe(true);
  });

  it.each(['fetch failed', 'ECONNRESET', 'socket hang up', 'network error'])(
    'treats a message containing "%s" as retryable',
    (fragment) => {
      expect(isRetryableSqlError(new Error(fragment))).toBe(true);
    },
  );

  it.each([500, 502, 503, 504, 520, 521, 522, 523, 524])(
    'treats a SERVER_ERROR carrying HTTP status %d as retryable',
    (status) => {
      expect(isRetryableSqlError(serverError(status))).toBe(true);
    },
  );

  it('does not treat a SERVER_ERROR with a non-listed status as retryable', () => {
    expect(isRetryableSqlError(serverError(400))).toBe(false);
  });

  it('does not treat a constraint violation as retryable', () => {
    expect(
      isRetryableSqlError(Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })),
    ).toBe(false);
  });

  it('does not treat an auth error (code) as retryable', () => {
    expect(isRetryableSqlError(Object.assign(new Error('not authorized'), { code: 'UNAUTHORIZED' }))).toBe(false);
  });

  it('does not treat a 401/403 message as retryable', () => {
    expect(isRetryableSqlError(new Error('request failed: 401 Unauthorized'))).toBe(false);
    expect(isRetryableSqlError(new Error('request failed: 403 Forbidden'))).toBe(false);
  });

  it('does not treat a SQL syntax/parse error as retryable', () => {
    expect(isRetryableSqlError(Object.assign(new Error('near "SELCT": syntax error'), { code: 'SQLITE_ERROR' }))).toBe(
      false,
    );
  });

  it('does not treat SqlTimeoutError as retryable', () => {
    expect(isRetryableSqlError(new SqlTimeoutError('resilientSqlClient: execute timed out after 5000ms'))).toBe(false);
  });

  it('defaults unrecognised errors to NOT retryable', () => {
    expect(isRetryableSqlError(new Error('something odd happened'))).toBe(false);
    expect(isRetryableSqlError('not even an Error')).toBe(false);
    expect(isRetryableSqlError(undefined)).toBe(false);
  });
});

describe('resilientSqlClient — timeout', () => {
  it('rejects with SqlTimeoutError when the underlying execute hangs past timeoutMs', async () => {
    vi.useFakeTimers();
    const hang = new Promise(() => {}); // never settles — models the 73s hung insert from #1342
    const execute = vi.fn(() => hang);
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { timeoutMs: 5000, label: 'license' });

    const assertion = expect(wrapped.execute('INSERT INTO refresh_tokens (id) VALUES (?)', ['t-1'])).rejects.toThrow(
      SqlTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('names the label, the kind, and the elapsed budget in the SqlTimeoutError message', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(() => new Promise(() => {}));
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { timeoutMs: 1234, label: 'license' });

    let caught: unknown;
    const pending = wrapped.execute('SELECT 1').catch((e) => {
      caught = e;
    });
    await vi.advanceTimersByTimeAsync(1234);
    await pending;

    expect((caught as Error).message).toContain('license');
    expect((caught as Error).message).toContain('execute');
    expect((caught as Error).message).toContain('1234');
  });

  it('does not reject before the budget elapses', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(() => new Promise(() => {}));
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { timeoutMs: 5000 });

    let settled = false;
    wrapped.execute('SELECT 1').then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('resolves normally when the underlying call finishes within the budget', async () => {
    const execute = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { timeoutMs: 5000 });

    await expect(wrapped.execute('SELECT 1')).resolves.toEqual({ rows: [{ id: 1 }] });
  });

  it('does not let the losing (timed-out) attempt surface as an unhandled rejection', async () => {
    vi.useFakeTimers();
    const hang = () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('late transport failure')), 10_000);
      });
    const wrapped = resilientSqlClient(createFakeClient({ execute: hang }), { timeoutMs: 5000 });

    const assertion = expect(wrapped.execute('SELECT 1')).rejects.toThrow(SqlTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    // Let the losing promise's eventual rejection fire; a listener for
    // vitest/node's unhandledRejection would otherwise fail this test run.
    await vi.advanceTimersByTimeAsync(5000);
  });

  it('applies the same timeout treatment to batch', async () => {
    vi.useFakeTimers();
    const batch = vi.fn(() => new Promise(() => {}));
    const wrapped = resilientSqlClient(createFakeClient({ batch }), { timeoutMs: 2000, label: 'license' });

    const assertion = expect(wrapped.batch(['SELECT 1', 'SELECT 2'])).rejects.toThrow(SqlTimeoutError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});

describe('resilientSqlClient — retry', () => {
  it('does NOT retry by default (retries: 0), even for a retryable 5xx', async () => {
    const err = serverError(520);
    const execute = vi.fn().mockRejectedValueOnce(err);
    const wrapped = resilientSqlClient(createFakeClient({ execute }));

    await expect(wrapped.execute('SELECT 1')).rejects.toBe(err);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries once on a retryable SERVER_ERROR (520) and resolves on the second attempt', async () => {
    const err = serverError(520);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { retries: 1, sleep: noBackoff });

    await expect(wrapped.execute('SELECT 1')).resolves.toEqual({ rows: [{ id: 1 }] });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a constraint violation, propagating the identical error after exactly one attempt', async () => {
    const err = Object.assign(new Error('UNIQUE constraint failed: leads.email'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const execute = vi.fn().mockRejectedValueOnce(err);
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { retries: 1, sleep: noBackoff });

    await expect(wrapped.execute('INSERT INTO leads (email) VALUES (?)', ['a@b.com'])).rejects.toBe(err);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry SqlTimeoutError even with retries: 1', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(() => new Promise(() => {}));
    const wrapped = resilientSqlClient(createFakeClient({ execute }), {
      timeoutMs: 1000,
      retries: 1,
      sleep: noBackoff,
    });

    const assertion = expect(wrapped.execute('SELECT 1')).rejects.toThrow(SqlTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and rejects with the final error when every attempt is retryable and fails', async () => {
    const err1 = serverError(502);
    const err2 = serverError(503);
    const execute = vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { retries: 1, sleep: noBackoff });

    await expect(wrapped.execute('SELECT 1')).rejects.toBe(err2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('waits backoffMs (via the injectable sleep) before each retry', async () => {
    const err = serverError(520);
    const execute = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] });
    const sleepCalls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { retries: 1, backoffMs: 250, sleep });

    await wrapped.execute('SELECT 1');

    expect(sleepCalls).toEqual([250]);
  });

  it('applies the same retry treatment to batch', async () => {
    const err = serverError(520);
    const batch = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce([{ rows: [] }]);
    const wrapped = resilientSqlClient(createFakeClient({ batch }), { retries: 1, sleep: noBackoff });

    await expect(wrapped.batch(['SELECT 1'])).resolves.toEqual([{ rows: [] }]);
    expect(batch).toHaveBeenCalledTimes(2);
  });
});

describe('resilientSqlClient — overloads and pass-through', () => {
  it('preserves the execute(stmt) overload — no args forwarded', async () => {
    const execute = vi.fn(async (_stmt: Stmt) => ({ rows: [] }));
    const wrapped = resilientSqlClient(createFakeClient({ execute }));

    await wrapped.execute('SELECT 1');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('SELECT 1');
  });

  it('preserves the execute(sql, args) overload', async () => {
    const execute = vi.fn(async (_stmt: Stmt, _args?: unknown) => ({ rows: [] }));
    const wrapped = resilientSqlClient(createFakeClient({ execute }));

    await wrapped.execute('SELECT * FROM leads WHERE id = ?', ['lead-1']);

    expect(execute).toHaveBeenCalledWith('SELECT * FROM leads WHERE id = ?', ['lead-1']);
  });

  it('forwards batch statements and mode unchanged', async () => {
    const batch = vi.fn(async (stmts: Stmt[]) => stmts.map(() => ({ rows: [] })));
    const wrapped = resilientSqlClient(createFakeClient({ batch }));

    await wrapped.batch(['SELECT 1', 'SELECT 2'], 'write');

    expect(batch).toHaveBeenCalledWith(['SELECT 1', 'SELECT 2'], 'write');
  });

  it('passes through non-instrumented properties, bound to the underlying client', () => {
    const wrapped = resilientSqlClient(createFakeClient());

    // isClosed() destructures `this` off the Proxy; if the fallback branch
    // did not bind to `target`, this call would lose its receiver and throw.
    expect(wrapped.isClosed()).toBe(false);
  });
});

describe('resilientSqlClient — onDegraded', () => {
  it('fires once for a timeout, with attempt 1 / willRetry false / reason timeout', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(() => new Promise(() => {}));
    const events: SqlDegradationEvent[] = [];
    const wrapped = resilientSqlClient(createFakeClient({ execute }), {
      timeoutMs: 1000,
      label: 'license',
      onDegraded: (e) => events.push(e),
    });

    const assertion = expect(wrapped.execute('SELECT 1')).rejects.toThrow(SqlTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      label: 'license',
      kind: 'execute',
      reason: 'timeout',
      attempt: 1,
      willRetry: false,
    });
    expect(typeof events[0].ms).toBe('number');
  });

  it('fires once for a retryable error that is about to be retried, with willRetry true', async () => {
    const err = serverError(520);
    const execute = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] });
    const events: SqlDegradationEvent[] = [];
    const wrapped = resilientSqlClient(createFakeClient({ execute }), {
      retries: 1,
      sleep: noBackoff,
      onDegraded: (e) => events.push(e),
    });

    await wrapped.execute('SELECT 1');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'execute', reason: 'retryable-error', attempt: 1, willRetry: true });
    expect(events[0].error).toContain('520');
  });

  it('does not fire for a non-retryable, non-timeout error (e.g. a constraint violation)', async () => {
    const err = Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const execute = vi.fn().mockRejectedValueOnce(err);
    const events: SqlDegradationEvent[] = [];
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { onDegraded: (e) => events.push(e) });

    await expect(wrapped.execute('SELECT 1')).rejects.toBe(err);
    expect(events).toHaveLength(0);
  });

  it('swallows a throwing onDegraded without changing the wrapped call outcome', async () => {
    const err = serverError(520);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rows: [{ ok: true }] });
    const onDegraded = vi.fn(() => {
      throw new Error('onDegraded blew up');
    });
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { retries: 1, sleep: noBackoff, onDegraded });

    await expect(wrapped.execute('SELECT 1')).resolves.toEqual({ rows: [{ ok: true }] });
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });

  it('a throwing onDegraded on the final, retries-exhausted failure still lets the original error propagate', async () => {
    const serverErr = serverError(503);
    const execute = vi.fn().mockRejectedValue(serverErr);
    const onDegraded = vi.fn(() => {
      throw new Error('onDegraded blew up');
    });
    const wrapped = resilientSqlClient(createFakeClient({ execute }), { retries: 1, sleep: noBackoff, onDegraded });

    await expect(wrapped.execute('SELECT 1')).rejects.toBe(serverErr);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(onDegraded).toHaveBeenCalledTimes(2);
  });
});

describe('resilientSqlClient — composes with instrumentSqlClient', () => {
  it('resilience wrapped OUTSIDE instrumentation: a retried batch attempt still reports one onQuery sample per statement on the successful attempt', async () => {
    const err = serverError(520);
    const batch = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce([{ rows: [] }, { rows: [] }]);
    const samples: SqlQuerySample[] = [];
    const instrumented = instrumentSqlClient(createFakeClient({ batch }), { onQuery: (s) => samples.push(s) });
    const wrapped = resilientSqlClient(instrumented, { retries: 1, sleep: noBackoff });

    await wrapped.batch(['SELECT * FROM signals', 'SELECT * FROM leads']);

    // The failed first attempt reports nothing (instrumentSqlClient only
    // reports a statement AFTER its underlying call resolves) — the two
    // samples both come from the single successful second attempt, one per
    // statement in that batch call.
    expect(batch).toHaveBeenCalledTimes(2);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.target)).toEqual(['signals', 'leads']);
  });

  it('close() and other pass-through members still work when composed with instrumentSqlClient', () => {
    const instrumented = instrumentSqlClient(createFakeClient());
    const wrapped = resilientSqlClient(instrumented);

    expect(wrapped.isClosed()).toBe(false);
  });
});

/**
 * Issue #1614: both proxies trapped only execute/batch, so statements issued
 * through a transaction handle — the mailbox daily-send cap, the scheduler's
 * cancel/finalize transactions — ran outside the timeout budget and outside
 * the retry classification ADR-267 requires of every DB call.
 */
describe('resilientSqlClient — statements inside transaction()', () => {
  it('#1614: bounds a statement executed inside transaction() with the timeout budget', async () => {
    vi.useFakeTimers();
    const handle = createFakeTransaction({ execute: () => new Promise(() => {}) });
    const events: SqlDegradationEvent[] = [];
    const wrapped = resilientSqlClient(createFakeClient({ transaction: async () => handle }), {
      timeoutMs: 1000,
      label: 'scheduler',
      onDegraded: (e) => events.push(e),
    });

    const tx = await wrapped.transaction();
    const assertion = expect(tx.execute('UPDATE schedulerExecutions SET data = ?')).rejects.toThrow(SqlTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ label: 'scheduler', kind: 'execute', reason: 'timeout', willRetry: false });
  });

  it('#1614: applies the retry classification to a transient error inside transaction()', async () => {
    const err = serverError(520);
    const execute = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] });
    const handle = createFakeTransaction({ execute });
    const events: SqlDegradationEvent[] = [];
    const wrapped = resilientSqlClient(createFakeClient({ transaction: async () => handle }), {
      retries: 1,
      sleep: noBackoff,
      onDegraded: (e) => events.push(e),
    });

    const tx = await wrapped.transaction();
    await expect(tx.execute('SELECT 1')).resolves.toEqual({ rows: [] });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'retryable-error', attempt: 1, willRetry: true });
  });

  it('#1614: does NOT retry a constraint violation raised inside transaction()', async () => {
    const err = Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const execute = vi.fn().mockRejectedValue(err);
    const handle = createFakeTransaction({ execute });
    const wrapped = resilientSqlClient(createFakeClient({ transaction: async () => handle }), {
      retries: 1,
      sleep: noBackoff,
    });

    const tx = await wrapped.transaction();
    await expect(tx.execute('INSERT INTO leads (id) VALUES (?)')).rejects.toBe(err);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('#1614: bounds a batch issued inside transaction()', async () => {
    vi.useFakeTimers();
    const handle = createFakeTransaction({ batch: () => new Promise(() => {}) });
    const wrapped = resilientSqlClient(createFakeClient({ transaction: async () => handle }), { timeoutMs: 500 });

    const tx = await wrapped.transaction();
    const assertion = expect(tx.batch(['SELECT 1'])).rejects.toThrow(SqlTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("#1614: passes the transaction handle's commit/rollback through, bound to the underlying handle", async () => {
    const handle = createFakeTransaction();
    const wrapped = resilientSqlClient(createFakeClient({ transaction: async () => handle }));

    const tx = await wrapped.transaction();
    await tx.commit();
    await tx.rollback();

    expect(handle.lifecycle).toEqual(['commit', 'rollback']);
  });

  it('#1614: leaves a client without transaction() untouched — the member stays absent', () => {
    const { transaction: _omitted, ...clientWithoutTransaction } = createFakeClient();
    const wrapped = resilientSqlClient(clientWithoutTransaction);

    expect((wrapped as { transaction?: unknown }).transaction).toBeUndefined();
  });

  it('#1614: composed with instrumentSqlClient, a statement inside transaction() is both timed and bounded', async () => {
    const err = serverError(520);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const handle = createFakeTransaction({ execute });
    const samples: SqlQuerySample[] = [];
    const instrumented = instrumentSqlClient(createFakeClient({ transaction: async () => handle }), {
      onQuery: (s) => samples.push(s),
    });
    const wrapped = resilientSqlClient(instrumented, { retries: 1, sleep: noBackoff });

    const tx = await wrapped.transaction();
    await tx.execute('UPDATE mailboxQuotaState SET data = ?');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ target: 'mailboxQuotaState', kind: 'execute', rows: 1 });
  });
});

describe('withRetryableRead', () => {
  it('retries a retryable error once (default retries: 1) and resolves on the second attempt', async () => {
    const err = serverError(520);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await expect(withRetryableRead(operation, { sleep: noBackoff })).resolves.toEqual({ rows: [{ id: 1 }] });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('resolves immediately without retrying when the operation succeeds on the first attempt', async () => {
    const operation = vi.fn().mockResolvedValueOnce({ rows: [] });
    const onDegraded = vi.fn();

    await expect(withRetryableRead(operation, { onDegraded, sleep: noBackoff })).resolves.toEqual({ rows: [] });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('does NOT retry a constraint violation, propagating the identical error after exactly one attempt', async () => {
    const err = Object.assign(new Error('UNIQUE constraint failed: refresh_tokens.token_hash'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    const operation = vi.fn().mockRejectedValueOnce(err);

    await expect(withRetryableRead(operation, { sleep: noBackoff })).rejects.toBe(err);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry SqlTimeoutError even with the default retries', async () => {
    const err = new SqlTimeoutError('resilientSqlClient [license]: execute timed out after 5000ms');
    const operation = vi.fn().mockRejectedValueOnce(err);

    await expect(withRetryableRead(operation, { sleep: noBackoff })).rejects.toBe(err);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  // Issue #1826: a Platform DB read stalled 5-8 s and hit the 5 s budget; the
  // caller asserted an idempotent read, so a timeout's commit ambiguity is moot.
  it('#1826: retries a SqlTimeoutError when the caller opts in with retryTimeouts', async () => {
    const err = new SqlTimeoutError('resilientSqlClient [bff]: execute timed out after 5000ms');
    const operation = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const events: SqlDegradationEvent[] = [];

    await expect(
      withRetryableRead(operation, { retryTimeouts: true, sleep: noBackoff, onDegraded: (e) => events.push(e) }),
    ).resolves.toEqual({ rows: [{ id: 1 }] });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'timeout', attempt: 1, willRetry: true });
  });

  it('#1826: retryTimeouts still stops after the retry budget and rejects with the final timeout', async () => {
    const first = new SqlTimeoutError('timed out 1');
    const second = new SqlTimeoutError('timed out 2');
    const operation = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second);

    await expect(withRetryableRead(operation, { retryTimeouts: true, sleep: noBackoff })).rejects.toBe(second);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('honours backoffMs via the injectable sleep before retrying', async () => {
    const err = serverError(520);
    const operation = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] });
    const sleepCalls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });

    await withRetryableRead(operation, { backoffMs: 250, sleep });

    expect(sleepCalls).toEqual([250]);
  });

  it('exhausts retries and rejects with the final error when every attempt is retryable and fails', async () => {
    const err1 = serverError(502);
    const err2 = serverError(503);
    const operation = vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);

    await expect(withRetryableRead(operation, { retries: 1, sleep: noBackoff })).rejects.toBe(err2);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('honours a retries: 0 override — no retry even for a retryable error', async () => {
    const err = serverError(520);
    const operation = vi.fn().mockRejectedValueOnce(err);

    await expect(withRetryableRead(operation, { retries: 0, sleep: noBackoff })).rejects.toBe(err);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('emits onDegraded with a 1-based attempt, willRetry, reason, and message-text-only error', async () => {
    const err = serverError(520);
    const operation = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] });
    const events: SqlDegradationEvent[] = [];

    await withRetryableRead(operation, {
      label: 'license.findActiveRefreshToken',
      sleep: noBackoff,
      onDegraded: (e) => events.push(e),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      label: 'license.findActiveRefreshToken',
      kind: 'execute',
      reason: 'retryable-error',
      attempt: 1,
      willRetry: true,
    });
    expect(events[0].error).toBe(err.message);
    expect(typeof events[0].ms).toBe('number');
  });

  it('does not fire onDegraded for a non-retryable, non-timeout error', async () => {
    const err = Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const operation = vi.fn().mockRejectedValueOnce(err);
    const events: SqlDegradationEvent[] = [];

    await expect(withRetryableRead(operation, { onDegraded: (e) => events.push(e), sleep: noBackoff })).rejects.toBe(
      err,
    );
    expect(events).toHaveLength(0);
  });

  it('fires onDegraded with willRetry:false on the final, retries-exhausted attempt', async () => {
    const err1 = serverError(502);
    const err2 = serverError(503);
    const operation = vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);
    const events: SqlDegradationEvent[] = [];

    await expect(
      withRetryableRead(operation, { retries: 1, sleep: noBackoff, onDegraded: (e) => events.push(e) }),
    ).rejects.toBe(err2);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ attempt: 1, willRetry: true });
    expect(events[1]).toMatchObject({ attempt: 2, willRetry: false });
  });

  it('swallows a throwing onDegraded without changing the call outcome', async () => {
    const err = serverError(520);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rows: [{ ok: true }] });
    const onDegraded = vi.fn(() => {
      throw new Error('onDegraded blew up');
    });

    await expect(withRetryableRead(operation, { sleep: noBackoff, onDegraded })).resolves.toEqual({
      rows: [{ ok: true }],
    });
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });

  it('a throwing onDegraded on the final, retries-exhausted failure still lets the original error propagate', async () => {
    const serverErr = serverError(503);
    const operation = vi.fn().mockRejectedValue(serverErr);
    const onDegraded = vi.fn(() => {
      throw new Error('onDegraded blew up');
    });

    await expect(withRetryableRead(operation, { retries: 1, sleep: noBackoff, onDegraded })).rejects.toBe(serverErr);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onDegraded).toHaveBeenCalledTimes(2);
  });
});
