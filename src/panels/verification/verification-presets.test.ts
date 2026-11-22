// @module-tag pure
import {
  type PromptOutputContract,
  type PromptVerificationProfile,
  runPromptVerificationProfile,
} from '@prompt-studio/prompts';
import { expect, it } from 'vitest';
import { appendVerificationRules, verificationPresets } from './verification-presets';

const profile: PromptVerificationProfile = {
  id: 'section.verification',
  version: 4,
  scope: 'section',
  sectionId: 'mission',
  deterministicRules: [],
  principles: [
    {
      id: 'protected',
      version: 2,
      owner: 'platform',
      statement: 'Preserve the evidence.',
      severity: 'warning',
      allowedCustomization: 'Read only.',
      sectionIds: ['mission'],
    },
  ],
};
const context = {
  text: 'Use lookup to answer {{question}} for {{customer}}. Repeat {{question}}.',
  knownVariables: ['question', 'customer'],
  toolNames: ['lookup', 'unused'],
};

it('seeds useful checks from the existing prompt, with no invented requirements or source edits', () => {
  const presets = verificationPresets(context);
  const rules = presets.flatMap((preset) => ('rules' in preset ? preset.rules : []));
  expect(rules.filter((rule) => rule.kind === 'required-placeholder')).toMatchObject([
    { name: 'question' },
    { name: 'customer' },
  ]);
  expect(rules.filter((rule) => rule.kind === 'required-tool')).toMatchObject([{ name: 'lookup' }]);
  const saved = appendVerificationRules(profile, rules);
  expect(runPromptVerificationProfile(saved, context.text, { toolNames: context.toolNames })).toEqual([]);
  expect(
    runPromptVerificationProfile(saved, context.text.replaceAll('{{question}}', ''), {
      toolNames: context.toolNames,
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: expect.stringContaining('question') })]));
  expect(saved).toMatchObject({ id: profile.id, version: profile.version, scope: 'section', sectionId: 'mission' });
  expect(saved.principles).toBe(profile.principles);
  expect(profile.deterministicRules).toEqual([]);
  expect(context.text).toBe('Use lookup to answer {{question}} for {{customer}}. Repeat {{question}}.');
});

it('does not bless detected unknown variables or manufacture an empty allowlist', () => {
  const presets = verificationPresets({ ...context, knownVariables: ['question'] });
  const known = presets
    .flatMap((preset) => ('rules' in preset ? preset.rules : []))
    .find((rule) => rule.kind === 'known-placeholder');
  expect(known).toMatchObject({ allowedNames: ['question'] });
  const empty = verificationPresets({ text: '', knownVariables: [], toolNames: [] });
  expect(empty.flatMap((preset) => ('rules' in preset ? preset.rules : [])).map((rule) => rule.kind)).toEqual([
    'non-empty',
  ]);
  expect(empty.filter((preset) => 'kind' in preset).map((preset) => preset.kind)).toEqual([
    'required-output-literal',
    'forbidden-combination',
    'minimum-length',
  ]);
});

it('offers a selected phrase only when it occurs verbatim in the current source', () => {
  const selectedText = ' {{question}} ';
  expect(
    verificationPresets({ ...context, selectedText }).flatMap((preset) => ('rules' in preset ? preset.rules : [])),
  ).toContainEqual(expect.objectContaining({ kind: 'required-output-literal', literal: selectedText }));
  expect(
    verificationPresets({ ...context, selectedText: 'A stale selection' }).flatMap((preset) =>
      'rules' in preset ? preset.rules : [],
    ),
  ).not.toContainEqual(expect.objectContaining({ kind: 'required-output-literal' }));
});

it('offers JSON contract example checks only for a JSON contract with a schema', () => {
  const json: PromptOutputContract = {
    kind: 'json',
    description: 'Answer JSON',
    jsonSchema: { type: 'object' },
    examples: [{}],
  };
  const hasJson = (outputContract?: typeof json | { kind: 'freeform'; description: string }) =>
    verificationPresets({ ...context, outputContract }).some(
      (preset) => 'rules' in preset && preset.rules.some((rule) => rule.kind === 'valid-json-output'),
    );
  expect(hasJson()).toBe(false);
  expect(hasJson({ kind: 'freeform', description: 'Write JSON if helpful' })).toBe(false);
  expect(hasJson(json)).toBe(true);
  const rules = verificationPresets({ ...context, outputContract: json }).flatMap((preset) =>
    'rules' in preset ? preset.rules : [],
  );
  const saved = appendVerificationRules(
    profile,
    rules.filter((rule) => rule.kind === 'valid-json-output'),
  );
  expect(runPromptVerificationProfile(saved, 'These are instructions, not JSON.', { outputContract: json })).toEqual(
    [],
  );
  expect(
    verificationPresets({ ...context, outputContract: { kind: 'json', description: 'Missing schema' } }).some(
      (preset) => 'rules' in preset && preset.rules.some((rule) => rule.kind === 'valid-json-output'),
    ),
  ).toBe(false);
});

it('deduplicates by meaning, preserves existing identities and avoids colliding new IDs', () => {
  const existing: PromptVerificationProfile = {
    ...profile,
    deterministicRules: [
      {
        id: 'keep-id',
        kind: 'known-placeholder',
        allowedNames: ['customer', 'question'],
        severity: 'error',
        enforcement: 'runtime',
      },
      {
        id: 'non-empty',
        kind: 'required-output-literal',
        literal: 'Unrelated rule',
        severity: 'warning',
        enforcement: 'edit',
      },
    ],
  };
  const presets = verificationPresets(context, existing.deterministicRules);
  expect(
    presets.some((preset) => 'rules' in preset && preset.rules.some((rule) => rule.kind === 'known-placeholder')),
  ).toBe(false);
  const additions = presets.flatMap((preset) => ('rules' in preset ? preset.rules : []));
  const saved = appendVerificationRules(existing, additions);
  expect(saved.deterministicRules.slice(0, 2)).toEqual(existing.deterministicRules);
  expect(new Set(saved.deterministicRules.map((rule) => rule.id)).size).toBe(saved.deterministicRules.length);
  expect(appendVerificationRules(saved, additions)).toBe(saved);
  expect(verificationPresets(context, saved.deterministicRules).filter((preset) => 'rules' in preset)).toEqual([]);
});

it('treats a reversed forbidden pair as the same check and adds identical requests once', () => {
  const existing: PromptVerificationProfile = {
    ...profile,
    deterministicRules: [
      {
        id: 'existing-pair',
        kind: 'forbidden-combination',
        first: 'Always call tools',
        second: 'Never call tools',
        severity: 'warning',
        enforcement: 'runtime',
      },
    ],
  };
  const reversed = {
    ...existing.deterministicRules[0],
    id: 'new-pair',
    first: 'Never call tools',
    second: 'Always call tools',
  };
  const minimum = {
    id: 'minimum',
    kind: 'minimum-length' as const,
    minChars: 30,
    severity: 'error' as const,
    enforcement: 'edit' as const,
  };
  const saved = appendVerificationRules(existing, [reversed, minimum, minimum]);
  expect(saved.deterministicRules).toEqual([...existing.deterministicRules, minimum]);
});
