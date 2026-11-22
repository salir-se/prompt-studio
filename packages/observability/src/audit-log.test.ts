// @module-tag pure
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetAuditLogSinkForTests,
  AUDIT_LOG_MESSAGE,
  type AuditLogRecord,
  emitAuditLogEvent,
  setAuditLogSink,
} from './audit-log';
import { createMockLogger } from './test/mock-logger';

const baseRecord: AuditLogRecord = {
  auditId: 'aud_1',
  actorId: 'user_1',
  actionType: 'org.member.invite',
  auditStore: 'admin',
  createdAt: '2026-08-20T00:00:00.000Z',
};

describe('emitAuditLogEvent', () => {
  afterEach(() => {
    __resetAuditLogSinkForTests();
  });

  it('no-ops when no sink is registered', () => {
    expect(() => emitAuditLogEvent(baseRecord)).not.toThrow();
  });

  it('emits exactly one line with the stable message', () => {
    const { logger, entries } = createMockLogger('audit');
    setAuditLogSink(logger);

    emitAuditLogEvent(baseRecord);

    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe(AUDIT_LOG_MESSAGE);
    expect(entries[0].level).toBe('info');
  });

  it('carries every required field in the structured payload', () => {
    const { logger, entries } = createMockLogger('audit');
    setAuditLogSink(logger);

    emitAuditLogEvent(baseRecord);

    expect(entries[0].obj).toMatchObject({
      auditId: 'aud_1',
      actorId: 'user_1',
      actionType: 'org.member.invite',
      auditStore: 'admin',
      createdAt: '2026-08-20T00:00:00.000Z',
    });
  });

  it('omits undefined optional keys entirely rather than emitting them as undefined', () => {
    const { logger, entries } = createMockLogger('audit');
    setAuditLogSink(logger);

    emitAuditLogEvent(baseRecord);

    const obj = entries[0].obj ?? {};
    expect(Object.keys(obj)).not.toContain('orgId');
    expect(Object.keys(obj)).not.toContain('workspaceId');
    expect(Object.keys(obj)).not.toContain('summary');
    expect(Object.keys(obj)).not.toContain('subject');
    expect(Object.keys(obj)).not.toContain('before');
    expect(Object.keys(obj)).not.toContain('after');
  });

  it('passes present optional fields through unchanged, including nested before/after', () => {
    const { logger, entries } = createMockLogger('audit');
    setAuditLogSink(logger);

    const before = { status: 'active' };
    const after = { status: 'suspended' };
    const subject = { entity: 'workspace', id: 'ws_1' };

    emitAuditLogEvent({
      ...baseRecord,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      summary: 'Suspended workspace',
      subject,
      before,
      after,
    });

    expect(entries[0].obj).toMatchObject({
      orgId: 'org_1',
      workspaceId: 'ws_1',
      summary: 'Suspended workspace',
      subject,
      before,
      after,
    });
  });

  it('swallows a throwing sink instead of propagating', () => {
    const throwingLogger = {
      info: () => {
        throw new Error('sink exploded');
      },
    };
    setAuditLogSink(throwingLogger);

    expect(() => emitAuditLogEvent(baseRecord)).not.toThrow();
  });

  it('stops emitting after the sink is cleared with null', () => {
    const { logger, entries } = createMockLogger('audit');
    setAuditLogSink(logger);
    setAuditLogSink(null);

    emitAuditLogEvent(baseRecord);

    expect(entries).toHaveLength(0);
  });

  it('last registration wins', () => {
    const first = createMockLogger('first');
    const second = createMockLogger('second');
    setAuditLogSink(first.logger);
    setAuditLogSink(second.logger);

    emitAuditLogEvent(baseRecord);

    expect(first.entries).toHaveLength(0);
    expect(second.entries).toHaveLength(1);
  });

  it('does not mutate the caller-supplied record', () => {
    const { logger } = createMockLogger('audit');
    setAuditLogSink(logger);

    const record: AuditLogRecord = { ...baseRecord, orgId: 'org_1' };
    const snapshot = { ...record };

    emitAuditLogEvent(record);

    expect(record).toEqual(snapshot);
  });
});
