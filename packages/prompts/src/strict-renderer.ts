import { type Type, type } from 'arktype';
import type { PromptSectionVersion, PromptVariableEncoding, PromptVariablePolicy } from './composition-contracts';
import { PROMPT_PLACEHOLDER_RE } from './engine';

const UNRESOLVED_DELIMITER_RE = /\{\{/;
const PROMPT_VARIABLE_NAME_RE = new RegExp(`^(?:${PROMPT_PLACEHOLDER_RE.source})$`);

function policiesMatch(left: PromptVariablePolicy, right: PromptVariablePolicy): boolean {
  return (
    left.schema.equals(right.schema) &&
    left.lifecycle === right.lifecycle &&
    left.encoding === right.encoding &&
    left.presentation === right.presentation
  );
}

function collectPolicies(sections: readonly PromptSectionVersion[]): Map<string, PromptVariablePolicy> {
  const policies = new Map<string, PromptVariablePolicy>();

  for (const section of sections) {
    const declared = new Set(section.variables.map((variable) => variable.name));
    const placeholderPattern = new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags);

    for (const match of section.template.matchAll(placeholderPattern)) {
      const name = match[1];
      if (name && !declared.has(name)) {
        throw new TypeError(`Placeholder ${name} is not declared by section ${section.sectionId}`);
      }
    }

    for (const variable of section.variables) {
      if (PROMPT_VARIABLE_NAME_RE.exec(`{{${variable.name}}}`)?.[1] !== variable.name) {
        throw new TypeError(`Invalid prompt variable name: ${variable.name}`);
      }
      const existing = policies.get(variable.name);
      if (existing && !policiesMatch(existing, variable)) {
        throw new TypeError(`Conflicting prompt variable policy: ${variable.name}`);
      }
      policies.set(variable.name, existing ?? variable);
    }
  }

  return policies;
}

function encodeXmlText(name: string, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new TypeError(`Prompt value ${name} is not supported by xml-text encoding`);
  }

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{\{/g, '&#123;&#123;');
}

function normalizeValues(values: Record<string, unknown>): Record<string, unknown> {
  try {
    const prototype = Object.getPrototypeOf(values);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Unsupported values record');

    const normalized = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(values)) {
      if (typeof key !== 'string') throw new TypeError('Unsupported values key');
      const descriptor = Object.getOwnPropertyDescriptor(values, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Unsupported values property');
      normalized[key] = descriptor.value;
    }
    return normalized;
  } catch {
    throw new TypeError('Invalid prompt values');
  }
}

function isLosslessJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== 'object' || ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || 'toJSON' in value) return false;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor) || !isLosslessJsonValue(descriptor.value, ancestors)) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor) || !isLosslessJsonValue(descriptor.value, ancestors)) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

function encodeJson(name: string, value: unknown): string {
  try {
    if (!isLosslessJsonValue(value)) throw new TypeError('Unsupported JSON value');
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('Unsupported JSON value');
    return serialized
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\{\{/g, '\\u007b\\u007b');
  } catch {
    throw new TypeError(`Prompt value ${name} could not be encoded as JSON`);
  }
}

function encodeValue(name: string, value: unknown, policy: PromptVariablePolicy): string {
  return policy.encoding === 'xml-text' ? encodeXmlText(name, value) : encodeJson(name, value);
}

/** Validate and safely encode one extension payload through the same boundary used by section variables. */
export function validateAndEncodePromptValue(
  name: string,
  schema: Type,
  encoding: PromptVariableEncoding,
  value: unknown,
): string {
  const validation = validatePromptValue(name, schema, value);
  return encodePromptValue(name, encoding, validation);
}

/** Validate one value and preserve ArkType defaults/morphs for hashing and encoding. */
export function validatePromptValue(name: string, schema: Type, value: unknown): unknown {
  let validation: unknown;
  try {
    validation = type.raw({ value: schema, '+': 'reject' })(value === undefined ? {} : { value });
  } catch {
    throw new TypeError(`Invalid prompt value: ${name}`);
  }
  if (validation instanceof type.errors) throw new TypeError(`Invalid prompt value: ${name}`);
  return (validation as { value: unknown }).value;
}

/** Safely encode an already-validated prompt value. */
export function encodePromptValue(name: string, encoding: PromptVariableEncoding, value: unknown): string {
  return encoding === 'xml-text' ? encodeXmlText(name, value) : encodeJson(name, value);
}

function renderEncodedTemplate(template: string, data: Record<string, string>): string {
  const placeholderPattern = new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags);
  return template.replace(placeholderPattern, (_match, key: string) => {
    if (!Object.hasOwn(data, key)) throw new ReferenceError(`${key} is not defined`);
    return data[key];
  });
}

/** Validate and safely render independently authored prompt sections without imposing their final structure. */
export function renderStrictPromptSections(
  sections: readonly PromptSectionVersion[],
  values: Record<string, unknown>,
): readonly string[] {
  const policies = collectPolicies(sections);
  const normalizedValues = normalizeValues(values);
  const unknown = Object.keys(normalizedValues)
    .filter((name) => !policies.has(name))
    .sort();
  if (unknown.length > 0) throw new TypeError(`unknown prompt values: ${unknown.join(', ')}`);

  const definition: Record<string, unknown> = Object.fromEntries([
    ['+', 'reject'],
    ...[...policies].map(([name, policy]) => [name, policy.schema]),
  ]);

  let validation: unknown;
  try {
    validation = type.raw(definition)(normalizedValues);
  } catch {
    throw new TypeError('Invalid prompt values');
  }
  if (validation instanceof type.errors) {
    throw new TypeError('Invalid prompt values');
  }

  const validated = validation as Record<string, unknown>;
  const encoded: Record<string, string> = Object.fromEntries(
    [...policies].map(([name, policy]) => [name, encodeValue(name, validated[name], policy)]),
  );

  return sections.map((section) => {
    const rendered = renderEncodedTemplate(section.template, encoded);
    if (UNRESOLVED_DELIMITER_RE.test(rendered)) {
      throw new TypeError(`Unresolved prompt delimiter in section ${section.sectionId}`);
    }
    return rendered;
  });
}

/** Validate and safely render independently authored prompt sections. */
export function renderStrictPrompt(sections: readonly PromptSectionVersion[], values: Record<string, unknown>): string {
  return renderStrictPromptSections(sections, values).join('\n\n');
}
