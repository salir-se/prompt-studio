// @module-tag pure
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Counter, Histogram, Meter } from './metrics';
import { createMeter } from './metrics';

describe('NoopMeter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a meter with only counter and histogram factories', () => {
    const meter: Meter = createMeter('test');

    expect(Object.keys(meter).sort()).toEqual(['createCounter', 'createHistogram']);
    expect(meter.createCounter).toBeTypeOf('function');
    expect(meter.createHistogram).toBeTypeOf('function');
  });

  it('creates isolated no-op counters for each metric', () => {
    const meter = createMeter('test');
    const requests: Counter = meter.createCounter('requests');
    const retries = meter.createCounter('requests');

    expect(requests).not.toBe(retries);
    expect(Object.keys(requests)).toEqual(['add']);
    expect(requests.add).toBeTypeOf('function');
  });

  it('creates isolated no-op histograms for each metric', () => {
    const meter = createMeter('test');
    const latency: Histogram = meter.createHistogram('latency');
    const payloadSize = meter.createHistogram('latency');

    expect(latency).not.toBe(payloadSize);
    expect(Object.keys(latency)).toEqual(['record']);
    expect(latency.record).toBeTypeOf('function');
  });

  it('ignores metric values and string attributes without mutating caller input', () => {
    const meter = createMeter('test');
    const counter = meter.createCounter('requests');
    const histogram = meter.createHistogram('latency');
    const attributes = { method: 'GET', route: '/api' };

    expect(counter.add(5, attributes)).toBeUndefined();
    expect(histogram.record(123.45, attributes)).toBeUndefined();
    expect(attributes).toEqual({ method: 'GET', route: '/api' });
  });

  it('does not emit console output when instruments are used', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const meter = createMeter('test');

    meter.createCounter('requests').add(1, { method: 'POST' });
    meter.createHistogram('latency').record(42, { route: '/queue' });

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
