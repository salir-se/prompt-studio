import { createBlankPromptDesign, validatePromptDesign } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { runRootVerification } from '../panels/VerificationPanel';
import { authoredPromptRootsFromHeads, promptDesignProviderKey, serializePromptDesign } from './prompt-design-project';

describe('authored prompt project sidecars', () => {
  it('verifies native Markdown sections without changing source or losing their graph attribution', () => {
    const created = createBlankPromptDesign({ id: 'summary', title: 'Summary' });
    const text = '# Summary\n\n## Instructions\nSummarize the source.\n\n## Output\nCite evidence.\n';
    const [root] = authoredPromptRootsFromHeads(
      new Map([
        ['summary', text],
        [promptDesignProviderKey('summary'), serializePromptDesign(created.design)],
      ]),
    ).roots;
    if (!root) throw new Error('Missing native root');
    expect(root.text).toBe(text);
    expect(root.design && validatePromptDesign(root.design, text)).toEqual([]);
    const verification = runRootVerification(root, text);
    expect(verification?.sections.map((section) => section.heading)).toEqual([
      'Instructions',
      'Output',
      'Whole prompt',
    ]);
    expect(verification?.sections[0]?.text).toContain('Summarize the source.');
    expect(verification?.sectionNodeIds['summary#summary/instructions']).toBe('summary/instructions');
  });
  it('replaces untouched starter section metadata when the author replaces its source tag', () => {
    const created = createBlankPromptDesign({ id: 'summary', title: 'Summary' });
    const text = created.text.replaceAll('mission>', 'task>');
    const [root] = authoredPromptRootsFromHeads(
      new Map([
        ['summary', text],
        [promptDesignProviderKey('summary'), serializePromptDesign(created.design)],
      ]),
    ).roots;
    expect(root?.design?.sectionDesigns.map((section) => section.sectionId)).toEqual(['summary.task']);
    expect(root?.design && validatePromptDesign(root.design, text)).toEqual([]);
    const [restored] = authoredPromptRootsFromHeads(
      new Map([
        ['summary', created.text],
        [promptDesignProviderKey('summary'), serializePromptDesign(root?.design ?? created.design)],
      ]),
    ).roots;
    expect(restored?.design?.sectionDesigns).toEqual(created.design.sectionDesigns);
    expect(restored?.design?.verificationProfiles).toHaveLength(created.design.verificationProfiles.length);
    expect(restored?.design?.verificationProfiles).toEqual(
      expect.arrayContaining([...created.design.verificationProfiles]),
    );
    expect(restored?.design && validatePromptDesign(restored.design, created.text)).toEqual([]);
  });
  it.each(['contract', 'profile'])('preserves customized %s metadata when source removes its section', (kind) => {
    const created = createBlankPromptDesign({ id: 'summary', title: 'Summary' });
    const design =
      kind === 'contract'
        ? {
            ...created.design,
            sectionDesigns: created.design.sectionDesigns.map((section) => ({
              ...section,
              workflow: 'flowchart LR\n Read --> Cite',
            })),
          }
        : {
            ...created.design,
            verificationProfiles: created.design.verificationProfiles.map((profile) =>
              profile.scope === 'section' ? { ...profile, deterministicRules: [] } : profile,
            ),
          };
    const [root] = authoredPromptRootsFromHeads(
      new Map([
        ['summary', created.text.replaceAll('mission>', 'task>')],
        [promptDesignProviderKey('summary'), serializePromptDesign(design)],
      ]),
    ).roots;
    expect(root?.design?.sectionDesigns[0]).toEqual(design.sectionDesigns[0]);
    expect(root?.design?.verificationProfiles).toEqual(
      expect.arrayContaining(design.verificationProfiles.filter((profile) => profile.scope === 'section')),
    );
    expect(root?.design?.verificationProfiles.find((profile) => profile.scope === 'consolidated')?.dependsOn).toEqual(
      expect.arrayContaining(['summary.mission.verification', 'summary.task.verification']),
    );
  });

  it('initializes new nested section metadata from writing while preserving authored contracts', () => {
    const created = createBlankPromptDesign({ id: 'summary', title: 'Summary' });
    const design = { ...created.design, workflow: 'flowchart LR\n Read --> Summarize' };
    const text = `${created.text}\n## Output\n<output>\nCite evidence.\n<evidence>\nQuote sources.\n</evidence>\n</output>\n`;
    const [root] = authoredPromptRootsFromHeads(
      new Map([
        ['summary', text],
        [promptDesignProviderKey('summary'), serializePromptDesign(design)],
      ]),
    ).roots;
    expect(root?.design?.sectionDesigns.map((section) => section.sectionId)).toEqual([
      'summary.mission',
      'summary.output',
      'summary.evidence',
    ]);
    expect(root?.design?.workflow).toBe(design.workflow);
    expect(root?.design?.sectionDesigns[0]).toEqual(design.sectionDesigns[0]);
    expect(root?.design && validatePromptDesign(root.design, text)).toEqual([]);
  });
  it('discovers a versioned prompt design and its current text from project heads', () => {
    const created = createBlankPromptDesign({ id: 'account-research', title: 'Account Research' });
    const heads = new Map([
      ['account-research', created.text],
      [promptDesignProviderKey('account-research'), serializePromptDesign(created.design)],
    ]);

    const result = authoredPromptRootsFromHeads(heads);

    expect(result.errors).toEqual([]);
    expect(result.roots).toEqual([
      expect.objectContaining({
        id: 'account-research',
        title: 'Account Research',
        text: created.text,
        design: created.design,
        verification: expect.objectContaining({
          toolNames: [],
          profiles: expect.arrayContaining([
            expect.objectContaining({
              scope: 'section',
              principles: [
                expect.objectContaining({ id: 'account-research.mission.structure.input', owner: 'configuration' }),
                expect.objectContaining({ id: 'account-research.mission.structure.workflow', owner: 'configuration' }),
                expect.objectContaining({ id: 'account-research.mission.structure.output', owner: 'configuration' }),
              ],
            }),
            expect.objectContaining({
              scope: 'consolidated',
              principles: [
                expect.objectContaining({ id: 'account-research.structure.input', owner: 'configuration' }),
                expect.objectContaining({ id: 'account-research.structure.workflow', owner: 'configuration' }),
                expect.objectContaining({ id: 'account-research.structure.output', owner: 'configuration' }),
              ],
            }),
          ]),
          sections: [expect.objectContaining({ id: 'account-research.mission', tag: 'mission' })],
        }),
      }),
    ]);

    const root = result.roots[0];
    if (!root) throw new Error('Expected the authored root.');
    const verification = runRootVerification(root, created.text);
    expect(verification?.sections[0]?.profile.principles.map((principle) => principle.id)).toEqual([
      'account-research.mission.structure.input',
      'account-research.mission.structure.workflow',
      'account-research.mission.structure.output',
    ]);
    expect(verification?.sections.find((section) => section.heading === 'Whole prompt')?.profile.principles).toEqual([
      expect.objectContaining({ id: 'account-research.structure.input' }),
      expect.objectContaining({ id: 'account-research.structure.workflow' }),
      expect.objectContaining({ id: 'account-research.structure.output' }),
    ]);
  });

  it('reports an invalid sidecar instead of silently dropping it', () => {
    const result = authoredPromptRootsFromHeads(
      new Map([
        ['broken', '<mission>broken</mission>'],
        [promptDesignProviderKey('broken'), '{"bad":true}'],
      ]),
    );

    expect(result.roots).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining('broken')]);
  });

  it('derives a cache warning for runtime variables without persisting a duplicate authored rule', () => {
    const created = createBlankPromptDesign({ id: 'freshness-check', title: 'Freshness Check' });
    const design = {
      ...created.design,
      variables: [
        {
          name: 'current_timestamp',
          purpose: 'Request time',
          sample: '2026-08-17T12:00:00Z',
          required: true,
          lifecycle: 'runtime' as const,
          encoding: 'xml-text' as const,
          presentation: 'placeholder' as const,
        },
      ],
    };
    const text = created.text.replace('</mission>', 'Generated at {{current_timestamp}}.\n</mission>');
    const heads = new Map([
      ['freshness-check', text],
      [promptDesignProviderKey('freshness-check'), serializePromptDesign(design)],
    ]);

    const [root] = authoredPromptRootsFromHeads(heads).roots;
    if (!root) throw new Error('Expected the authored root.');

    expect(design.verificationProfiles.flatMap((profile) => profile.deterministicRules)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'cache-sensitive-dynamic' })]),
    );
    expect(runRootVerification(root, text)?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'cache-sensitive-dynamic', subject: 'current_timestamp' }),
      ]),
    );
  });
});
