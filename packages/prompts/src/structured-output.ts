import { type Schema as JsonSchema, Validator } from '@cfworker/json-schema';
import type { JsonValue, PromptInputContract, PromptOutputContract } from './structure-contracts';

export interface StructuredJsonVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly value?: JsonValue;
}

export interface StructuredJsonExampleFailure extends StructuredJsonVerificationResult {
  readonly exampleIndex: number;
}

function formatInstanceLocation(subject: 'input' | 'output', location: string): string {
  return location === '' ? subject : `${subject}${location.replaceAll('/', '.')}`;
}

function validateValue(
  jsonSchema: JsonSchema,
  value: JsonValue,
  subject: 'input' | 'output' = 'output',
): StructuredJsonVerificationResult {
  try {
    const result = new Validator(jsonSchema, '2020-12', false).validate(value);
    if (result.valid) return { valid: true, errors: [], value };
    return {
      valid: false,
      errors: result.errors.map(
        (error) => `${formatInstanceLocation(subject, error.instanceLocation)}: ${error.error}`,
      ),
    };
  } catch {
    return { valid: false, errors: ['Structured JSON output has an invalid JSON Schema.'] };
  }
}

/** Parse and validate one structured input before it is interpolated into a prompt. */
export function verifyStructuredJsonInput(
  contract: PromptInputContract,
  inputText: string,
): StructuredJsonVerificationResult {
  if (contract.kind !== 'json') return { valid: false, errors: ['Structured JSON input has no JSON Schema.'] };
  let value: JsonValue;
  try {
    value = JSON.parse(inputText) as JsonValue;
  } catch {
    return { valid: false, errors: ['Input is not valid JSON.'] };
  }
  return validateValue(contract.jsonSchema, value, 'input');
}

/** Parse and validate one model-produced JSON result against its authored output contract. */
export function verifyStructuredJsonOutput(
  contract: PromptOutputContract,
  outputText: string,
): StructuredJsonVerificationResult {
  if (contract.kind !== 'json' || !contract.jsonSchema) {
    return { valid: false, errors: ['Structured JSON output has no JSON Schema.'] };
  }
  let value: JsonValue;
  try {
    value = JSON.parse(outputText) as JsonValue;
  } catch {
    return { valid: false, errors: ['Output is not valid JSON.'] };
  }
  return validateValue(contract.jsonSchema, value);
}

/** Return only invalid authored examples; an empty list proves all examples satisfy the schema. */
export function verifyStructuredJsonOutputExamples(
  contract: PromptOutputContract,
): readonly StructuredJsonExampleFailure[] {
  if (contract.kind !== 'json' || !contract.jsonSchema) {
    return [{ exampleIndex: 0, valid: false, errors: ['Structured JSON output has no JSON Schema.'] }];
  }
  if (!contract.examples || contract.examples.length === 0) {
    return [{ exampleIndex: 0, valid: false, errors: ['Structured JSON output has no examples.'] }];
  }
  return contract.examples.flatMap((example, exampleIndex) => {
    const result = validateValue(contract.jsonSchema as JsonSchema, example);
    return result.valid ? [] : [{ ...result, exampleIndex }];
  });
}
