// @module-tag dom
import { PROMPT_VARIABLE_DOCS } from '@prompt-studio/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBuiltinRegistry,
  declareVariable,
  undeclaredVariables,
  type VariablesRegistry,
} from './variables-registry';

// The public build documents no built-in variables; a host application's docs are supplied here.
vi.mock('@prompt-studio/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@prompt-studio/prompts')>()),
  PROMPT_VARIABLE_DOCS: (await import('../test-fixtures/host-variable-docs')).HOST_VARIABLE_DOCS,
}));

describe('buildBuiltinRegistry', () => {
  it('flattens PROMPT_VARIABLE_DOCS into one entry per distinct variable name, sourced "builtin"', () => {
    // Given / When: the built-in registry flattened from the host's variable docs
    const registry = buildBuiltinRegistry();
    // Then: a documented variable is one builtin entry with its purpose and sample
    const productName = registry.entries.find((entry) => entry.name === 'product_name');
    expect(productName).toBeTruthy();
    expect(productName?.source).toBe('builtin');
    expect(productName?.sample).toBeTruthy();
    expect(productName?.purpose).toBeTruthy();
  });

  it('dedupes a name declared by multiple prompt keys into a single entry', () => {
    // Given: company_name is documented by two prompt keys; Then: it appears once
    const registry = buildBuiltinRegistry();
    const names = registry.entries.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => name === 'company_name')).toHaveLength(1);
  });

  it('is sorted by name and deterministic across calls', () => {
    // Given / When / Then: names come back sorted, identically on every call
    const first = buildBuiltinRegistry();
    const names = first.entries.map((entry) => entry.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(buildBuiltinRegistry()).toEqual(first);
  });

  it('defaults required to true when a doc omits it, and respects explicit false', () => {
    // Given: product_name omits `required`, change_list sets it to false
    const registry = buildBuiltinRegistry();
    // Then: the first defaults to required, the second stays optional
    const alwaysPresent = registry.entries.find((entry) => entry.name === 'product_name');
    expect(alwaysPresent?.required).toBe(true);

    const optional = registry.entries.find((entry) => entry.name === 'change_list');
    expect(optional?.required).toBe(false);
  });

  it('covers every prompt key currently registered in PROMPT_VARIABLE_DOCS', () => {
    // Given / When / Then: every documented variable of every key is in the registry
    expect(Object.keys(PROMPT_VARIABLE_DOCS)).toHaveLength(2);
    const registry = buildBuiltinRegistry();
    const names = new Set(registry.entries.map((entry) => entry.name));
    for (const doc of Object.values(PROMPT_VARIABLE_DOCS)) {
      for (const variable of doc.variables) {
        expect(names.has(variable.key)).toBe(true);
      }
    }
  });
});

describe('declareVariable', () => {
  const baseRegistry: VariablesRegistry = { entries: [] };

  it('declares a new session variable', () => {
    const result = declareVariable(baseRegistry, { name: 'account_tier', purpose: 'The account tier (1/2/3).' });
    expect('error' in result).toBe(false);
    const registry = result as VariablesRegistry;
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]).toMatchObject({
      name: 'account_tier',
      purpose: 'The account tier (1/2/3).',
      required: true,
      source: 'session',
    });
  });

  it('never mutates the input registry', () => {
    const result = declareVariable(baseRegistry, { name: 'account_tier', purpose: 'purpose' });
    expect('error' in result).toBe(false);
    expect(baseRegistry.entries).toHaveLength(0);
  });

  it('accepts an explicit sample and required: false', () => {
    const result = declareVariable(baseRegistry, {
      name: 'nickname',
      purpose: 'Preferred short name',
      sample: 'Jo',
      required: false,
    });
    expect('error' in result).toBe(false);
    const registry = result as VariablesRegistry;
    expect(registry.entries[0]).toMatchObject({ name: 'nickname', sample: 'Jo', required: false });
  });

  it('rejects an invalid identifier — reuses the real {{name}} placeholder grammar, not a hand-rolled regex', () => {
    const spaced = declareVariable(baseRegistry, { name: 'not a name', purpose: 'purpose' });
    expect('error' in spaced).toBe(true);

    const leadingDigit = declareVariable(baseRegistry, { name: '1abc', purpose: 'purpose' });
    expect('error' in leadingDigit).toBe(true);

    const dashed = declareVariable(baseRegistry, { name: 'foo-bar', purpose: 'purpose' });
    expect('error' in dashed).toBe(true);

    const empty = declareVariable(baseRegistry, { name: '', purpose: 'purpose' });
    expect('error' in empty).toBe(true);
  });

  it('accepts every identifier shape the render engine itself accepts', () => {
    const valid = declareVariable(baseRegistry, { name: 'valid_name_1', purpose: 'purpose' });
    expect('error' in valid).toBe(false);
  });

  it('rejects a duplicate name already declared (built-in)', () => {
    // Given: the built-in registry; When: a session declaration reuses a built-in name; Then: it is refused
    const withBuiltin = buildBuiltinRegistry();
    const result = declareVariable(withBuiltin, { name: 'product_name', purpose: 'duplicate' });
    expect('error' in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/already declared/i);
  });

  it('rejects a duplicate name already declared (session)', () => {
    const first = declareVariable(baseRegistry, { name: 'account_tier', purpose: 'purpose' }) as VariablesRegistry;
    const result = declareVariable(first, { name: 'account_tier', purpose: 'again' });
    expect('error' in result).toBe(true);
  });

  it('rejects an empty or whitespace-only purpose', () => {
    const empty = declareVariable(baseRegistry, { name: 'account_tier', purpose: '' });
    expect('error' in empty).toBe(true);

    const whitespace = declareVariable(baseRegistry, { name: 'account_tier', purpose: '   ' });
    expect('error' in whitespace).toBe(true);
  });
});

describe('undeclaredVariables', () => {
  it('returns placeholder names used in text that are not declared anywhere in the registry', () => {
    const registry: VariablesRegistry = {
      entries: [{ name: 'declared_one', purpose: 'p', sample: 's', required: true, source: 'session' }],
    };
    const text = 'Hello {{declared_one}}, meet {{not_declared_anywhere}} and {{another_unknown}}.';
    expect(undeclaredVariables(registry, text)).toEqual(['another_unknown', 'not_declared_anywhere']);
  });

  it('returns an empty array when every placeholder is declared', () => {
    const registry: VariablesRegistry = {
      entries: [{ name: 'declared_one', purpose: 'p', sample: 's', required: true, source: 'session' }],
    };
    expect(undeclaredVariables(registry, 'Hello {{declared_one}}.')).toEqual([]);
  });

  it('returns an empty array for text with no placeholders', () => {
    expect(undeclaredVariables({ entries: [] }, 'No placeholders here.')).toEqual([]);
  });

  it('is deduped and sorted', () => {
    const registry: VariablesRegistry = { entries: [] };
    const text = '{{zebra}} {{alpha}} {{zebra}}';
    expect(undeclaredVariables(registry, text)).toEqual(['alpha', 'zebra']);
  });

  it('honors built-in registry entries too, not just session ones', () => {
    // Given: the built-in registry; When / Then: a built-in placeholder is not undeclared
    const registry = buildBuiltinRegistry();
    expect(undeclaredVariables(registry, 'Hi {{product_name}}!')).toEqual([]);
  });
});
