// @vitest-environment node
/**
 * Level 1 unit tests for `App.tsx`'s pure, module-local helper functions — no React, no rendering,
 * no history provider. These functions previously had NO direct coverage of their own; every branch
 * was only ever exercised incidentally by mounting the real `App` component in `App.test.tsx`
 * (see that file's own module doc for the Level 1/2/3 split this file is one third of).
 *
 * `spliceSectionBody`'s fixture tree comes from the REAL `parsePromptTree` (not hand-built
 * `PromptTreeNode` objects) so `section.range`/`section.text` are exactly what the parser would
 * hand `App.tsx` in production — hand-crafting those offsets would risk testing an invented shape
 * instead of the real contract between the parser and this splice.
 */ // @module-tag pure
// @module-tag pure

import { parsePromptTree, type PromptVerificationFinding } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { unreadableReason } from './components/Sidebar';
import { spliceSectionBody } from './hooks/use-document-editor';
import {
  filterDeclaredKnownPlaceholderFindings,
  resolveSessionSamplesForPreview,
} from './hooks/use-variables-registry';
import type { VerificationRunResult } from './panels/VerificationPanel';
import type { DeclaredVariable, VariablesRegistry } from './registry/variables-registry';

const FIXTURE_DOC = 'INTRO:\nHello there.\n\nYOUR MISSION:\nFind companies. {{icp_text}}\n\nWRAP UP:\nDone.\n';

function missionSection(docText: string) {
  const tree = parsePromptTree({ key: 'test-fixture', text: docText, toolNames: [] });
  const mission = tree.children.find((node) => node.title === 'YOUR MISSION');
  if (!mission) {
    throw new Error(
      `Fixture setup failed: expected a parsed "YOUR MISSION" section — got titles [${tree.children
        .map((node) => node.title)
        .join(', ')}]. Update FIXTURE_DOC if the parser's dialect rules changed.`,
    );
  }
  return mission;
}

describe('spliceSectionBody', () => {
  it('replaces a section body found verbatim within its own range, leaving the rest of the document untouched', () => {
    const mission = missionSection(FIXTURE_DOC);

    const next = spliceSectionBody(FIXTURE_DOC, mission, 'Do something else entirely. {{other_var}}');

    // The parsed section text includes the blank line after the body, so a replacement
    // without a trailing newline sits directly against the next heading.
    expect(next).toBe(
      'INTRO:\nHello there.\n\nYOUR MISSION:\nDo something else entirely. {{other_var}}WRAP UP:\nDone.\n',
    );
  });

  it('round-trips: splicing a body back in with itself is a no-op', () => {
    const mission = missionSection(FIXTURE_DOC);
    expect(spliceSectionBody(FIXTURE_DOC, mission, mission.text)).toBe(FIXTURE_DOC);
  });

  it('returns null, never a corrupted document, when the body cannot be found verbatim within the given range', () => {
    const mission = missionSection(FIXTURE_DOC);
    // Simulates a stale node whose range no longer matches its own text (e.g. computed against an
    // earlier version of the document) — `docText.slice(0, 5)` ("INTRO") cannot contain the
    // mission body, so the splice must refuse rather than guess.
    const staleSection = { ...mission, range: { start: 0, end: 5 } };

    expect(spliceSectionBody(FIXTURE_DOC, staleSection, 'anything')).toBeNull();
  });

  it('keeps a stable XML closing tag on its own line when edited text has no trailing newline', () => {
    const text = '<mission>\nFind companies.\n</mission>';
    const section = parsePromptTree({ key: 'xml-fixture', text }).children[0];

    expect(spliceSectionBody(text, section, 'Find better companies.')).toBe(
      '<mission>\nFind better companies.\n</mission>',
    );
  });
});

function registryOf(entries: readonly DeclaredVariable[]): VariablesRegistry {
  return { entries };
}

function sessionVariable(name: string, sample = ''): DeclaredVariable {
  return { name, purpose: 'test purpose', sample, required: true, source: 'session' };
}

describe('resolveSessionSamplesForPreview', () => {
  it('returns the text unchanged when the registry has no session-sourced entries at all', () => {
    const registry = registryOf([
      { name: 'icp_text', purpose: 'x', sample: 'builtin sample', required: true, source: 'builtin' },
    ]);
    expect(resolveSessionSamplesForPreview('Target: {{icp_text}}.', registry)).toBe('Target: {{icp_text}}.');
  });

  it('substitutes a session-declared sample for its matching placeholder', () => {
    const registry = registryOf([sessionVariable('icp_text', 'SaaS companies')]);
    expect(resolveSessionSamplesForPreview('Target: {{icp_text}}.', registry)).toBe('Target: SaaS companies.');
  });

  it('leaves the placeholder untouched when its session entry has an empty sample', () => {
    const registry = registryOf([sessionVariable('icp_text', '')]);
    expect(resolveSessionSamplesForPreview('Target: {{icp_text}}.', registry)).toBe('Target: {{icp_text}}.');
  });

  it('leaves an undeclared placeholder untouched even when other session samples exist', () => {
    const registry = registryOf([sessionVariable('icp_text', 'SaaS companies')]);
    expect(resolveSessionSamplesForPreview('{{icp_text}} and {{other_var}}', registry)).toBe(
      'SaaS companies and {{other_var}}',
    );
  });

  it('substitutes every occurrence of a repeated placeholder', () => {
    const registry = registryOf([sessionVariable('icp_text', 'SaaS')]);
    expect(resolveSessionSamplesForPreview('{{icp_text}} then {{icp_text}} again', registry)).toBe(
      'SaaS then SaaS again',
    );
  });
});

function knownPlaceholderFinding(subject: string, severity: PromptVerificationFinding['severity'] = 'warning') {
  return {
    profile: { id: 'scout', version: 1 },
    scope: 'consolidated',
    severity,
    message: `Unknown placeholder {{${subject}}}.`,
    source: 'deterministic',
    ruleId: 'known-placeholder',
    enforcement: 'edit',
    subject,
  } satisfies PromptVerificationFinding;
}

function otherDeterministicFinding(ruleId: string, severity: PromptVerificationFinding['severity'] = 'error') {
  return {
    profile: { id: 'scout', version: 1 },
    scope: 'consolidated',
    severity,
    message: `${ruleId} failed.`,
    source: 'deterministic',
    ruleId,
    enforcement: 'edit',
  } satisfies PromptVerificationFinding;
}

function semanticFinding(): PromptVerificationFinding {
  return {
    profile: { id: 'scout', version: 1 },
    scope: 'consolidated',
    severity: 'warning',
    message: 'Ambiguous placeholder usage.',
    source: 'semantic',
    principleId: 'clarity-001',
    evidenceQuote: 'do the thing',
    proposedCorrection: 'do the {specific_thing}',
  };
}

function resultOf(findings: readonly PromptVerificationFinding[]): VerificationRunResult {
  return {
    promptKey: 'scout',
    text: 'irrelevant to this pure function',
    state: findings.some((f) => f.severity === 'error')
      ? 'invalid'
      : findings.some((f) => f.severity === 'warning')
        ? 'warning'
        : 'valid',
    principles: [],
    findings,
    profiles: [],
    sections: [],
    sectionNodeIds: {},
  };
}

describe('filterDeclaredKnownPlaceholderFindings', () => {
  it('returns null unchanged when there is no verification result yet', () => {
    expect(filterDeclaredKnownPlaceholderFindings(null, registryOf([sessionVariable('icp_text')]))).toBeNull();
  });

  it('leaves findings untouched when the registry has no session-sourced entries', () => {
    const result = resultOf([knownPlaceholderFinding('icp_text')]);
    const filtered = filterDeclaredKnownPlaceholderFindings(result, registryOf([]));
    expect(filtered).toEqual(result);
  });

  it('filters out a known-placeholder finding whose subject is session-declared, recomputing state to valid', () => {
    const result = resultOf([knownPlaceholderFinding('icp_text')]);
    const filtered = filterDeclaredKnownPlaceholderFindings(result, registryOf([sessionVariable('icp_text')]));
    expect(filtered?.findings).toEqual([]);
    expect(filtered?.state).toBe('valid');
  });

  it('leaves a known-placeholder finding untouched when a DIFFERENT name is session-declared', () => {
    const result = resultOf([knownPlaceholderFinding('icp_text')]);
    const filtered = filterDeclaredKnownPlaceholderFindings(result, registryOf([sessionVariable('other_var')]));
    expect(filtered?.findings).toEqual([knownPlaceholderFinding('icp_text')]);
    expect(filtered?.state).toBe('warning');
  });

  it('never filters a semantic finding, even when its subject-shaped text overlaps a session-declared name', () => {
    const result = resultOf([knownPlaceholderFinding('icp_text'), semanticFinding()]);
    const filtered = filterDeclaredKnownPlaceholderFindings(result, registryOf([sessionVariable('icp_text')]));
    expect(filtered?.findings).toEqual([semanticFinding()]);
    // The remaining semantic finding is still warning-severity, so state stays 'warning'.
    expect(filtered?.state).toBe('warning');
  });

  it('keeps an edit-time deterministic error advisory when it survives the filter', () => {
    const result = resultOf([knownPlaceholderFinding('icp_text'), otherDeterministicFinding('non-empty', 'error')]);
    const filtered = filterDeclaredKnownPlaceholderFindings(result, registryOf([sessionVariable('icp_text')]));
    expect(filtered?.findings).toEqual([otherDeterministicFinding('non-empty', 'error')]);
    expect(filtered?.state).toBe('warning');
  });
});

describe('unreadableReason', () => {
  it('explains an "inline" root — assembled at call time, no single readable text', () => {
    expect(unreadableReason('inline')).toBe(
      'Assembled inline at call time — there is no single readable prompt root text to load.',
    );
  });

  it('explains an "external" root — defined in a module the studio cannot read as prompt text', () => {
    expect(unreadableReason('external')).toBe('Defined in an external module the studio cannot read as prompt text.');
  });
});
