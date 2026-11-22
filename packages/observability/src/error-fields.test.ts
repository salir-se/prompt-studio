// @module-tag pure
import { describe, expect, it } from 'vitest';
import { resolveErrorFields } from './error-fields';

describe('resolveErrorFields', () => {
  it('extracts code, correlationId, and status from an ApiClientError-shaped object', () => {
    const error = { code: 'RATE_LIMITED', correlationId: 'corr-123', status: 429 };

    expect(resolveErrorFields(error)).toEqual({ code: 'RATE_LIMITED', correlationId: 'corr-123', status: 429 });
  });

  it('yields no fields for a plain Error', () => {
    expect(resolveErrorFields(new Error('boom'))).toEqual({
      code: undefined,
      correlationId: undefined,
      status: undefined,
    });
  });

  it.each([null, undefined, 'a plain string', 42])('yields no fields without throwing for %p', (value) => {
    expect(() => resolveErrorFields(value)).not.toThrow();
    expect(resolveErrorFields(value)).toEqual({ code: undefined, correlationId: undefined, status: undefined });
  });

  it('rejects a non-string code rather than passing it through', () => {
    expect(resolveErrorFields({ code: 404 }).code).toBeUndefined();
  });

  it('rejects a non-string correlationId rather than passing it through', () => {
    expect(resolveErrorFields({ correlationId: 12345 }).correlationId).toBeUndefined();
  });

  it('rejects a non-number status rather than passing it through', () => {
    expect(resolveErrorFields({ status: '404' }).status).toBeUndefined();
  });

  it('ignores extra unknown properties', () => {
    const error = { code: 'X', correlationId: 'Y', status: 500, message: 'ignored', detail: { nested: true } };

    expect(resolveErrorFields(error)).toEqual({ code: 'X', correlationId: 'Y', status: 500 });
  });
});
