/**
 * No-op OpenTelemetry tracing stubs.
 *
 * Provides the Span/Tracer interfaces so that instrumentation code can be
 * written today without pulling in the full OTel SDK. When real tracing is
 * needed, swap `createTracer()` for an OTel-backed implementation.
 */

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: 'OK' | 'ERROR', message?: string): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, options?: { attributes?: Record<string, string> }): Span;
}

class NoopSpan implements Span {
  setAttribute(): void {}
  setStatus(): void {}
  end(): void {}
}

class NoopTracer implements Tracer {
  startSpan(): Span {
    return new NoopSpan();
  }
}

/** Create a named tracer. Currently returns a no-op implementation. */
export function createTracer(_name: string): Tracer {
  return new NoopTracer();
}
