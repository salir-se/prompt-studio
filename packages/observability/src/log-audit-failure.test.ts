// @module-tag pure
import { describe, expect, it } from 'vitest';
import { AUDIT_FAILURE_MESSAGE, logAuditFailure } from './log-audit-failure';
import { createMockLogger } from './test/mock-logger';

describe('logAuditFailure', () => {
  it('emits exactly one warn entry with the stable message', () => {
    const { logger, entries } = createMockLogger('license');

    logAuditFailure(logger, 'platform.license.issue', new Error('db down'));

    const warns = entries.filter((e) => e.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toBe(AUDIT_FAILURE_MESSAGE);
  });

  it('carries eventType, extra fields, and the raw error in the structured payload', () => {
    const { logger, entries } = createMockLogger('license');
    const err = new Error('db down');

    logAuditFailure(logger, 'platform.license.issue', err, { orgId: 'o1', actorId: 'u1' });

    const [warn] = entries.filter((e) => e.level === 'warn');
    expect(warn.obj).toMatchObject({ eventType: 'platform.license.issue', orgId: 'o1', actorId: 'u1' });
    // raw error is passed through (the logger's errSerializer structures it downstream)
    expect(warn.obj?.err).toBe(err);
  });

  it('does not log at error level (best-effort secondary path)', () => {
    const { logger, entries } = createMockLogger('license');

    logAuditFailure(logger, 'org.seat.assign', new Error('boom'));

    expect(entries.filter((e) => e.level === 'error')).toHaveLength(0);
  });

  it('never throws, even on a non-Error value', () => {
    const { logger, entries } = createMockLogger('license');

    expect(() => logAuditFailure(logger, 'evt', 'string failure')).not.toThrow();
    expect(entries[0]?.obj?.err).toBe('string failure');
  });
});
