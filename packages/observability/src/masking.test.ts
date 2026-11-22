// @module-tag pure
import { describe, expect, it } from 'vitest';
import { addSensitiveKeys, isSensitiveKey, maskSecretValue, maskSensitiveData } from './masking';

describe('maskSensitiveData', () => {
  it('masks known sensitive keys', () => {
    const result = maskSensitiveData({
      apiKey: 'sk-1234567890abcdef',
      name: 'John',
    });
    expect(result.apiKey).toBe('***');
    expect(result.name).toBe('John');
  });

  it('masks multiple sensitive key variants', () => {
    const result = maskSensitiveData({
      api_key: 'key123',
      password: 'secret',
      token: 'tok123',
      authorization: 'Bearer xyz',
      refreshToken: 'rt-abc',
    });
    expect(result.api_key).toBe('***');
    expect(result.password).toBe('***');
    expect(result.token).toBe('***');
    expect(result.authorization).toBe('***');
    expect(result.refreshToken).toBe('***');
  });

  it('deep masks nested objects', () => {
    const result = maskSensitiveData({
      config: {
        apiKey: 'secret-key',
        model: 'claude-sonnet',
      },
    });
    expect(result.config.apiKey).toBe('***');
    expect(result.config.model).toBe('claude-sonnet');
  });

  it('masks sk-prefixed values in strings', () => {
    const result = maskSensitiveData({
      message: 'Using key sk-abcdefghij1234567890 for request',
    });
    expect(result.message).toContain('sk-***');
    expect(result.message).not.toContain('abcdefghij');
  });

  it('masks JWT tokens in strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123';
    const result = maskSensitiveData({ log: `Token: ${jwt}` });
    expect(result.log).toContain('jwt-***');
    expect(result.log).not.toContain('eyJhbGci');
  });

  it('masks Bearer tokens in strings', () => {
    const result = maskSensitiveData({
      header: 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig',
    });
    expect(result.header).toBe('Bearer ***');
  });

  it('masks emails in strings', () => {
    const result = maskSensitiveData({
      message: 'Contact ada@example.com or grace.hopper@example.org',
    });
    expect(result.message).toBe('Contact ***@*** or ***@***');
  });

  it('handles arrays', () => {
    const result = maskSensitiveData([
      { apiKey: 'secret', name: 'test' },
      { apiKey: 'other', name: 'test2' },
    ]);
    expect(result[0].apiKey).toBe('***');
    expect(result[1].apiKey).toBe('***');
    expect(result[0].name).toBe('test');
  });

  it('handles null and undefined', () => {
    expect(maskSensitiveData(null)).toBeNull();
    expect(maskSensitiveData(undefined)).toBeUndefined();
  });

  it('handles primitives', () => {
    expect(maskSensitiveData(42)).toBe(42);
    expect(maskSensitiveData(true)).toBe(true);
    expect(maskSensitiveData('hello')).toBe('hello');
  });

  it('does not mutate original object', () => {
    const original = { apiKey: 'secret', name: 'test' };
    maskSensitiveData(original);
    expect(original.apiKey).toBe('secret');
  });

  it('handles deep nesting without stack overflow', () => {
    let obj: Record<string, unknown> = { value: 'safe' };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }
    // Should not throw (depth limit = 10)
    expect(() => maskSensitiveData(obj)).not.toThrow();
  });
});

describe('isSensitiveKey', () => {
  it('recognizes sensitive keys', () => {
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('name')).toBe(false);
  });
});

describe('addSensitiveKeys', () => {
  it('adds custom sensitive keys', () => {
    addSensitiveKeys('myCustomSecret');
    expect(isSensitiveKey('myCustomSecret')).toBe(true);
    const result = maskSensitiveData({ myCustomSecret: 'value' });
    expect(result.myCustomSecret).toBe('***');
  });
});

describe('maskSecretValue (identifiable mask)', () => {
  it('keeps first/last 4 chars of a long secret', () => {
    expect(maskSecretValue('ghs_abcdefghijkl9f2a')).toBe('ghs_...9f2a');
  });

  it('collapses values shorter than 12 chars to *** (no fraction leaks)', () => {
    expect(maskSecretValue('Bearer x')).toBe('***');
    expect(maskSecretValue('a'.repeat(11))).toBe('***');
  });

  it('reveals at the 12-char boundary', () => {
    expect(maskSecretValue('abcd12345678')).toBe('abcd...5678'); // exactly 12
  });

  it('returns empty string for empty input', () => {
    expect(maskSecretValue('')).toBe('');
  });
});
