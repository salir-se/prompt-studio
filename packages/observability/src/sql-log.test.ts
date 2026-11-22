// @module-tag pure
import { describe, expect, it } from 'vitest';
import { argCount, normalizeSqlText, sqlTarget } from './sql-log';

describe('normalizeSqlText', () => {
  it('collapses runs of whitespace/newlines/tabs into single spaces and trims the ends', () => {
    expect(normalizeSqlText('  SELECT  *\n FROM   leads\t WHERE id = ?  ')).toBe('SELECT * FROM leads WHERE id = ?');
  });

  it('caps the result at 200 characters', () => {
    const long = `SELECT ${'x'.repeat(300)}`;
    const out = normalizeSqlText(long);
    expect(out).toHaveLength(200);
    expect(out).toBe(long.slice(0, 200));
  });

  it('leaves an already-normalized short statement untouched', () => {
    expect(normalizeSqlText('SELECT 1')).toBe('SELECT 1');
  });
});

describe('sqlTarget', () => {
  it('derives the table name from a SELECT ... FROM', () => {
    expect(sqlTarget('SELECT data FROM "signals" ORDER BY created_at DESC', [])).toBe('signals');
  });

  it('derives the table name from an INSERT INTO', () => {
    expect(sqlTarget('INSERT INTO leads (id, data) VALUES (?, ?)', ['lead-1', '{}'])).toBe('leads');
  });

  it('derives the table name from an UPDATE', () => {
    expect(sqlTarget('UPDATE companies SET data = ? WHERE id = ?', ['{}', 'c-1'])).toBe('companies');
  });

  it('derives the table name from a DELETE FROM', () => {
    expect(sqlTarget('DELETE FROM messages WHERE id = ?', ['m-1'])).toBe('messages');
  });

  it('falls back to "(other)" when no target can be parsed', () => {
    expect(sqlTarget('PRAGMA foreign_keys = ON', [])).toBe('(other)');
  });

  it('labels a collections-table statement as collections[<key>] when the first arg is a short string key', () => {
    expect(sqlTarget('SELECT data FROM collections WHERE key = ? LIMIT 1', ['mailboxQuotaState'])).toBe(
      'collections[mailboxQuotaState]',
    );
  });

  it('falls back to bare "collections" when there is no usable string key arg', () => {
    expect(sqlTarget('SELECT data FROM collections WHERE key = ? LIMIT 1', [])).toBe('collections');
    expect(sqlTarget('SELECT data FROM collections WHERE key = ? LIMIT 1', [12345])).toBe('collections');
    expect(sqlTarget('SELECT data FROM collections WHERE key = ? LIMIT 1', ['x'.repeat(65)])).toBe('collections');
  });

  it('treats the args/key parameter as optional', () => {
    expect(sqlTarget('SELECT data FROM collections WHERE key = ? LIMIT 1')).toBe('collections');
  });
});

describe('argCount', () => {
  it('counts array args by length', () => {
    expect(argCount(['a', 'b', 'c'])).toBe(3);
    expect(argCount([])).toBe(0);
  });

  it('counts named/object args by key count', () => {
    expect(argCount({ id: '1', name: '2' })).toBe(2);
    expect(argCount({})).toBe(0);
  });

  it('returns 0 for undefined, null, and other primitives', () => {
    expect(argCount(undefined)).toBe(0);
    expect(argCount(null)).toBe(0);
    expect(argCount('str')).toBe(0);
    expect(argCount(42)).toBe(0);
  });
});
