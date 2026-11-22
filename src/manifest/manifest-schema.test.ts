// @module-tag dom
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MANIFEST } from './default-manifest';
import { isRelativeDirPath, MAX_CONTENT_ROOTS, validateStudioManifest } from './manifest-schema';
import defaultManifestJson from './default.manifest.json';

/**
 * Schema-boundary coverage for the studio manifest (ADR-235): the checked-in default manifest is
 * valid, `'+': 'reject'` holds, and every documented structural invariant (flat document ids,
 * relative-only content roots, root cap, unique ids, non-empty baselines) rejects its violator.
 */

/** A minimal valid manifest, shaped like a real manifest, that each test mutates. */
type ManifestFixture = {
  schemaVersion: number;
  name: string;
  contentRoots: string[];
  skillsRoot: string;
  exportRoot: string;
  catalog: { source: string; documents?: Array<Record<string, unknown>>; [extraKey: string]: unknown };
  extraDocuments?: Array<Record<string, unknown>>;
  baselines: Array<Record<string, unknown>>;
  [extraKey: string]: unknown;
};

function validManifest(): ManifestFixture {
  return {
    schemaVersion: 1,
    name: 'test',
    contentRoots: ['packages/prompts'],
    skillsRoot: 'packages/skills/skills',
    exportRoot: 'packages/prompts/src/blueprints',
    catalog: { source: 'legacy-inventory' },
    baselines: [
      {
        id: 'default',
        label: 'Default',
        description: 'The shipped prompt set.',
        positioning: 'shipped',
        source: { kind: 'shipped' },
      },
    ],
  };
}

describe('validateStudioManifest', () => {
  it('accepts the checked-in default.manifest.json', () => {
    const parsed = validateStudioManifest(defaultManifestJson);
    expect(parsed).not.toBeInstanceOf(type.errors);
  });

  it('accepts a minimal valid manifest and rejects an unknown top-level key', () => {
    expect(validateStudioManifest(validManifest())).not.toBeInstanceOf(type.errors);
    const withExtra = { ...validManifest(), surprise: 'no' };
    const result = validateStudioManifest(withExtra);
    expect(result).toBeInstanceOf(type.errors);
  });

  it("rejects any schemaVersion other than 1 — including a future '2'", () => {
    expect(validateStudioManifest({ ...validManifest(), schemaVersion: 2 })).toBeInstanceOf(type.errors);
    expect(validateStudioManifest({ ...validManifest(), schemaVersion: '1' })).toBeInstanceOf(type.errors);
  });

  describe('contentRoots', () => {
    it('rejects an absolute path, a drive-letter path, and a bare "."', () => {
      for (const bad of ['/etc', 'C:/repo', '.']) {
        const manifest = validManifest();
        manifest.contentRoots = [bad];
        expect(validateStudioManifest(manifest)).toBeInstanceOf(type.errors);
      }
    });

    it('rejects a parent-traversal segment and an empty list', () => {
      const traversal = validManifest();
      traversal.contentRoots = ['packages/../secrets'];
      expect(validateStudioManifest(traversal)).toBeInstanceOf(type.errors);

      const empty = validManifest();
      empty.contentRoots = [];
      expect(validateStudioManifest(empty)).toBeInstanceOf(type.errors);
    });

    it(`rejects more than ${MAX_CONTENT_ROOTS} roots and duplicate roots`, () => {
      const tooMany = validManifest();
      tooMany.contentRoots = Array.from({ length: MAX_CONTENT_ROOTS + 1 }, (_, i) => `root-${i}`);
      expect(validateStudioManifest(tooMany)).toBeInstanceOf(type.errors);

      const duplicated = validManifest();
      duplicated.contentRoots = ['packages/prompts', 'packages/prompts'];
      expect(validateStudioManifest(duplicated)).toBeInstanceOf(type.errors);
    });
  });

  describe('documents (extraDocuments and explicit catalogs)', () => {
    it('rejects a document id containing "/" — provider rootKeys must stay flat', () => {
      const manifest = validManifest();
      manifest.extraDocuments = [{ id: 'nested/doc', title: 'Nested', source: { kind: 'file', path: 'docs/doc.md' } }];
      expect(validateStudioManifest(manifest)).toBeInstanceOf(type.errors);
    });

    it('rejects a file source with an absolute path, and accepts a symbol source', () => {
      const absolute = validManifest();
      absolute.extraDocuments = [{ id: 'doc', title: 'Doc', source: { kind: 'file', path: '/etc/passwd' } }];
      expect(validateStudioManifest(absolute)).toBeInstanceOf(type.errors);

      const symbol = validManifest();
      symbol.extraDocuments = [
        {
          id: 'scout-again',
          title: 'Scout',
          group: 'prompts',
          editableKeys: ['scout'],
          source: { kind: 'symbol', module: 'packages/prompts/src/scout.ts', symbol: 'SCOUT_PROMPT' },
        },
      ];
      expect(validateStudioManifest(symbol)).not.toBeInstanceOf(type.errors);
    });

    it('rejects an explicit catalog with an unknown source kind', () => {
      const manifest = validManifest();
      manifest.catalog = { source: 'surprise' };
      expect(validateStudioManifest(manifest)).toBeInstanceOf(type.errors);
    });
  });

  describe('baselines', () => {
    it('rejects an empty baselines list and duplicate baseline ids', () => {
      const empty = validManifest();
      empty.baselines = [];
      expect(validateStudioManifest(empty)).toBeInstanceOf(type.errors);

      const duplicated = validManifest();
      duplicated.baselines = [
        { id: 'default', label: 'A', description: 'a', source: { kind: 'shipped' } },
        { id: 'default', label: 'B', description: 'b', source: { kind: 'shipped' } },
      ];
      expect(validateStudioManifest(duplicated)).toBeInstanceOf(type.errors);
    });

    it('rejects an unknown baseline source kind and a positioning outside the enum', () => {
      const badSource = validManifest();
      badSource.baselines = [
        { id: 'x', label: 'X', description: 'x', source: { kind: 'remote', url: 'https://evil' } },
      ];
      expect(validateStudioManifest(badSource)).toBeInstanceOf(type.errors);

      const badPositioning = validManifest();
      badPositioning.baselines = [
        { id: 'x', label: 'X', description: 'x', positioning: 'preset', source: { kind: 'shipped' } },
      ];
      expect(validateStudioManifest(badPositioning)).toBeInstanceOf(type.errors);
    });

    it('accepts a sales-mode-approach baseline — the reference-configuration shape', () => {
      const manifest = validManifest();
      manifest.baselines.push({
        id: 'job-seeker-personal-broker',
        label: 'Job Seeker (reference)',
        description: 'Calibration reference configuration.',
        positioning: 'reference',
        source: { kind: 'sales-mode-approach', approachId: 'job-seeker-personal-broker' },
      });
      expect(validateStudioManifest(manifest)).not.toBeInstanceOf(type.errors);
    });
  });

  describe('recursive strictness — "+": "reject" at every nesting level', () => {
    // The top-level reject is pinned above; these pin the NESTED objects. A manifest is
    // operator-influenced input — an unknown key smuggled into a nested object must be
    // rejected, not silently stripped (the same discipline as the top level, ADR-066).
    it('rejects unknown keys inside a document, its source, a baseline, and the catalog', () => {
      const documentExtra = validManifest();
      documentExtra.extraDocuments = [
        { id: 'doc', title: 'Doc', surprise: 1, source: { kind: 'file', path: 'docs/doc.md' } },
      ];
      expect(validateStudioManifest(documentExtra)).toBeInstanceOf(type.errors);

      const sourceExtra = validManifest();
      sourceExtra.extraDocuments = [
        { id: 'doc', title: 'Doc', source: { kind: 'file', path: 'docs/doc.md', url: 'https://evil' } },
      ];
      expect(validateStudioManifest(sourceExtra)).toBeInstanceOf(type.errors);

      const baselineExtra = validManifest();
      baselineExtra.baselines = [{ id: 'x', label: 'X', description: 'x', secret: true, source: { kind: 'shipped' } }];
      expect(validateStudioManifest(baselineExtra)).toBeInstanceOf(type.errors);

      const catalogExtra = validManifest();
      catalogExtra.catalog = { source: 'legacy-inventory', note: 'hi' };
      expect(validateStudioManifest(catalogExtra)).toBeInstanceOf(type.errors);
    });
  });

  describe('file source paths', () => {
    it('rejects a parent-traversal path — not just absolute ones', () => {
      const manifest = validManifest();
      manifest.extraDocuments = [{ id: 'doc', title: 'Doc', source: { kind: 'file', path: '../outside.md' } }];
      expect(validateStudioManifest(manifest)).toBeInstanceOf(type.errors);

      const sneaky = validManifest();
      sneaky.extraDocuments = [{ id: 'doc', title: 'Doc', source: { kind: 'file', path: 'docs/../secrets.md' } }];
      expect(validateStudioManifest(sneaky)).toBeInstanceOf(type.errors);
    });
  });
});

describe('isRelativeDirPath', () => {
  it('accepts real repo-relative directory paths', () => {
    expect(isRelativeDirPath('packages/prompts')).toBe(true);
    expect(isRelativeDirPath('docs/prompts')).toBe(true);
  });

  it('rejects absolute, traversal, empty, dot, and trailing-slash-empty forms', () => {
    for (const bad of ['', '.', '..', '/abs', 'a/../b', 'a//b', 'a/', 'C:/x']) {
      expect(isRelativeDirPath(bad)).toBe(false);
    }
  });
});

describe('DEFAULT_MANIFEST', () => {
  it('matches the checked-in default manifest exactly', () => {
    // Given: the bundled default.manifest.json, validated at module load
    // When: the studio falls back to it (no active manifest served)
    // Then: it describes a generic prompts/skills project with an explicit, empty catalog
    expect(DEFAULT_MANIFEST).toEqual(defaultManifestJson);
    expect(DEFAULT_MANIFEST.name).toBe('prompts');
    expect(DEFAULT_MANIFEST.contentRoots).toEqual(['prompts', 'skills']);
    expect(DEFAULT_MANIFEST.catalog).toEqual({ source: 'explicit', documents: [] });
    expect(DEFAULT_MANIFEST.extraDocuments).toBeUndefined();
  });

  it('declares exactly one shipped baseline for the repository prompts', () => {
    // Given: the bundled default manifest
    // When: the configuration picker lists its baselines
    // Then: only the repository's own prompts are offered, positioned as the shipped baseline
    expect(DEFAULT_MANIFEST.baselines.map(({ id, positioning, source }) => ({ id, positioning, source }))).toEqual([
      { id: 'repository', positioning: 'shipped', source: { kind: 'shipped' } },
    ]);
  });
});
