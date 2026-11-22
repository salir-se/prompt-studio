/**
 * No-op OpenTelemetry metrics stubs.
 *
 * Provides Counter/Histogram/Meter interfaces so that instrumentation code
 * can be written today without pulling in the full OTel SDK. When real
 * metrics collection is needed, swap `createMeter()` for an OTel-backed
 * implementation.
 */

export interface Counter {
  add(value: number, attributes?: Record<string, string>): void;
}

export interface Histogram {
  record(value: number, attributes?: Record<string, string>): void;
}

export interface Meter {
  createCounter(name: string): Counter;
  createHistogram(name: string): Histogram;
}

/** Create a named meter. Currently returns a no-op implementation. */
export function createMeter(_name: string): Meter {
  return {
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  };
}
