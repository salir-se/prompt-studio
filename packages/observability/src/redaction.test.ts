// @vitest-environment node
// @module-tag pure
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { redactCensor, workerRedact } from './redaction';

/** Capture pino's serialized JSON lines via a SonicBoom-like destination. */
function captured() {
  const lines: string[] = [];
  const logger = pino({ redact: { ...workerRedact } }, { write: (s: string) => lines.push(s) } as never);
  return { logger, objects: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('worker redaction config (pino native redact, identifiable mask)', () => {
  it('masks a long secret to first4...last4 (recognizable, not exposed)', () => {
    const { logger, objects } = captured();
    logger.info({ token: 'ghs_abcdefghijkl9f2a' }, 'm');
    const o = objects()[0];
    expect(o.token).toBe('ghs_...9f2a');
    expect(o.token).not.toContain('abcdefgh'); // middle is hidden
  });

  it('collapses a short secret to *** (no fraction leaks)', () => {
    const { logger, objects } = captured();
    logger.info({ authorization: 'Bearer x' }, 'm'); // < 12 chars
    expect(objects()[0].authorization).toBe('***');
  });

  it('masks sensitive keys one level deep (via the *.key wildcard)', () => {
    const { logger, objects } = captured();
    logger.info({ user: { accessToken: 'tok_1234567890abcd', name: 'ok' } }, 'm');
    const o = objects()[0] as { user: Record<string, unknown> };
    expect(o.user.accessToken).toBe('tok_...abcd');
    expect(o.user.name).toBe('ok');
  });

  it('leaves non-sensitive fields untouched', () => {
    const { logger, objects } = captured();
    logger.info({ userId: 'u1', count: 3, correlationId: 'c-1' }, 'm');
    expect(objects()[0]).toMatchObject({ userId: 'u1', count: 3, correlationId: 'c-1' });
  });

  it('redactCensor keeps the value identifiable and never throws on non-strings', () => {
    expect(redactCensor('ghs_abcdefghijkl9f2a')).toBe('ghs_...9f2a');
    expect(redactCensor('short')).toBe('***');
    expect(() => redactCensor(12345)).not.toThrow();
  });
});
