// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import { instrumentSqlClient, type SqlDebugLogger, type SqlQuerySample } from './sql-instrumentation';

/** Same three shapes libSQL's `InStatement` union allows — matched structurally. */
type Stmt = string | [string, unknown?] | { sql: string; args?: unknown };

interface FakeResult {
  rows?: unknown[];
  rowsAffected?: number;
}

/**
 * Minimal libSQL-shaped fake: `execute`/`batch` (the two Proxy-intercepted
 * members) plus one pass-through method that reads `this` — proving the
 * fallback branch binds to the underlying `target`, not the Proxy receiver.
 */
function createFakeClient(
  overrides: Partial<{
    execute: (stmt: Stmt, args?: unknown) => Promise<FakeResult>;
    batch: (stmts: Stmt[], mode?: unknown) => Promise<FakeResult[]>;
    transaction: (mode?: unknown) => Promise<FakeTransaction>;
  }> = {},
) {
  const tx = createFakeTransaction();
  return {
    closed: false,
    execute: overrides.execute ?? (async () => ({ rows: [{ id: 1 }] })),
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
    execute: (stmt: Stmt, args?: unknown) => Promise<FakeResult>;
    batch: (stmts: Stmt[], mode?: unknown) => Promise<FakeResult[]>;
  }> = {},
) {
  return {
    lifecycle: [] as string[],
    execute: overrides.execute ?? (async () => ({ rows: [{ id: 1 }] })),
    batch: overrides.batch ?? (async (stmts: Stmt[]) => stmts.map(() => ({ rows: [] }))),
    async commit(this: { lifecycle: string[] }): Promise<void> {
      this.lifecycle.push('commit');
    },
    async rollback(this: { lifecycle: string[] }): Promise<void> {
      this.lifecycle.push('rollback');
    },
  };
}

function fakeLogger(): SqlDebugLogger & { calls: Array<{ obj: Record<string, unknown>; msg: string }> } {
  const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return {
    calls,
    debug(obj: object, msg: string) {
      calls.push({ obj: obj as Record<string, unknown>, msg });
    },
  };
}

describe('instrumentSqlClient', () => {
  it('times an execute call and reports one sample via onQuery', async () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { onQuery: (s) => samples.push(s) });

    const res = await wrapped.execute('SELECT data FROM leads WHERE id = ?', ['lead-1']);

    expect(res).toEqual({ rows: [{ id: 1 }] });
    expect(samples).toEqual([
      { target: 'leads', sql: 'SELECT data FROM leads WHERE id = ?', ms: 42, rows: 1, kind: 'execute' },
    ]);
    nowSpy.mockRestore();
  });

  it('preserves the execute(stmt) overload — no args forwarded', async () => {
    const execute = vi.fn(async (_stmt: Stmt) => ({ rows: [] }));
    const wrapped = instrumentSqlClient(createFakeClient({ execute }));

    await wrapped.execute('SELECT 1');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('SELECT 1');
  });

  it('preserves the execute(sql, args) overload', async () => {
    const execute = vi.fn(async (_stmt: Stmt, _args?: unknown) => ({ rows: [] }));
    const wrapped = instrumentSqlClient(createFakeClient({ execute }));

    await wrapped.execute('SELECT * FROM leads WHERE id = ?', ['lead-1']);

    expect(execute).toHaveBeenCalledWith('SELECT * FROM leads WHERE id = ?', ['lead-1']);
  });

  // Parity with both existing implementations: they derive the logged arg
  // count from the statement handed to execute(), never from a same-call
  // second parameter — so the two-argument overload logs argCount 0.
  it('logs argCount 0 for the execute(sql, args) overload, since args live in the second call parameter, not the statement', async () => {
    const logger = fakeLogger();
    const wrapped = instrumentSqlClient(createFakeClient(), { logger });

    await wrapped.execute('SELECT * FROM leads WHERE id = ?', ['lead-1']);

    expect(logger.calls[0].obj).toMatchObject({ sql: 'SELECT * FROM leads WHERE id = ?', args: 0 });
  });

  it('divides elapsed time evenly across batch statements and reports one sample per statement', async () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(2000).mockReturnValueOnce(2100);
    const client = createFakeClient({
      batch: async (stmts: Stmt[]) => stmts.map((_, i) => ({ rows: i === 0 ? [{}, {}] : [] })),
    });
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(client, { onQuery: (s) => samples.push(s) });

    const res = await wrapped.batch(['SELECT * FROM signals', 'DELETE FROM leads WHERE id = ?']);

    expect(res).toEqual([{ rows: [{}, {}] }, { rows: [] }]);
    expect(samples).toEqual([
      { target: 'signals', sql: 'SELECT * FROM signals', ms: 50, rows: 2, kind: 'batch' },
      { target: 'leads', sql: 'DELETE FROM leads WHERE id = ?', ms: 50, rows: 0, kind: 'batch' },
    ]);
    nowSpy.mockRestore();
  });

  it('extracts sql/target from a bare string statement', async () => {
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { onQuery: (s) => samples.push(s) });

    await wrapped.execute('SELECT data FROM companies');

    expect(samples[0]).toMatchObject({ sql: 'SELECT data FROM companies', target: 'companies' });
  });

  it('extracts sql/target from a [sql, args] tuple statement', async () => {
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { onQuery: (s) => samples.push(s) });

    await wrapped.execute(['UPDATE companies SET data = ? WHERE id = ?', ['{}', 'c-1']]);

    expect(samples[0]).toMatchObject({ sql: 'UPDATE companies SET data = ? WHERE id = ?', target: 'companies' });
  });

  it('extracts sql/target from an { sql, args } object statement', async () => {
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { onQuery: (s) => samples.push(s) });

    await wrapped.execute({ sql: 'INSERT INTO orders (id) VALUES (?)', args: ['o-1'] });

    expect(samples[0]).toMatchObject({ sql: 'INSERT INTO orders (id) VALUES (?)', target: 'orders' });
  });

  it('reports rows: 0 for a write result with no rows field', async () => {
    const execute = vi.fn(async () => ({ rowsAffected: 1 }) as FakeResult);
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient({ execute }), { onQuery: (s) => samples.push(s) });

    await wrapped.execute('DELETE FROM leads WHERE id = ?', ['lead-1']);

    expect(samples[0]).toMatchObject({ rows: 0 });
  });

  it('does not let a throwing onQuery affect the call result', async () => {
    const wrapped = instrumentSqlClient(createFakeClient(), {
      onQuery: () => {
        throw new Error('reporter blew up');
      },
    });

    await expect(wrapped.execute('SELECT 1')).resolves.toEqual({ rows: [{ id: 1 }] });
  });

  it('does not let a throwing logger affect the call result', async () => {
    const logger: SqlDebugLogger = {
      debug: () => {
        throw new Error('logger blew up');
      },
    };
    const wrapped = instrumentSqlClient(createFakeClient(), { logger });

    await expect(wrapped.execute('SELECT 1')).resolves.toEqual({ rows: [{ id: 1 }] });
  });

  it('resolves execute with the underlying result even when the statement shape breaks sample construction (non-string sql)', async () => {
    const stubResult = { rows: [{ id: 1 }] };
    const execute = vi.fn(async () => stubResult);
    const logger: SqlDebugLogger = {
      debug: () => {
        throw new Error('logger blew up');
      },
    };
    const wrapped = instrumentSqlClient(createFakeClient({ execute }), {
      logger,
      onQuery: () => {
        throw new Error('reporter blew up');
      },
    });

    // A malformed statement — `sql` is not a string — makes normalizeSqlText()
    // throw while building the sample. That must not turn this already-
    // successful query into a rejection.
    const badStmt = { sql: 123 } as unknown as Stmt;

    await expect(wrapped.execute(badStmt)).resolves.toBe(stubResult);
  });

  it('resolves batch with the underlying results even when one statement among good ones breaks sample construction', async () => {
    const stubResults: FakeResult[] = [{ rows: [{ id: 1 }] }, { rows: [] }, { rows: [{ id: 2 }] }];
    const batch = vi.fn(async () => stubResults);
    const samples: SqlQuerySample[] = [];
    const logger = fakeLogger();
    const wrapped = instrumentSqlClient(createFakeClient({ batch }), {
      logger,
      onQuery: (s) => samples.push(s),
    });

    const badStmt = { sql: 123 } as unknown as Stmt;
    const goodStmts: Stmt[] = ['SELECT * FROM signals', badStmt, 'SELECT * FROM leads'];

    await expect(wrapped.batch(goodStmts)).resolves.toBe(stubResults);
    // The bad statement's own report is swallowed, but the good ones on
    // either side of it are still reported — one throwing sample doesn't
    // take out its siblings.
    expect(samples.map((s) => s.target)).toEqual(['signals', 'leads']);
  });

  it('propagates a rejecting underlying execute unchanged', async () => {
    const boom = new Error('connection reset');
    const execute = vi.fn(async () => {
      throw boom;
    });
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient({ execute }), { onQuery: (s) => samples.push(s) });

    await expect(wrapped.execute('SELECT 1')).rejects.toBe(boom);
    expect(samples).toEqual([]); // Never reached — the rejection happens before reporting.
  });

  it('passes through non-instrumented properties, bound to the underlying client', () => {
    const wrapped = instrumentSqlClient(createFakeClient());

    // isClosed() destructures `this` off the Proxy; if the fallback branch
    // did not bind to `target`, this call would lose its receiver and throw.
    expect(wrapped.isClosed()).toBe(false);
  });

  it('never includes arg VALUES in the reported sample or the log line', async () => {
    const logger = fakeLogger();
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { logger, onQuery: (s) => samples.push(s) });

    // Args travel embedded in the statement (tuple form) — same as the two
    // existing implementations, whose `emit`/`report` derives args from the
    // statement, not from a same-call second parameter.
    await wrapped.execute(['INSERT INTO contacts (email) VALUES (?)', ['super-secret@example.com']]);

    expect(JSON.stringify(samples[0])).not.toContain('super-secret');
    expect(JSON.stringify(logger.calls[0].obj)).not.toContain('super-secret');
    expect(logger.calls[0].obj.args).toBe(1); // count only
  });

  it('logs the default "turso.sql" message with the expected field shape', async () => {
    const logger = fakeLogger();
    const wrapped = instrumentSqlClient(createFakeClient(), { logger });

    await wrapped.execute(['SELECT data FROM leads WHERE id = ?', ['lead-1']]);

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].msg).toBe('turso.sql');
    expect(logger.calls[0].obj).toMatchObject({
      target: 'leads',
      sql: 'SELECT data FROM leads WHERE id = ?',
      args: 1,
      rows: 1,
      kind: 'execute',
    });
    expect(typeof logger.calls[0].obj.ms).toBe('number');
  });

  it('honors a custom log message', async () => {
    const logger = fakeLogger();
    const wrapped = instrumentSqlClient(createFakeClient(), { logger, message: 'groupdb.sql' });

    await wrapped.execute('SELECT 1');

    expect(logger.calls[0].msg).toBe('groupdb.sql');
  });

  // Issue #1614: both proxies trapped only execute/batch, so every statement
  // issued through a transaction handle escaped instrumentation entirely —
  // the mailbox daily-send cap and the scheduler's cancel/finalize
  // transactions were invisible to the per-request `db.query` span.
  it('#1614: reports a sample for a statement executed inside transaction()', async () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { onQuery: (s) => samples.push(s) });

    const tx = await wrapped.transaction();
    const res = await tx.execute('UPDATE mailboxQuotaState SET data = ? WHERE id = ?');
    await tx.commit();

    expect(res).toEqual({ rows: [{ id: 1 }] });
    expect(samples).toEqual([
      {
        target: 'mailboxQuotaState',
        sql: 'UPDATE mailboxQuotaState SET data = ? WHERE id = ?',
        ms: 42,
        rows: 1,
        kind: 'execute',
      },
    ]);
    nowSpy.mockRestore();
  });

  it('#1614: reports one sample per statement for a batch issued inside transaction()', async () => {
    const samples: SqlQuerySample[] = [];
    const wrapped = instrumentSqlClient(createFakeClient(), { onQuery: (s) => samples.push(s) });

    const tx = await wrapped.transaction('write');
    await tx.batch(['SELECT * FROM signals', 'DELETE FROM leads WHERE id = ?']);

    expect(samples.map((s) => s.target)).toEqual(['signals', 'leads']);
    expect(samples.every((s) => s.kind === 'batch')).toBe(true);
  });

  it('#1614: debug-logs a statement executed inside transaction() with the same field shape', async () => {
    const logger = fakeLogger();
    const wrapped = instrumentSqlClient(createFakeClient(), { logger, message: 'groupdb.sql' });

    const tx = await wrapped.transaction();
    await tx.execute(['SELECT data FROM leads WHERE id = ?', ['lead-1']]);

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].msg).toBe('groupdb.sql');
    expect(logger.calls[0].obj).toMatchObject({ target: 'leads', args: 1, rows: 1, kind: 'execute' });
  });

  it("#1614: passes the transaction handle's commit/rollback through, bound to the underlying handle", async () => {
    const handle = createFakeTransaction();
    const wrapped = instrumentSqlClient(createFakeClient({ transaction: async () => handle }));

    const tx = await wrapped.transaction();
    await tx.commit();
    await tx.rollback();

    expect(handle.lifecycle).toEqual(['commit', 'rollback']);
  });

  it('#1614: forwards the transaction() mode argument unchanged', async () => {
    const transaction = vi.fn(async (_mode?: unknown) => createFakeTransaction());
    const wrapped = instrumentSqlClient(createFakeClient({ transaction }));

    await wrapped.transaction('write');

    expect(transaction).toHaveBeenCalledWith('write');
  });

  it('#1614: leaves a client without transaction() untouched — the member stays absent', () => {
    const { transaction: _omitted, ...clientWithoutTransaction } = createFakeClient();
    const wrapped = instrumentSqlClient(clientWithoutTransaction);

    expect((wrapped as { transaction?: unknown }).transaction).toBeUndefined();
  });

  it('is silent (no logger, no onQuery) by default', async () => {
    const wrapped = instrumentSqlClient(createFakeClient());

    await expect(wrapped.execute('SELECT 1')).resolves.toEqual({ rows: [{ id: 1 }] });
  });
});
