// @module-tag pure
import { describe, expect, it } from 'vitest';
import { logFields } from './log-fields';

describe('logFields().pick — arktype-projected, resilient log context', () => {
  it('keeps declared keys and strips undeclared ones (whitelist)', () => {
    const Ctx = logFields({ 'userId?': 'string', 'workspaceId?': 'string' });
    const out = Ctx.pick({ userId: 'u1', workspaceId: 'w1', secret: 'leak', huge: { a: 1 } });
    expect(out).toEqual({ userId: 'u1', workspaceId: 'w1' });
  });

  it('omits declared-but-absent optional keys without erroring', () => {
    const Ctx = logFields({ 'userId?': 'string', 'orgId?': 'string' });
    expect(Ctx.pick({ userId: 'u1' })).toEqual({ userId: 'u1' });
  });

  it('returns {} for non-object ctx (null, undefined, string, number)', () => {
    const Ctx = logFields({ 'userId?': 'string' });
    expect(Ctx.pick(null)).toEqual({});
    expect(Ctx.pick(undefined)).toEqual({});
    expect(Ctx.pick('nope')).toEqual({});
    expect(Ctx.pick(42)).toEqual({});
  });

  it('never throws on a type mismatch — falls back to a best-effort whitelist pick', () => {
    const Ctx = logFields({ 'userId?': 'string', 'count?': 'number' });
    // userId is the wrong type (object) — must not throw; still whitelists declared keys.
    const out = Ctx.pick({ userId: { nested: true }, count: 3, extra: 'dropped' });
    expect(() => Ctx.pick({ userId: 1 })).not.toThrow();
    expect(out).toHaveProperty('count', 3);
    expect(out).not.toHaveProperty('extra');
  });

  it('applies arktype morphs/coercion on the happy path', () => {
    const Ctx = logFields({ 'when?': 'string.date.parse' });
    const out = Ctx.pick({ when: '2026-06-20T00:00:00.000Z' });
    expect(out.when).toBeInstanceOf(Date);
  });

  it('strips required-key declarations of their "?" when picking on fallback', () => {
    const Ctx = logFields({ userId: 'string' });
    // wrong type forces the fallback path; the required key is still whitelisted.
    const out = Ctx.pick({ userId: 123, drop: 'x' });
    expect(out).toEqual({ userId: 123 });
  });

  it('is resilient to an exotic ctx (no throw, returns an object)', () => {
    const Ctx = logFields({ 'a?': 'string' });
    const weird = Object.create(null);
    weird.a = 'ok';
    weird.b = 'drop';
    expect(() => Ctx.pick(weird)).not.toThrow();
    expect(Ctx.pick(weird)).toEqual({ a: 'ok' });
  });
});
