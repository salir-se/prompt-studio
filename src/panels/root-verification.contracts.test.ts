// @module-tag pure
import { createBlankPromptDesign, type PromptDesign } from '@prompt-studio/prompts';
import { expect, it } from 'vitest';
import { authoredPromptRootsFromHeads, promptDesignProviderKey } from '../design/prompt-design-project';
import { runRootVerification } from './root-verification';

function fixture(invalid?: 'whole' | 'section') {
  const created = createBlankPromptDesign({ id: 'json-review', title: 'JSON review' });
  const design: PromptDesign = {
    ...created.design,
    output: {
      kind: 'json',
      description: 'The complete response.',
      jsonSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
      examples: [{ answer: invalid === 'whole' ? 42 : 'Ready' }],
    },
    sectionDesigns: created.design.sectionDesigns.map((section) => ({
      ...section,
      output: {
        kind: 'json',
        description: 'The section response.',
        jsonSchema: { type: 'object', required: ['score'], properties: { score: { type: 'integer' } } },
        examples: [{ score: invalid === 'section' ? 'invalid' : 3 }],
      },
    })),
    verificationProfiles: created.design.verificationProfiles.map((profile) => ({
      ...profile,
      deterministicRules: [
        ...profile.deterministicRules,
        {
          id: `json-examples-${profile.scope}`,
          kind: 'valid-json-output',
          severity: 'error',
          enforcement: 'edit',
        },
      ],
    })),
  };
  const loaded = authoredPromptRootsFromHeads(
    new Map([
      [design.id, created.text],
      [promptDesignProviderKey(design.id), JSON.stringify(design)],
    ]),
  );
  expect(loaded.errors).toEqual([]);
  return { root: loaded.roots[0]!, text: created.text };
}

it('checks distinct authored whole-prompt and section JSON contracts through the actual verification entrypoint', () => {
  const { root, text } = fixture();
  const result = runRootVerification(root, text);
  expect(result).not.toBeNull();
  expect(
    result!.findings.filter(
      (finding) => finding.source === 'deterministic' && finding.ruleId.startsWith('json-examples'),
    ),
  ).toEqual([]);
  expect(
    result!.profiles.filter((profile) => profile.deterministicRules.some((rule) => rule.kind === 'valid-json-output')),
  ).toHaveLength(2);
});

it.each(['whole', 'section'] as const)('attributes an invalid %s contract example only to its own scope', (invalid) => {
  const { root, text } = fixture(invalid);
  const result = runRootVerification(root, text);
  const findings = result!.findings.filter(
    (finding) => finding.source === 'deterministic' && finding.ruleId.startsWith('json-examples'),
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    scope: invalid === 'whole' ? 'consolidated' : 'section',
    ruleId: `json-examples-${invalid === 'whole' ? 'consolidated' : 'section'}`,
  });
  expect(findings[0].message).not.toContain('no JSON Schema');
});
