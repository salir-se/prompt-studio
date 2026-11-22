import { type } from 'arktype';
import { toolBindingsSchema } from '../../src/mcp/binding-schema';

const short = type('string > 0').atMostLength(200);
const text = type('string').atMostLength(256_000);
const strings = type({ '[string]': text });
const checks = type({
  '+': 'reject',
  'contains?': short.array().atMostLength(30),
  'notContains?': short.array().atMostLength(30),
  'equals?': text,
  'json?': 'boolean',
});
const evalCase = type({
  '+': 'reject',
  id: short,
  name: short,
  inputs: strings,
  userMessage: text,
  'expected?': text,
  checks,
  'tools?': toolBindingsSchema,
});
const suite = type({
  '+': 'reject',
  id: short,
  name: short,
  promptPath: type('string > 0').atMostLength(4096),
  cases: evalCase.array().atLeastLength(1).atMostLength(20),
});
const identity = { projectId: short, revision: 'number.integer >= 0' } as const;
export const suiteRequest = type({ '+': 'reject', ...identity, suite });
export const evaluationRequest = type({
  '+': 'reject',
  ...identity,
  id: /^[a-f0-9-]{36}$/i,
  suiteId: short,
  candidates: type({
    '+': 'reject',
    id: short,
    label: short,
    source: type('string').atMostLength(200_000),
    'commit?': /^[a-f0-9]{40}$/,
  })
    .array()
    .atLeastLength(1)
    .atMostLength(2),
  provider: '"zai" | "openai" | "anthropic" | "openrouter" | "openai-compat"',
  model: short,
  skills: type('string > 0').atMostLength(4096).array().atMostLength(16),
  'tools?': toolBindingsSchema,
  'judge?': type({ '+': 'reject', model: short, rubric: type('string > 0').atMostLength(20_000) }),
});
export const cancelRequest = type({ '+': 'reject', projectId: short });
export function validated<T>(schema: (input: unknown) => T | type.errors, input: unknown): T {
  const result = schema(input);
  if (result instanceof type.errors) throw new Error('Invalid evaluation request. Check required fields and limits.');
  return result;
}
export function uniqueIds(items: readonly { id: string }[]) {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('Choose unique case and candidate IDs.');
}
export function evaluationId(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new Error('Choose a valid evaluation ID.');
  return id;
}
