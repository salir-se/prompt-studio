// @module-tag pure
import { describe, expect, it } from 'vitest';
import { canonicalPromptJson, hashPromptValue } from './canonical-json';

describe('canonical prompt values', () => {
  it('sorts object keys recursively, preserves array order, and hashes identically', async () => {
    const left = { z: [{ b: 2, a: 1 }], a: true };
    const right = { a: true, z: [{ a: 1, b: 2 }] };

    expect(canonicalPromptJson(left)).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
    await expect(hashPromptValue(left)).resolves.toBe(await hashPromptValue(right));
    await expect(hashPromptValue(left)).resolves.not.toBe(await hashPromptValue({ ...right, z: [...right.z, 3] }));
    await expect(hashPromptValue(left)).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('rejects values that JSON would silently drop, rewrite, or execute', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get: () => 'leaked' });

    expect(() => canonicalPromptJson({ missing: undefined })).toThrow(/canonical JSON/);
    expect(() => canonicalPromptJson(Number.POSITIVE_INFINITY)).toThrow(/canonical JSON/);
    expect(() => canonicalPromptJson(-0)).toThrow(/canonical JSON/);
    expect(() => canonicalPromptJson(cyclic)).toThrow(/canonical JSON/);
    expect(() => canonicalPromptJson(accessor)).toThrow(/canonical JSON/);
  });
});
