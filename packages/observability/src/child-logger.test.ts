// @module-tag pure
import { describe, expect, it } from 'vitest';
import { childLogger } from './child-logger';
import { logFields } from './log-fields';

const Scope = logFields({ 'workspaceId?': 'string', 'scope?': 'string' });

/** Minimal fake logger that records the bindings passed to child(). */
function fakeLogger() {
  const childBindings: Array<Record<string, unknown>> = [];
  const logger = {
    childBindings,
    child(b: Record<string, unknown>) {
      childBindings.push(b);
      return logger;
    },
  };
  return logger;
}

describe('childLogger — scoped child with arktype-projected bindings (ADR-114)', () => {
  it('binds only the declared scope fields, dropping the rest', () => {
    const log = fakeLogger();
    childLogger(log, Scope, { workspaceId: 'w-1', scope: 'oauth', secret: 'drop', huge: { a: 1 } });
    expect(log.childBindings).toHaveLength(1);
    expect(log.childBindings[0]).toEqual({ workspaceId: 'w-1', scope: 'oauth' });
  });

  it('returns the child logger (chainable)', () => {
    const log = fakeLogger();
    expect(childLogger(log, Scope, { scope: 'x' })).toBe(log);
  });

  it('is resilient to a non-object ctx (binds {})', () => {
    const log = fakeLogger();
    childLogger(log, Scope, null);
    expect(log.childBindings[0]).toEqual({});
  });
});
