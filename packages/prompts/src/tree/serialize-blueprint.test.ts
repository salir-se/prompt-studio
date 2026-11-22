// @module-tag pure
import { describe, expect, it } from 'vitest';
import { createBlankPromptDesign } from '../prompt-design';
import { RELEASE_NOTES_PROMPT, SUPPORT_PLAYBOOK_PROMPT, SUPPORT_TRIAGE_PROMPT } from '../test-fixtures/example-prompts';
import { parsePromptTree } from './parse-tree';
import {
  type BlueprintFileMap,
  BlueprintParseError,
  type BlueprintVariableDeclaration,
  deserializeBlueprint,
  serializeBlueprint,
  type SerializeBlueprintInput,
} from './serialize-blueprint';

// ── Fixtures & helpers ───────────────────────────────────────────────────────

/** Realistic prompts the byte-identity property runs over (xml-tag and caps-label dialects). */
const REAL_PROMPTS: ReadonlyArray<readonly [key: string, text: string]> = [
  ['support-triage', SUPPORT_TRIAGE_PROMPT],
  ['release-notes', RELEASE_NOTES_PROMPT],
  ['support-playbook', SUPPORT_PLAYBOOK_PROMPT],
];

/** Deliberately NOT name-sorted, to prove the serializer sorts. */
const VARS: readonly BlueprintVariableDeclaration[] = [
  { name: 'today', purpose: 'Current date', sample: '2026-08-01', required: true, source: 'builtin' },
  { name: 'icp', purpose: 'ICP definition', sample: 'EU fintech scale-ups', required: false, source: 'session' },
];

function serialize(key: string, text: string, overrides: Partial<SerializeBlueprintInput> = {}): BlueprintFileMap {
  return serializeBlueprint({
    tree: parsePromptTree({ key, text }),
    variables: VARS,
    layout: { alpha: { x: 10, y: 20 } },
    promptSha256: 'deadbeef',
    ...overrides,
  });
}

/** Re-emits one JSON file after `edit` mutates its parsed document. */
function withJsonEdit(files: BlueprintFileMap, path: string, edit: (doc: any) => void): BlueprintFileMap {
  const doc = JSON.parse(files[path]);
  edit(doc);
  return { ...files, [path]: `${JSON.stringify(doc, null, 2)}\n` };
}

/** Asserts `deserializeBlueprint` throws a `BlueprintParseError` naming exactly this file and reason. */
function expectParseError(files: BlueprintFileMap, file: string, reason: string): void {
  let caught: unknown;
  try {
    deserializeBlueprint(files);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(BlueprintParseError);
  const parseError = caught as BlueprintParseError;
  expect(parseError.file).toBe(file);
  expect(parseError.reason).toBe(reason);
}

const BASE = 'packages/prompts/src/blueprints';

// ── Byte-identity over real prompts ──────────────────────────────────────────

describe('serializeBlueprint ⇄ deserializeBlueprint — byte identity over real prompts', () => {
  for (const [key, text] of REAL_PROMPTS) {
    it(`round-trips ${key.toUpperCase().replace(/-/g, '_')} byte-identically`, () => {
      // Given: a realistic prompt and its parsed tree
      const tree = parsePromptTree({ key, text });
      // When: it is serialized to blueprint files and read back
      const out = deserializeBlueprint(serialize(key, text));
      // Then: the text is byte-identical and the root keeps its key
      expect(out.text).toBe(text);
      expect(out.text).toBe(tree.text);
      expect(out.root).toBe(key);
    });
  }
});

it('round-trips the complete authored prompt design sidecar', () => {
  const created = createBlankPromptDesign({ id: 'authored', title: 'Authored prompt' });
  const files = serialize('authored', created.text, { design: created.design });
  expect(deserializeBlueprint(files).design).toEqual(created.design);
});

// ── Synthetic document: preamble, trailing bytes, nested children ────────────

describe('serializeBlueprint — synthetic doc with preamble, trailing bytes, and nesting', () => {
  // xml-tag sections leave their closing tag OUTSIDE the node range (see
  // parse-tree's closeFrame), so this doc genuinely produces a non-empty
  // preamble gap, a non-empty interstitial gap, AND non-empty trailing bytes.
  const SYNTHETIC = [
    'Preamble prose that belongs to no section.\n',
    '\n',
    '<alpha>\nalpha intro line\nNESTED LABEL:\nnested body line\n</alpha>\n',
    'between the two blocks\n',
    '<beta>\nbeta body line\n</beta>\n',
    'Trailing bytes after the last section.',
  ].join('');

  it('round-trips byte-identically', () => {
    const out = deserializeBlueprint(serialize('synthetic', SYNTHETIC));
    expect(out.text).toBe(SYNTHETIC);
  });

  it('keeps nested child bytes inside the parent section file, never in a file of their own', () => {
    const files = serialize('synthetic', SYNTHETIC);
    const sectionPaths = Object.keys(files).filter((path) => path.includes('/sections/'));
    expect(sectionPaths.sort()).toEqual([
      `${BASE}/synthetic/sections/01-alpha.md`,
      `${BASE}/synthetic/sections/02-beta.md`,
    ]);
    const alphaFile = files[`${BASE}/synthetic/sections/01-alpha.md`];
    expect(alphaFile).toContain('NESTED LABEL:');
    expect(alphaFile).toContain('nested body line');
  });

  it('stores the exact preamble, interstitial, and trailing bytes as gaps (sections + 1 of them)', () => {
    const files = serialize('synthetic', SYNTHETIC);
    const blueprint = JSON.parse(files[`${BASE}/synthetic/blueprint.json`]);
    expect(blueprint.sections).toHaveLength(2);
    expect(blueprint.gaps).toHaveLength(3);
    expect(blueprint.gaps[0]).toBe('Preamble prose that belongs to no section.\n\n');
    expect(blueprint.gaps[1]).toBe('</alpha>\nbetween the two blocks\n');
    expect(blueprint.gaps[2]).toBe('</beta>\nTrailing bytes after the last section.');
  });

  it('a structure-free prompt yields zero sections and gaps === [tree.text]', () => {
    const text = 'nothing structural here at all';
    const files = serialize('flat', text);
    const blueprint = JSON.parse(files[`${BASE}/flat/blueprint.json`]);
    expect(blueprint.sections).toEqual([]);
    expect(blueprint.gaps).toEqual([text]);
    expect(deserializeBlueprint(files).text).toBe(text);
  });

  it('round-trips the empty string', () => {
    expect(deserializeBlueprint(serialize('empty', '')).text).toBe('');
  });
});

// ── Metadata round-trip ──────────────────────────────────────────────────────

describe('serializeBlueprint — variables, layout, and manifest round-trip', () => {
  const TEXT = 'ONLY SECTION:\nbody with {{today}}\n';

  it('preserves variables sorted by name, layout positions, and every manifest field', () => {
    const files = serialize('meta', TEXT, {
      layout: { zeta: { x: 3, y: 4 }, alpha: { x: 1, y: 2 } },
      promptSha256: 'abc123',
      exportRecord: { forced: true, overriddenReasons: ['stale-verification'] },
    });
    const out = deserializeBlueprint(files);

    expect(out.variables.map((v) => v.name)).toEqual(['icp', 'today']);
    expect(out.variables).toEqual([VARS[1], VARS[0]]);
    expect(out.layout).toEqual({ alpha: { x: 1, y: 2 }, zeta: { x: 3, y: 4 } });
    expect(out.manifest).toEqual({
      format: 'salir-prompt-blueprint@1',
      root: 'meta',
      promptSha256: 'abc123',
      sectionCount: 1,
      variableCount: 2,
      forced: true,
      overriddenReasons: ['stale-verification'],
    });
  });

  it('defaults forced to false and overriddenReasons to [] when exportRecord is omitted', () => {
    const { manifest } = deserializeBlueprint(serialize('meta', TEXT));
    expect(manifest.forced).toBe(false);
    expect(manifest.overriddenReasons).toEqual([]);
  });
});

// ── layout.json isolation ────────────────────────────────────────────────────

describe('serializeBlueprint — layout.json isolation', () => {
  it('two serializations differing only in layout differ only in layout.json', () => {
    // Given / When: one prompt serialized twice with different layouts
    const a = serialize('support-triage', SUPPORT_TRIAGE_PROMPT, { layout: { n1: { x: 0, y: 0 } } });
    const b = serialize('support-triage', SUPPORT_TRIAGE_PROMPT, { layout: { n1: { x: 100, y: 50 } } });
    // Then: only layout.json differs
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const path of Object.keys(a)) {
      if (path.endsWith('/layout.json')) {
        expect(a[path]).not.toBe(b[path]);
      } else {
        expect(a[path]).toBe(b[path]);
      }
    }
  });
});

// ── Path safety ──────────────────────────────────────────────────────────────

describe('serializeBlueprint — path safety', () => {
  it('never emits a path containing "..", a leading "/", or a backslash', () => {
    const maps = [...REAL_PROMPTS.map(([key, text]) => serialize(key, text)), serialize('empty', '')];
    for (const files of maps) {
      for (const path of Object.keys(files)) {
        expect(path).not.toContain('..');
        expect(path.startsWith('/')).toBe(false);
        expect(path).not.toContain('\\');
      }
    }
  });

  it('rejects a tree.key that is not a safe path segment', () => {
    const tree = parsePromptTree({ key: '../escape', text: 'X:\nbody\n' });
    expect(() => serializeBlueprint({ tree, variables: [], layout: {}, promptSha256: 'x' })).toThrow(/safe path/);
  });
});

// ── Deserializer rejections ──────────────────────────────────────────────────

describe('deserializeBlueprint — rejections name the file and a stable reason', () => {
  const TEXT = 'FIRST SECTION:\nbody one\n\nSECOND SECTION:\nbody two\n';
  const base = `${BASE}/reject`;
  const files = serialize('reject', TEXT);

  it("rejects an unknown top-level JSON key (the '+': 'reject' proof)", () => {
    const tampered = withJsonEdit(files, `${base}/manifest.json`, (doc) => {
      doc.extraneous = true;
    });
    expectParseError(tampered, `${base}/manifest.json`, 'invalid-schema');
  });

  it('rejects an unknown key nested inside a variable declaration', () => {
    const tampered = withJsonEdit(files, `${base}/variables/variables.json`, (doc) => {
      doc.declarations[0].smuggled = 'yes';
    });
    expectParseError(tampered, `${base}/variables/variables.json`, 'invalid-schema');
  });

  it('rejects a section file listed in blueprint.json but absent from the map', () => {
    const missingPath = `${base}/sections/01-first-section.md`;
    const { [missingPath]: _omitted, ...rest } = files as Record<string, string>;
    expectParseError(rest, missingPath, 'missing-section-file');
  });

  it('rejects an extra file under sections/ that blueprint.json does not list', () => {
    const strayPath = `${base}/sections/99-stray.md`;
    expectParseError({ ...files, [strayPath]: 'stray bytes' }, strayPath, 'unexpected-section-file');
  });

  it('rejects a gaps/sections length mismatch', () => {
    const tampered = withJsonEdit(files, `${base}/blueprint.json`, (doc) => {
      doc.gaps = doc.gaps.slice(1);
    });
    expectParseError(tampered, `${base}/blueprint.json`, 'gap-count-mismatch');
  });

  it('rejects an empty map (zero blueprint roots)', () => {
    expectParseError({}, '<file-map>', 'no-blueprint-root');
  });

  it('rejects a map containing two blueprint roots', () => {
    const merged = { ...files, ...serialize('other', 'OTHER SECTION:\nother body\n') };
    expectParseError(merged, '<file-map>', 'multiple-blueprint-roots');
  });

  it('rejects a file outside the blueprint overlay prefix', () => {
    expectParseError({ ...files, 'README.md': 'stray' }, 'README.md', 'file-outside-blueprint-root');
  });

  it('rejects malformed JSON', () => {
    const tampered = { ...files, [`${base}/blueprint.json`]: '{ not json' };
    expectParseError(tampered, `${base}/blueprint.json`, 'malformed-json');
  });

  it('rejects a map missing a required JSON file', () => {
    const layoutPath = `${base}/layout.json`;
    const { [layoutPath]: _omitted, ...rest } = files as Record<string, string>;
    expectParseError(rest, layoutPath, 'missing-file');
  });
});
