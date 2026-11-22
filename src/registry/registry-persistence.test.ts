// @module-tag dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSessionDeclarations,
  type RegistryStorage,
  saveSessionDeclarations,
  STORAGE_KEY_PREFIX,
} from './registry-persistence';
import type { DeclaredVariable } from './variables-registry';

/** Tiny in-memory `RegistryStorage` fake — no happy-dom localStorage, no cross-test leakage. */
function memoryStorage(): RegistryStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function sessionVariable(overrides: Partial<DeclaredVariable> = {}): DeclaredVariable {
  return {
    name: 'account_tier',
    purpose: 'The account tier (1/2/3).',
    sample: '2',
    required: true,
    source: 'session',
    ...overrides,
  };
}

const builtinVariable: DeclaredVariable = {
  name: 'product_name',
  purpose: 'Built-in product name',
  sample: 'Salir',
  required: true,
  source: 'builtin',
};

describe('STORAGE_KEY_PREFIX', () => {
  it('locks the key format — changing it silently would orphan every saved declaration', () => {
    expect(STORAGE_KEY_PREFIX).toBe('prompt-studio:registry:v1:');
  });
});

describe('round-trip', () => {
  it('saves session entries and loads them back with source "session", in the same order', () => {
    const storage = memoryStorage();
    const entries = [
      sessionVariable({ name: 'zebra_var', sample: '', required: false }),
      sessionVariable({ name: 'alpha_var', purpose: 'Second one' }),
    ];
    saveSessionDeclarations('closer', entries, storage);
    expect(loadSessionDeclarations('closer', storage)).toEqual(entries);
  });
});

describe('builtin filtering', () => {
  it('saves only session entries from a mixed list — loaded list never contains builtins', () => {
    const storage = memoryStorage();
    saveSessionDeclarations('closer', [builtinVariable, sessionVariable()], storage);
    const loaded = loadSessionDeclarations('closer', storage);
    expect(loaded).toEqual([sessionVariable()]);
    expect(loaded.every((entry) => entry.source === 'session')).toBe(true);
  });

  it('never writes a source field to storage — stale data cannot impersonate a builtin', () => {
    const storage = memoryStorage();
    saveSessionDeclarations('closer', [sessionVariable()], storage);
    const raw = storage.data.get(`${STORAGE_KEY_PREFIX}closer`);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('source');
  });
});

describe('per-root isolation', () => {
  it('keeps two rootKeys from leaking into each other', () => {
    const storage = memoryStorage();
    const closerEntry = sessionVariable({ name: 'closer_only' });
    const scoutEntry = sessionVariable({ name: 'scout_only' });
    saveSessionDeclarations('closer', [closerEntry], storage);
    saveSessionDeclarations('scout', [scoutEntry], storage);
    expect(loadSessionDeclarations('closer', storage)).toEqual([closerEntry]);
    expect(loadSessionDeclarations('scout', storage)).toEqual([scoutEntry]);
  });
});

describe('loadSessionDeclarations — bad cache degrades to []', () => {
  it('returns [] for an absent key', () => {
    expect(loadSessionDeclarations('never-saved', memoryStorage())).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    const storage = memoryStorage();
    storage.data.set(`${STORAGE_KEY_PREFIX}closer`, '{not json');
    expect(loadSessionDeclarations('closer', storage)).toEqual([]);
  });

  it("returns [] for an extra key — the '+': 'reject' proof", () => {
    const storage = memoryStorage();
    const withExtraOnEntry = {
      declarations: [{ name: 'a', purpose: 'p', sample: 's', required: true, source: 'builtin' }],
    };
    storage.data.set(`${STORAGE_KEY_PREFIX}closer`, JSON.stringify(withExtraOnEntry));
    expect(loadSessionDeclarations('closer', storage)).toEqual([]);

    const withExtraOnRoot = { declarations: [], stale: true };
    storage.data.set(`${STORAGE_KEY_PREFIX}closer`, JSON.stringify(withExtraOnRoot));
    expect(loadSessionDeclarations('closer', storage)).toEqual([]);
  });

  it('returns [] for a wrong-typed field', () => {
    const storage = memoryStorage();
    const wrongType = { declarations: [{ name: 'a', purpose: 'p', sample: 's', required: 'yes' }] };
    storage.data.set(`${STORAGE_KEY_PREFIX}closer`, JSON.stringify(wrongType));
    expect(loadSessionDeclarations('closer', storage)).toEqual([]);
  });

  it('returns [] for a missing field', () => {
    const storage = memoryStorage();
    const missingField = { declarations: [{ name: 'a', purpose: 'p', sample: 's' }] };
    storage.data.set(`${STORAGE_KEY_PREFIX}closer`, JSON.stringify(missingField));
    expect(loadSessionDeclarations('closer', storage)).toEqual([]);
  });

  it('returns [] for a non-object payload', () => {
    const storage = memoryStorage();
    storage.data.set(`${STORAGE_KEY_PREFIX}closer`, JSON.stringify(['not', 'an', 'object']));
    expect(loadSessionDeclarations('closer', storage)).toEqual([]);
  });
});

describe('throwing storage', () => {
  const throwing: RegistryStorage = {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('quota exceeded');
    },
  };

  it('load returns [] when getItem throws', () => {
    expect(loadSessionDeclarations('closer', throwing)).toEqual([]);
  });

  it('save swallows a setItem throw', () => {
    expect(() => saveSessionDeclarations('closer', [sessionVariable()], throwing)).not.toThrow();
  });
});

describe('no storage available', () => {
  beforeEach(() => vi.stubGlobal('localStorage', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('load returns [] when storage is undefined', () => {
    expect(loadSessionDeclarations('closer')).toEqual([]);
  });

  it('save is a no-throw no-op when storage is undefined', () => {
    expect(() => saveSessionDeclarations('closer', [sessionVariable()])).not.toThrow();
  });
});
