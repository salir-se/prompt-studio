// @module-tag dom
/**
 * Tests for the export/import orchestration core (`export-flow.ts`) — driven entirely through the
 * REAL building blocks (`parsePromptTree`, `serializeBlueprint`/`deserializeBlueprint`, `packZip`/
 * `unpackZip`, `evaluateExportGate`), never mocks: the load-bearing property is the round trip,
 * and a mock would only prove the mock.
 */

import {
  createBlankPromptDesign,
  deserializeBlueprint,
  parsePromptTree,
  serializeBlueprint,
} from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import type { DeclaredVariable, VariablesRegistry } from '../registry/variables-registry';
import {
  applyImportedBlueprint,
  buildExportPlan,
  buildExportPreviewPaths,
  buildExportZip,
  selectExportVariables,
  sha256Hex,
} from './export-flow';
import { describeRefusalReason, evaluateExportGate } from './export-gate';
import { packZip, unpackZip } from './zip';

/**
 * A small but structurally real prompt: interstitial text BEFORE the first section (a gap the
 * round trip must preserve byte-exactly), two sections, and placeholders referencing exactly one
 * builtin-registered name plus one session-registered name.
 */
const DOC_TEXT =
  'Intro gap before any section.\n\n# MISSION\nServe {{used_builtin}} faithfully.\n\n# RULES\nBe kind.\n';

function makeEntry(name: string, source: DeclaredVariable['source']): DeclaredVariable {
  return { name, purpose: `Purpose of ${name}.`, sample: '', required: true, source };
}

/** Registry with one referenced builtin, one unreferenced builtin, and one unreferenced session entry. */
function makeRegistry(): VariablesRegistry {
  return {
    entries: [
      makeEntry('unused_builtin', 'builtin'),
      makeEntry('used_builtin', 'builtin'),
      makeEntry('session_only', 'session'),
    ],
  };
}

function makeTree() {
  return parsePromptTree({ key: 'scout', text: DOC_TEXT, toolNames: [] });
}

const ALLOWED_GATE = evaluateExportGate({ undeclaredVariables: [], findings: [] });
const REFUSED_GATE = evaluateExportGate({ undeclaredVariables: ['mystery'], findings: [] });

describe('sha256Hex', () => {
  it("matches the FIPS 180 known vector for 'abc'", async () => {
    await expect(sha256Hex('abc')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('buildExportPlan', () => {
  it('refuses when the doc text references a name absent from the registry', () => {
    const tree = makeTree();
    const { gate } = buildExportPlan({
      tree,
      registry: { entries: [makeEntry('session_only', 'session')] },
      docText: tree.text,
      findings: [],
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toEqual([{ kind: 'undeclared-variable', name: 'used_builtin' }]);
  });

  it('allows when every referenced name is declared and no finding is an error', () => {
    const tree = makeTree();
    const { gate } = buildExportPlan({ tree, registry: makeRegistry(), docText: tree.text, findings: [] });
    expect(gate.allowed).toBe(true);
  });
});

describe('selectExportVariables', () => {
  it('exports session entries plus referenced builtins, never unreferenced builtins', () => {
    const names = selectExportVariables(makeRegistry(), DOC_TEXT).map((variable) => variable.name);
    expect(names).toContain('used_builtin');
    expect(names).toContain('session_only');
    expect(names).not.toContain('unused_builtin');
  });
});

describe('buildExportZip', () => {
  it('previews the exact file paths later packed into the ZIP, including the design sidecar', async () => {
    const input = {
      tree: makeTree(),
      registry: makeRegistry(),
      gate: ALLOWED_GATE,
      design: createBlankPromptDesign({ id: 'scout', title: 'Scout' }).design,
    };

    const previewPaths = buildExportPreviewPaths(input);
    const { bytes } = await buildExportZip({ ...input, force: false });

    expect(previewPaths).toEqual(Object.keys(unpackZip(bytes)).sort());
    expect(previewPaths).toContain('packages/prompts/src/blueprints/scout/design.json');
    expect(previewPaths.some((path) => path.endsWith('.md'))).toBe(true);
  });

  it('round-trips: unpack + deserialize recovers the prompt text byte-identically, unforced', async () => {
    const tree = makeTree();
    const { bytes, filename } = await buildExportZip({
      tree,
      registry: makeRegistry(),
      gate: ALLOWED_GATE,
      force: false,
    });
    expect(filename).toBe('scout-blueprint.zip');

    const result = deserializeBlueprint(unpackZip(bytes));
    expect(result.root).toBe('scout');
    expect(result.text).toBe(DOC_TEXT);
    expect(result.manifest.forced).toBe(false);
    expect(result.manifest.overriddenReasons).toEqual([]);
    expect(result.manifest.sectionCount).toBe(tree.children.length);
    // The variables-export rule survives the archive: session + referenced builtin, nothing else.
    expect(result.variables.map((variable) => variable.name).sort()).toEqual(['session_only', 'used_builtin']);
  });

  it('records force: manifest.forced true with every overridden reason described verbatim', async () => {
    const { bytes } = await buildExportZip({
      tree: makeTree(),
      registry: makeRegistry(),
      gate: REFUSED_GATE,
      force: true,
    });
    const { manifest } = deserializeBlueprint(unpackZip(bytes));
    expect(manifest.forced).toBe(true);
    expect(manifest.overriddenReasons).toEqual([describeRefusalReason(REFUSED_GATE.reasons[0])]);
  });

  it('throws on a refused gate without force — the defensive half of the dialog guard', async () => {
    await expect(
      buildExportZip({ tree: makeTree(), registry: makeRegistry(), gate: REFUSED_GATE, force: false }),
    ).rejects.toThrow(/Export refused/);
  });
});

describe('applyImportedBlueprint', () => {
  function exportedFiles() {
    return serializeBlueprint({
      tree: makeTree(),
      variables: makeRegistry().entries,
      layout: {},
      promptSha256: 'test-sha',
    });
  }

  it('returns the byte-identical text and SESSION-source variables only', () => {
    const { text, variables } = applyImportedBlueprint({ files: exportedFiles(), expectedRoot: 'scout' });
    expect(text).toBe(DOC_TEXT);
    // Builtins re-derive from buildBuiltinRegistry() on import — only the session half comes back.
    expect(variables.map((variable) => variable.name)).toEqual(['session_only']);
  });

  it('survives a real pack/unpack cycle, not just an in-memory file map', () => {
    const { text } = applyImportedBlueprint({ files: unpackZip(packZip(exportedFiles())), expectedRoot: 'scout' });
    expect(text).toBe(DOC_TEXT);
  });

  it('throws a root mismatch naming BOTH roots when the archive targets a different root', () => {
    expect(() => applyImportedBlueprint({ files: exportedFiles(), expectedRoot: 'closer' })).toThrow(
      /'scout'.*'closer'/,
    );
  });
});
