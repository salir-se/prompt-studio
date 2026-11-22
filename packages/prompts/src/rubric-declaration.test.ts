// @module-tag pure
import { describe, expect, it } from 'vitest';
import { parseRubricDeclaration } from './rubric-declaration';

describe('parseRubricDeclaration (ADR-177 §7)', () => {
  const fence = (json: string) => `My custom critic prompt.\n\n\`\`\`rubric\n${json}\n\`\`\`\n\nScore carefully.`;

  it('returns declared:false with no problems when the prompt has no declaration', () => {
    expect(parseRubricDeclaration('Just a prompt with a formula in prose.')).toEqual({
      rubric: null,
      declared: false,
      problems: [],
    });
    expect(parseRubricDeclaration(null)).toEqual({ rubric: null, declared: false, problems: [] });
  });

  it('parses a valid declaration into a custom envelope with the pinned 100 ceiling', () => {
    const result = parseRubricDeclaration(
      fence(
        '{ "criteria": { "FIT": { "max": 10, "weight": 6 }, "TONE": { "max": 10, "weight": 4 } }, "scaleMin": 10 }',
      ),
    );
    expect(result.problems).toEqual([]);
    expect(result.rubric).toMatchObject({
      source: 'custom',
      scaleMin: 10,
      scaleMax: 100,
      criteria: { FIT: { max: 10, weight: 6 }, TONE: { max: 10, weight: 4 } },
    });
  });

  it('rejects the #626 formula: the pre-ADR-087 weights top out at 75', () => {
    const result = parseRubricDeclaration(
      fence(
        JSON.stringify({
          criteria: {
            RELEVANCE: { max: 5, weight: 3 },
            PROOF: { max: 5, weight: 3 },
            BREVITY: { max: 5, weight: 2 },
            TONE: { max: 5, weight: 2 },
            STYLE_MATCH: { max: 5, weight: 2 },
            CTA: { max: 5, weight: 1 },
            HONESTY: { max: 5, weight: 1 },
            VOICE: { max: 5, weight: 1 },
          },
        }),
      ),
    );
    expect(result.declared).toBe(true);
    expect(result.rubric).toBeNull();
    expect(result.problems.join(' ')).toMatch(/tops out at 75/);
  });

  it('refuses a declared scaleMax — the ceiling is pinned, never a knob', () => {
    const result = parseRubricDeclaration(
      fence('{ "criteria": { "A": { "max": 10, "weight": 10 } }, "scaleMax": 75 }'),
    );
    expect(result.rubric).toBeNull();
    expect(result.problems.join(' ')).toMatch(/pinned at exactly 100/);
  });

  it('never throws on malformed JSON or non-object payloads', () => {
    expect(parseRubricDeclaration(fence('{ not json'))).toMatchObject({ rubric: null, declared: true });
    expect(parseRubricDeclaration(fence('[1, 2, 3]'))).toMatchObject({ rubric: null, declared: true });
    expect(parseRubricDeclaration(fence('"just a string"'))).toMatchObject({ rubric: null, declared: true });
  });
});
