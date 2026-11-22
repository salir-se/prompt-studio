// @module-tag pure
import { describe, expect, it } from 'vitest';
import { LlmHttpError, llmHttpStatus, llmRetryAfterMs } from './llm-http-error';

describe('LlmHttpError', () => {
  it('is an Error carrying the status, with the message untouched', () => {
    const err = new LlmHttpError(429, 'Anthropic API error: 429 rate limited');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LlmHttpError');
    expect(err.message).toBe('Anthropic API error: 429 rate limited');
    expect(err.status).toBe(429);
  });

  it('preserves a cause chain for the logs', () => {
    const cause = new Error('socket hang up');
    expect(new LlmHttpError(502, 'API error: 502', { cause }).cause).toBe(cause);
  });

  it('stores retryAfterMs when it is a finite non-negative number', () => {
    expect(new LlmHttpError(429, 'rate limited', { retryAfterMs: 5000 }).retryAfterMs).toBe(5000);
  });

  it('stores a retryAfterMs of 0 rather than treating it as falsy/absent', () => {
    expect(new LlmHttpError(429, 'rate limited', { retryAfterMs: 0 }).retryAfterMs).toBe(0);
  });

  it('omits retryAfterMs when the option is not provided at all', () => {
    expect(new LlmHttpError(429, 'rate limited').retryAfterMs).toBeUndefined();
  });

  it('omits retryAfterMs for null, undefined, negative, NaN, and Infinity', () => {
    expect(new LlmHttpError(429, 'x', { retryAfterMs: null }).retryAfterMs).toBeUndefined();
    expect(new LlmHttpError(429, 'x', { retryAfterMs: undefined }).retryAfterMs).toBeUndefined();
    expect(new LlmHttpError(429, 'x', { retryAfterMs: -1 }).retryAfterMs).toBeUndefined();
    expect(new LlmHttpError(429, 'x', { retryAfterMs: Number.NaN }).retryAfterMs).toBeUndefined();
    expect(new LlmHttpError(429, 'x', { retryAfterMs: Number.POSITIVE_INFINITY }).retryAfterMs).toBeUndefined();
  });

  it('leaves status, message, name, and cause unaffected when retryAfterMs is also set', () => {
    const cause = new Error('socket hang up');
    const err = new LlmHttpError(429, 'rate limited', { cause, retryAfterMs: 30000 });

    expect(err.status).toBe(429);
    expect(err.message).toBe('rate limited');
    expect(err.name).toBe('LlmHttpError');
    expect(err.cause).toBe(cause);
    expect(err.retryAfterMs).toBe(30000);
  });
});

describe('llmHttpStatus', () => {
  it('reads the status off a thrown LlmHttpError', () => {
    expect(llmHttpStatus(new LlmHttpError(403, 'forbidden'))).toBe(403);
  });

  it('reads it structurally, so a cloned or cross-bundle error still classifies', () => {
    // An error can lose its prototype crossing a worker postMessage or a
    // structured clone; the field is what matters, not the class identity.
    expect(llmHttpStatus({ message: 'API error: 401', status: 401 })).toBe(401);
    expect(llmHttpStatus(Object.assign(new Error('boom'), { status: 429 }))).toBe(429);
  });

  it('is undefined for anything without a usable numeric status', () => {
    expect(llmHttpStatus(new Error('Network request failed'))).toBeUndefined();
    expect(llmHttpStatus(undefined)).toBeUndefined();
    expect(llmHttpStatus(null)).toBeUndefined();
    expect(llmHttpStatus('API error: 429')).toBeUndefined();
    expect(llmHttpStatus({ status: '429' })).toBeUndefined();
    expect(llmHttpStatus({ status: Number.NaN })).toBeUndefined();
    expect(llmHttpStatus({ status: 4.29 })).toBeUndefined();
  });

  it('rejects a number that is not a plausible HTTP status', () => {
    // Guards against a foreign object whose unrelated `status` field (an exit
    // code, an enum) would otherwise be read as a response status.
    expect(llmHttpStatus({ status: 0 })).toBeUndefined();
    expect(llmHttpStatus({ status: 1 })).toBeUndefined();
    expect(llmHttpStatus({ status: 600 })).toBeUndefined();
  });
});

describe('llmRetryAfterMs', () => {
  it('reads retryAfterMs off a thrown LlmHttpError', () => {
    expect(llmRetryAfterMs(new LlmHttpError(429, 'rate limited', { retryAfterMs: 120000 }))).toBe(120000);
  });

  it('reads it structurally off a plain object, so a cloned or cross-bundle error still classifies', () => {
    expect(llmRetryAfterMs({ retryAfterMs: 120000 })).toBe(120000);
  });

  it('reads a retryAfterMs of 0 rather than treating it as falsy/absent', () => {
    expect(llmRetryAfterMs({ retryAfterMs: 0 })).toBe(0);
  });

  it('is undefined for anything without a usable numeric retryAfterMs', () => {
    expect(llmRetryAfterMs({ retryAfterMs: '120' })).toBeUndefined();
    expect(llmRetryAfterMs({ retryAfterMs: -1 })).toBeUndefined();
    expect(llmRetryAfterMs({ retryAfterMs: Number.NaN })).toBeUndefined();
    expect(llmRetryAfterMs({ retryAfterMs: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(llmRetryAfterMs({})).toBeUndefined();
    expect(llmRetryAfterMs(new LlmHttpError(429, 'rate limited'))).toBeUndefined();
  });

  it('is undefined for non-objects', () => {
    expect(llmRetryAfterMs(undefined)).toBeUndefined();
    expect(llmRetryAfterMs(null)).toBeUndefined();
    expect(llmRetryAfterMs('retryAfterMs: 120000')).toBeUndefined();
    expect(llmRetryAfterMs(120000)).toBeUndefined();
  });
});
