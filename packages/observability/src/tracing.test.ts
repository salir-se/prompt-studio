// @module-tag pure
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Span, Tracer } from './tracing';
import { createTracer } from './tracing';

describe('NoopTracer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a tracer with a span factory', () => {
    const tracer: Tracer = createTracer('test');

    expect(tracer.startSpan).toBeTypeOf('function');
  });

  it('creates a fresh no-op span for each operation', () => {
    const tracer = createTracer('test');
    const first: Span = tracer.startSpan('my-operation');
    const second = tracer.startSpan('my-operation');

    expect(first).not.toBe(second);
    expect(first.setAttribute).toBeTypeOf('function');
    expect(first.setStatus).toBeTypeOf('function');
    expect(first.end).toBeTypeOf('function');
  });

  it('ignores attributes, status, and end calls without mutating options', () => {
    const tracer = createTracer('test');
    const attributes = { route: '/api', method: 'GET' };
    const span = tracer.startSpan('op', { attributes });

    expect(span.setAttribute('key', 'value')).toBeUndefined();
    expect(span.setAttribute('count', 42)).toBeUndefined();
    expect(span.setAttribute('flag', true)).toBeUndefined();
    expect(span.setStatus('OK')).toBeUndefined();
    expect(span.setStatus('ERROR', 'something failed')).toBeUndefined();
    expect(span.end()).toBeUndefined();
    expect(attributes).toEqual({ route: '/api', method: 'GET' });
  });

  it('keeps no-op spans idempotent after end', () => {
    const tracer = createTracer('test');
    const span = tracer.startSpan('op');

    expect(span.end()).toBeUndefined();
    expect(span.end()).toBeUndefined();
    expect(span.setAttribute('late', true)).toBeUndefined();
    expect(span.setStatus('ERROR', 'late status')).toBeUndefined();
  });

  it('does not emit console output when spans are used', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const span = createTracer('test').startSpan('op', { attributes: { route: '/queue' } });

    span.setAttribute('queued', true);
    span.setStatus('OK');
    span.end();

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
