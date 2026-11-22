// @module-tag pure
import { describe, expect, it } from 'vitest';
import type { PromptOutputContract } from './structure-contracts';
import {
  verifyStructuredJsonInput,
  verifyStructuredJsonOutput,
  verifyStructuredJsonOutputExamples,
} from './structured-output';

const contract = {
  kind: 'json',
  description: 'Return one scored candidate.',
  requiredMentions: ['company', 'score'],
  jsonSchema: {
    type: 'object',
    required: ['company', 'score'],
    properties: {
      company: { type: 'string', minLength: 1 },
      score: { type: 'integer', minimum: 0, maximum: 100 },
    },
    additionalProperties: false,
  },
  examples: [{ company: 'Acme', score: 84 }],
} as const satisfies PromptOutputContract;

describe('structured JSON output verification', () => {
  it('accepts valid JSON text against the declared schema', () => {
    expect(verifyStructuredJsonOutput(contract, '{"company":"Acme","score":84}')).toEqual({
      valid: true,
      errors: [],
      value: { company: 'Acme', score: 84 },
    });
  });

  it('reports malformed JSON without throwing', () => {
    expect(verifyStructuredJsonOutput(contract, '{"company":')).toEqual({
      valid: false,
      errors: ['Output is not valid JSON.'],
    });
  });

  it('reports every schema mismatch', () => {
    const result = verifyStructuredJsonOutput(contract, '{"company":"","score":101,"extra":true}');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.join('\n')).toContain('company');
    expect(result.errors.join('\n')).toContain('score');
  });

  it('requires a schema for JSON output verification', () => {
    expect(
      verifyStructuredJsonOutput(
        { kind: 'json', description: 'Return JSON.', examples: [{ ok: true }] },
        '{"ok":true}',
      ),
    ).toEqual({ valid: false, errors: ['Structured JSON output has no JSON Schema.'] });
  });

  it('validates every authored example', () => {
    const result = verifyStructuredJsonOutputExamples({
      ...contract,
      examples: [
        { company: 'Acme', score: 84 },
        { company: 'Broken', score: 101 },
      ],
    });

    expect(result).toEqual([expect.objectContaining({ exampleIndex: 1, valid: false })]);
  });
});

describe('structured JSON input verification', () => {
  it('validates structured input before prompt assembly', () => {
    const inputContract = {
      kind: 'json',
      description: 'One company to research.',
      jsonSchema: {
        type: 'object',
        required: ['domain'],
        properties: { domain: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      },
      examples: [{ domain: 'example.com' }],
    } as const;

    expect(verifyStructuredJsonInput(inputContract, '{"domain":"example.com"}')).toEqual({
      valid: true,
      errors: [],
      value: { domain: 'example.com' },
    });
    expect(verifyStructuredJsonInput(inputContract, '{"domain":"","extra":true}').valid).toBe(false);
  });
});
