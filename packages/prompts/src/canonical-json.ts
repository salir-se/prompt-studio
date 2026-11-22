export type PromptValueHash = `sha256:${string}`;

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('Value is not canonical JSON');
    return value;
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Value is not canonical JSON');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) {
        throw new TypeError('Value is not canonical JSON');
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Value is not canonical JSON');
        result.push(canonicalValue(descriptor.value, ancestors));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Value is not canonical JSON');

    const result = Object.create(null) as Record<string, unknown>;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) throw new TypeError('Value is not canonical JSON');
    for (const key of (ownKeys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Value is not canonical JSON');
      result[key] = canonicalValue(descriptor.value, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/** Stable JSON for prompt identities: object keys are sorted recursively; array order remains significant. */
export function canonicalPromptJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set()));
}

/** Browser-, worker-, and Bun-compatible SHA-256 over a canonical prompt value. */
export async function hashPromptValue(value: unknown): Promise<PromptValueHash> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPromptJson(value)));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
