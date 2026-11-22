// @module-tag pure
import { describe, expect, it } from 'vitest';
import { resolveSessionSamplesForPreview } from './use-variables-registry';

describe('session sample preview', () => {
  it('resolves legal prototype-named variables and preserves unknown placeholders', () => {
    const entries = ['__proto__', 'constructor'].map((name) => ({
      name,
      purpose: name,
      sample: `sample-${name}`,
      required: true,
      source: 'session' as const,
    }));
    expect(resolveSessionSamplesForPreview('{{__proto__}} {{constructor}} {{toString}}', { entries })).toBe(
      'sample-__proto__ sample-constructor {{toString}}',
    );
  });
});
