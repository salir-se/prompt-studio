// @module-tag pure
import { createBlankPromptDesign, parsePromptTree, projectCanonicalPromptTree } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { runRootVerification } from '../panels/root-verification';
import { verificationCoverage } from './coverage';

function fixture() {
  const created = createBlankPromptDesign({ id: 'example', title: 'Example' });
  const [root] = authoredPromptRootsFromHeads(
    new Map([
      ['example', created.text],
      [promptDesignProviderKey('example'), serializePromptDesign(created.design)],
    ]),
  ).roots;
  if (!root?.verification) throw new Error('Missing canonical fixture');
  const tree = projectCanonicalPromptTree(
    parsePromptTree({ key: root.id, text: created.text }),
    root.verification.sections,
  );
  return { root, tree, text: created.text };
}

describe('verification coverage projection', () => {
  it('counts canonical section configuration before a run and keeps whole-prompt checks separate', () => {
    const { root, tree } = fixture();
    const result = verificationCoverage(root, tree, null);
    expect(Object.values(result.byNodeId)).toEqual([
      {
        sectionId: 'example.mission',
        automatic: { basic: 1, custom: 0, status: 'not-checked' },
        ai: { generated: 3, custom: 0, status: 'not-checked' },
      },
    ]);
    expect(result.wholePrompt.automatic).toEqual({ basic: 2, custom: 0, status: 'not-checked' });
    expect(result.wholePrompt.ai.generated).toBe(3);
  });

  it('marks matching automatic snapshots current, changed text or rules stale, and AI independently not checked', () => {
    const { root, tree, text } = fixture();
    const run = runRootVerification(root, text);
    const current = Object.values(verificationCoverage(root, tree, run).byNodeId)[0];
    expect(current?.automatic.status).toBe('current');
    expect(current?.ai.status).toBe('not-checked');
    const edited = projectCanonicalPromptTree(
      parsePromptTree({ key: root.id, text: `${text}\nChanged source.` }),
      root.verification!.sections,
    );
    expect(Object.values(verificationCoverage(root, edited, run).byNodeId)[0]?.automatic.status).toBe('stale');
    const changed = {
      ...root,
      verification: {
        ...root.verification!,
        profiles: root.verification!.profiles.map((profile) => ({ ...profile, version: profile.version + 1 })),
      },
    };
    expect(Object.values(verificationCoverage(changed, tree, run).byNodeId)[0]?.automatic.status).toBe('stale');
  });

  it('counts configured custom rules and criteria without duplicating whole-prompt criteria onto sections', () => {
    const { root, tree } = fixture();
    const definition = root.verification!;
    const changed = {
      ...root,
      verification: {
        ...definition,
        profiles: definition.profiles.map((profile) =>
          profile.scope === 'section'
            ? {
                ...profile,
                deterministicRules: [
                  ...profile.deterministicRules,
                  {
                    id: 'evidence',
                    kind: 'required-output-literal' as const,
                    literal: 'Source:',
                    severity: 'warning' as const,
                    enforcement: 'edit' as const,
                  },
                ],
                principles: [
                  ...profile.principles,
                  {
                    id: 'grounding',
                    version: 1,
                    owner: 'configuration' as const,
                    statement: 'Require evidence.',
                    severity: 'warning' as const,
                    allowedCustomization: 'Editable',
                    sectionIds: [profile.sectionId],
                  },
                ],
              }
            : profile,
        ),
      },
    };
    const section = Object.values(
      verificationCoverage(changed, tree, null, { 'example.mission': 'current' }).byNodeId,
    )[0];
    expect(section?.automatic).toEqual({ basic: 1, custom: 1, status: 'not-checked' });
    expect(section?.ai).toEqual({ generated: 3, custom: 1, status: 'current' });
  });

  it('counts only the canonical section profile that verification actually executes', () => {
    const { root, tree } = fixture();
    const definition = root.verification!;
    const active = definition.profiles.find((profile) => profile.scope === 'section')!;
    const changed = {
      ...root,
      verification: {
        ...definition,
        profiles: [
          ...definition.profiles,
          {
            ...active,
            id: 'unused-profile-for-the-same-section',
            deterministicRules: [
              {
                id: 'unused',
                kind: 'minimum-length' as const,
                minChars: 400,
                severity: 'warning' as const,
                enforcement: 'edit' as const,
              },
            ],
          },
        ],
      },
    };
    expect(Object.values(verificationCoverage(changed, tree, null).byNodeId)[0]?.automatic).toEqual({
      basic: 1,
      custom: 0,
      status: 'not-checked',
    });
  });
});
