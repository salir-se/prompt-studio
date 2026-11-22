// @module-tag pure
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createBlankPromptDesign, parsePromptDesign, PromptDesignSchema, validatePromptDesign } from './prompt-design';

describe('authored prompt design contract', () => {
  it('creates the smallest complete editable prompt from zero', () => {
    const created = createBlankPromptDesign({ id: 'candidate-research', title: 'Candidate Research' });

    expect(created.text).toContain('<mission>');
    expect(created.design).toMatchObject({
      format: 'salir-prompt-design@1',
      id: 'candidate-research',
      title: 'Candidate Research',
      version: 1,
      requestField: 'systemPrompt',
      input: { kind: 'free-text' },
      workflow: expect.stringContaining('flowchart'),
      sectionDesigns: [
        expect.objectContaining({
          sectionId: 'candidate-research.mission',
          input: expect.objectContaining({ kind: 'free-text' }),
          workflow: expect.stringContaining('flowchart'),
          output: expect.objectContaining({ kind: 'freeform' }),
        }),
      ],
      output: { kind: 'freeform' },
    });
    expect(created.design.verificationProfiles).toEqual([
      expect.objectContaining({ scope: 'section', sectionId: 'candidate-research.mission' }),
      expect.objectContaining({ scope: 'consolidated' }),
    ]);
    expect(validatePromptDesign(created.design, created.text)).toEqual([]);
  });

  it('round-trips free-form prompt and section Mermaid workflows through the strict schema', () => {
    const created = createBlankPromptDesign({ id: 'structured-agent', title: 'Structured Agent' });
    const design = {
      ...created.design,
      input: {
        kind: 'json',
        description: 'One account.',
        jsonSchema: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string' } },
          additionalProperties: false,
        },
        examples: [{ accountId: 'account-1' }],
      },
      tools: ['web_search', 'save_lead'],
      workflow: 'sequenceDiagram\n  User->>Prompt: Research an account\n  Prompt-->>User: Return a decision',
      sectionDesigns: [
        {
          sectionId: 'structured-agent.mission',
          input: { kind: 'free-text', description: 'Research instructions.' },
          workflow: 'stateDiagram-v2\n  [*] --> Research\n  Research --> Verify\n  Verify --> [*]',
          output: { kind: 'freeform', description: 'Verified research.' },
        },
      ],
      output: {
        kind: 'json',
        description: 'One decision.',
        requiredMentions: ['qualified'],
        jsonSchema: {
          type: 'object',
          required: ['qualified'],
          properties: { qualified: { type: 'boolean' } },
          additionalProperties: false,
        },
        examples: [{ qualified: true }],
      },
    } as const;

    expect(parsePromptDesign(JSON.stringify(design))).toEqual(design);
  });

  it('rejects unknown fields instead of silently losing authored policy', () => {
    const created = createBlankPromptDesign({ id: 'strict-agent', title: 'Strict Agent' });
    const result = PromptDesignSchema({ ...created.design, surprise: true });

    expect(result).toBeInstanceOf(type.errors);
  });

  it('reports invalid schemas, detached sub-prompt designs, and profile dependencies before readiness', () => {
    const created = createBlankPromptDesign({ id: 'broken-agent', title: 'Broken Agent' });
    const design = {
      ...created.design,
      tools: ['web_search'],
      sectionDesigns: [
        {
          sectionId: 'broken-agent.missing',
          input: { kind: 'free-text', description: 'Input.' },
          workflow: 'flowchart LR\n  A --> B',
          output: { kind: 'freeform', description: 'Output.' },
        },
        {
          sectionId: 'broken-agent.missing',
          input: { kind: 'free-text', description: 'Input.' },
          workflow: 'mindmap\n  root((Another view))',
          output: { kind: 'freeform', description: 'Output.' },
        },
      ],
      output: {
        kind: 'json',
        description: 'A score.',
        jsonSchema: {
          type: 'object',
          required: ['score'],
          properties: { score: { type: 'integer', maximum: 100 } },
        },
        examples: [{ score: 101 }],
      },
      verificationProfiles: created.design.verificationProfiles.map((profile) => ({
        ...profile,
        dependsOn: ['missing-profile'],
      })),
    } as const;

    expect(validatePromptDesign(design, created.text).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate-section-design',
        'missing-section-design',
        'section-design-not-found',
        'output-example-invalid',
        'profile-dependency-not-found',
      ]),
    );
  });
});
