// @module-tag dom
import { LEGACY_PROMPT_ROOTS } from '@prompt-studio/prompts';
import { describe, expect, it, vi } from 'vitest';
import type { PromptContentSource } from './prompt-content-source';
import { buildRootCatalog } from './root-catalog';

// A host application may map its prompt keys to tool names; the public build ships none, so this suite
// supplies a neutral map to exercise the derivation.
vi.mock('@prompt-studio/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@prompt-studio/prompts')>()),
  PROMPT_KEY_TOOL_NAMES: {
    triage: ['lookup_customer', 'create_ticket'],
    routing: ['create_ticket', 'assign_team'],
  },
}));

/** Resolves one symbol, as the bridge-backed source does once primed. */
const greetingSource: PromptContentSource = {
  getPromptText: (symbol) => (symbol === 'GREETING_PROMPT' ? 'Hello from a code constant.' : null),
  getToolSourceLists: () => [],
};

describe('buildRootCatalog', () => {
  it('includes every LEGACY_PROMPT_ROOTS id exactly once (no silently dropped roots)', () => {
    // Given / When: the catalog built without a manifest
    const catalog = buildRootCatalog();
    // Then: every inventory root appears exactly once (the public build ships an empty inventory)
    const catalogIds = catalog.map((root) => root.id);

    for (const inventoryEntry of LEGACY_PROMPT_ROOTS) {
      const matches = catalogIds.filter((id) => id === inventoryEntry.id);
      expect(matches, `expected exactly one catalog entry for "${inventoryEntry.id}"`).toHaveLength(1);
    }

    expect(catalog).toHaveLength(LEGACY_PROMPT_ROOTS.length);
  });

  it('gives roots with no editable keys an empty toolNames array', () => {
    // Given: a manifest document that declares no editable keys
    const manifest = {
      catalog: {
        source: 'explicit',
        documents: [{ id: 'plain', title: 'Plain', source: { kind: 'file', path: 'p.md' } }],
      },
    };
    // When: the catalog is built
    const plain = buildRootCatalog(undefined, manifest as never, new Map([['p.md', 'Text.']]))[0];
    // Then: it has no tools
    expect(plain.entry.editableKeys).toHaveLength(0);
    expect(plain.toolNames).toEqual([]);
  });

  it('produces deduped, sorted tool names derived from editableKeys', () => {
    // Given: a document whose two editable keys share a tool
    const manifest = {
      catalog: {
        source: 'explicit',
        documents: [
          {
            id: 'support',
            title: 'Support',
            source: { kind: 'file', path: 'support.md' },
            editableKeys: ['triage', 'routing'],
          },
        ],
      },
    };
    // When: the catalog is built
    const support = buildRootCatalog(undefined, manifest as never, new Map([['support.md', 'Text.']]))[0];
    // Then: the union of both keys' tools, once each, sorted
    expect(support.toolNames).toEqual(['assign_team', 'create_ticket', 'lookup_customer']);
  });

  it('carries the synthesized inventory entry through for the inspector', () => {
    // Given: a symbol-sourced manifest document
    const manifest = {
      catalog: {
        source: 'explicit',
        documents: [
          {
            id: 'greeting',
            title: 'Greeting',
            source: { kind: 'symbol', module: 'src/greeting.ts', symbol: 'GREETING_PROMPT' },
            editableKeys: ['triage'],
          },
        ],
      },
    };
    // When: the catalog is built
    const greeting = buildRootCatalog(greetingSource, manifest as never)[0];
    // Then: the inspector's entry names the owner module and symbol, with the declared keys
    expect(greeting.entry).toMatchObject({
      id: 'greeting',
      owner: { module: 'src/greeting.ts', symbol: 'GREETING_PROMPT' },
      editableKeys: ['triage'],
      protectedSkills: [],
    });
    expect(greeting.status).toBe('live');
    expect(greeting.title).toBe('Greeting');
  });

  it('is deterministic across calls', () => {
    // Given / When / Then: two builds are equal
    const first = buildRootCatalog();
    const second = buildRootCatalog();
    expect(second).toEqual(first);
  });

  describe('explicit catalog (third-party manifests)', () => {
    const explicitManifest = {
      catalog: {
        source: 'explicit',
        documents: [
          { id: 'greeter', title: 'Greeter', source: { kind: 'file', path: 'vendor/prompts/greeter.md' } },
          {
            id: 'symbol-doc',
            title: 'Symbol document',
            source: { kind: 'symbol', module: 'vendor/x.ts', symbol: 'GREETING_PROMPT' },
          },
        ],
      },
    };

    it('builds ONLY from the declared documents — inventory roots are absent', () => {
      // Given / When: the catalog built from an explicit manifest
      const catalog = buildRootCatalog(undefined, explicitManifest as never, new Map());
      // Then: exactly the declared documents, in order — a third-party manifest never drags another
      // prompt tree along with it.
      expect(catalog.map((root) => root.id)).toEqual(['greeter', 'symbol-doc']);
    });

    it('resolves file sources from the fetched file texts and symbol sources through the source seam', () => {
      // Given: the greeter file's fetched text and a source that resolves the symbol
      // When: the catalog is built
      const catalog = buildRootCatalog(
        greetingSource,
        explicitManifest as never,
        new Map([['vendor/prompts/greeter.md', '# Greeter\n']]),
      );
      // Then: both are openable constants with their text
      const greeter = catalog.find((root) => root.id === 'greeter');
      expect(greeter?.loadability).toBe('constant');
      expect(greeter?.text).toBe('# Greeter\n');
      expect(greeter?.ownerLabel).toBe('<file vendor/prompts/greeter.md>');
      const symbolDoc = catalog.find((root) => root.id === 'symbol-doc');
      expect(symbolDoc?.loadability).toBe('constant');
      expect(symbolDoc?.text).toBe('Hello from a code constant.');
    });

    it('lists a symbol document the source cannot resolve as external (visible, not openable)', () => {
      // Given / When: the default source, which resolves no symbol before it is primed
      const symbolDoc = buildRootCatalog(undefined, explicitManifest as never, new Map()).find(
        (root) => root.id === 'symbol-doc',
      );
      // Then: the row stays, without text
      expect(symbolDoc?.loadability).toBe('external');
      expect(symbolDoc?.text).toBeUndefined();
    });

    it('keeps a file document clickable when its text has not loaded yet', () => {
      // Given / When: no file texts fetched yet; Then: the file document is an empty constant
      const catalog = buildRootCatalog(undefined, explicitManifest as never);
      const greeter = catalog.find((root) => root.id === 'greeter');
      expect(greeter?.loadability).toBe('constant');
      expect(greeter?.text).toBe('');
    });

    it('appends extraDocuments after explicit documents, minus id collisions', () => {
      // Given: extra documents, one of which reuses an explicit id
      const manifest = {
        ...explicitManifest,
        extraDocuments: [
          { id: 'symbol-doc', title: 'Shadowed', source: { kind: 'file', path: 'vendor/other.md' } },
          { id: 'extra-doc', title: 'Extra', source: { kind: 'file', path: 'vendor/extra.md' } },
        ],
      };
      // When: the catalog is built; Then: the colliding extra document is dropped, the new one appended
      const catalog = buildRootCatalog(undefined, manifest as never, new Map());
      expect(catalog.map((root) => root.id)).toEqual(['greeter', 'symbol-doc', 'extra-doc']);
    });
  });
});
