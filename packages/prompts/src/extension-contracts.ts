import { lazyType } from '@prompt-studio/types/lazy-type';
import { Type, type } from 'arktype';
import type { PromptValueHash } from './canonical-json';
import type { PromptVariableEncoding, PromptVersionReference, VariablePresentation } from './composition-contracts';
import type { ToolDefinition } from './types';

export type PromptExtensionDelivery = 'inline' | 'message' | 'tool';
export type PromptExtensionCardinality = 'one' | 'many';
export type PromptExtensionFailurePolicy = 'fail' | 'omit' | 'use-default' | 'legacy-fallback';
export type PromptExtensionAuthority = 'data' | 'operator-instruction' | 'platform-instruction';
export type PromptExtensionSourceKind = 'operator' | 'platform' | 'database' | 'external' | 'tool-result' | 'fixture';
export type PromptExtensionStatus = 'resolved' | 'omitted' | 'defaulted' | 'legacy-fallback';

export const PromptRequestMessageSchema = lazyType(() =>
  type({
    role: "'user' | 'assistant'",
    content: 'string > 0',
    '+': 'reject',
  }),
);
export const PromptRequestMessagesSchema = lazyType(() => PromptRequestMessageSchema.array().atLeastLength(1));

/** Transport-neutral conversation message accepted by an ADR-200 request envelope. */
export interface PromptRequestMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface PromptExtensionPointBase {
  readonly id: string;
  readonly version: number;
  readonly purpose: string;
  readonly cardinality: PromptExtensionCardinality;
  readonly required: boolean;
  readonly failurePolicy: PromptExtensionFailurePolicy;
  readonly authority: PromptExtensionAuthority;
  readonly maxBytes: number;
  readonly maxTokens?: number;
  readonly presentation: VariablePresentation;
  readonly allowedSectionIds: readonly string[];
  readonly provenanceRequired: boolean;
  readonly maxAgeMs?: number;
}

interface PromptValueExtensionPoint extends PromptExtensionPointBase {
  readonly schema: Type;
  readonly encoding: PromptVariableEncoding;
  readonly defaultValue?: unknown;
  readonly legacyFallbackValue?: unknown;
}

export type PromptExtensionPoint =
  | (PromptValueExtensionPoint & { readonly delivery: 'inline'; readonly tag: string })
  | (PromptValueExtensionPoint & { readonly delivery: 'message'; readonly role: 'user' | 'assistant' })
  | (PromptExtensionPointBase & {
      readonly delivery: 'tool';
      readonly allowedCapabilities: readonly string[];
      readonly defaultValue?: readonly string[];
      readonly legacyFallbackValue?: readonly string[];
    });

export interface ExtensionBinding {
  readonly extensionPoint: PromptVersionReference;
  readonly resolver: PromptVersionReference;
}

export interface PromptExtensionProvenance {
  readonly resolver: PromptVersionReference;
  readonly retrievedAt?: string;
  readonly sourceRevisionHash?: PromptValueHash;
}

/** Untrusted runtime-port output. `assemblePromptExtensions` validates it against the selected point. */
export interface PromptExtensionResolution {
  readonly binding: ExtensionBinding;
  readonly sourceKind: PromptExtensionSourceKind;
  readonly value: unknown;
  readonly provenance: PromptExtensionProvenance;
}

export interface PromptExtensionMessage extends PromptRequestMessage {
  readonly extensionPointId: string;
}

export interface ResolvedExtension {
  readonly extensionPoint: PromptVersionReference;
  readonly delivery: PromptExtensionDelivery;
  readonly status: PromptExtensionStatus;
  readonly provenance: PromptExtensionProvenance;
  readonly contentHash?: PromptValueHash;
}

export interface PromptAssembledRequest {
  readonly systemPrompt: string;
  readonly messages: readonly PromptExtensionMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly extensions: Readonly<Record<string, ResolvedExtension>>;
}

/** Remove assembler-only provenance before binding extension messages into a provider-visible transcript. */
export function toPromptRequestMessages(messages: PromptAssembledRequest['messages']): readonly PromptRequestMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

export interface AssemblePromptExtensionsInput {
  readonly systemPrompt: string;
  readonly extensionPoints: readonly PromptExtensionPoint[];
  readonly selectedSectionIds: readonly string[];
  readonly bindings: Readonly<Record<string, ExtensionBinding>>;
  readonly resolutions?: Readonly<Record<string, PromptExtensionResolution>>;
  readonly registeredTools: Readonly<Record<string, ToolDefinition>>;
  readonly now: string;
  /** Provider/model tokenizer supplied by the runtime when a point declares maxTokens. */
  readonly countTokens?: (content: string) => number;
}

const PromptVersionReferenceSchema = lazyType(() =>
  type({
    id: 'string > 0',
    version: 'number.integer >= 1',
    '+': 'reject',
  }),
);

const PromptValueHashSchema = lazyType(() =>
  type('string').narrow((value, context) =>
    /^sha256:[0-9a-f]{64}$/.test(value) ? true : context.mustBe('a sha256-prefixed lowercase hex digest'),
  ),
);

const pointBase = {
  id: 'string > 0',
  version: 'number.integer >= 1',
  purpose: 'string > 0',
  cardinality: "'one' | 'many'",
  required: 'boolean',
  failurePolicy: "'fail' | 'omit' | 'use-default' | 'legacy-fallback'",
  authority: "'data' | 'operator-instruction' | 'platform-instruction'",
  maxBytes: 'number.integer >= 1',
  'maxTokens?': 'number.integer >= 1',
  presentation: "'placeholder' | 'resolved' | 'redacted'",
  allowedSectionIds: 'string[]',
  provenanceRequired: 'boolean',
  'maxAgeMs?': 'number.integer >= 0',
} as const;

const valuePointFields = {
  schema: 'unknown',
  encoding: "'xml-text' | 'json'",
  'defaultValue?': 'unknown',
  'legacyFallbackValue?': 'unknown',
} as const;

export const PromptExtensionPointSchema = lazyType(() =>
  type({
    ...pointBase,
    ...valuePointFields,
    delivery: "'inline'",
    tag: 'string > 0',
    '+': 'reject',
  })
    .or({
      ...pointBase,
      ...valuePointFields,
      delivery: "'message'",
      role: "'user' | 'assistant'",
      '+': 'reject',
    })
    .or({
      ...pointBase,
      delivery: "'tool'",
      allowedCapabilities: 'string[]',
      'defaultValue?': 'string[]',
      'legacyFallbackValue?': 'string[]',
      '+': 'reject',
    }),
);

export const ExtensionBindingSchema = lazyType(() =>
  type({
    extensionPoint: PromptVersionReferenceSchema,
    resolver: PromptVersionReferenceSchema,
    '+': 'reject',
  }),
);

export const PromptExtensionResolutionSchema = lazyType(() =>
  type({
    binding: ExtensionBindingSchema,
    sourceKind: "'operator' | 'platform' | 'database' | 'external' | 'tool-result' | 'fixture'",
    value: 'unknown',
    provenance: {
      resolver: PromptVersionReferenceSchema,
      'retrievedAt?': 'string.date.iso',
      'sourceRevisionHash?': PromptValueHashSchema,
      '+': 'reject',
    },
    '+': 'reject',
  }),
);

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

function hasLooseObjectSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(hasLooseObjectSchema);
  if (schema === null || typeof schema !== 'object') return false;
  const node = schema as Record<string, unknown>;
  if (node.domain === 'object' && node.proto !== 'Array' && node.undeclared !== 'reject') return true;
  return Object.values(node).some(hasLooseObjectSchema);
}

function assertFallbackValue(point: PromptExtensionPoint, key: 'defaultValue' | 'legacyFallbackValue'): void {
  if (!hasOwn(point, key)) return;
  const value = point[key];
  if (point.delivery === 'tool') {
    const capabilities = type('string[]').assert(value);
    if (
      (point.cardinality === 'one' && capabilities.length !== 1) ||
      (point.cardinality === 'many' && point.required && capabilities.length === 0) ||
      capabilities.some((capability) => !point.allowedCapabilities.includes(capability)) ||
      new Set(capabilities).size !== capabilities.length
    ) {
      throw new TypeError(`Extension ${point.id} has an invalid ${key}`);
    }
    return;
  }

  const values = point.cardinality === 'many' ? type('unknown[]').assert(value) : [value];
  if (point.required && values.length === 0) throw new TypeError(`Extension ${point.id} has an invalid ${key}`);
  try {
    for (const item of values) point.schema.assert(item);
  } catch {
    throw new TypeError(`Extension ${point.id} has an invalid ${key}`);
  }
}

export function assertPromptExtensionPoint(value: unknown): PromptExtensionPoint {
  const point = PromptExtensionPointSchema.assert(value) as PromptExtensionPoint;
  if (
    new Set(point.allowedSectionIds).size !== point.allowedSectionIds.length ||
    point.allowedSectionIds.some((id) => !id)
  ) {
    throw new TypeError('Extension allowed section IDs must be non-empty and unique');
  }
  if (point.failurePolicy === 'use-default' && !hasOwn(point, 'defaultValue')) {
    throw new TypeError('use-default extension points require defaultValue');
  }
  if (point.failurePolicy === 'legacy-fallback' && !hasOwn(point, 'legacyFallbackValue')) {
    throw new TypeError('legacy-fallback extension points require legacyFallbackValue');
  }
  if (point.delivery === 'inline' && !/^[a-z][a-z0-9_]*$/.test(point.tag)) {
    throw new TypeError('Inline extension tags must use lowercase snake_case');
  }
  if (point.delivery === 'tool') {
    if (
      point.allowedCapabilities.length === 0 ||
      new Set(point.allowedCapabilities).size !== point.allowedCapabilities.length ||
      point.allowedCapabilities.some((name) => !name)
    ) {
      throw new TypeError('Tool extension capabilities must be non-empty and unique');
    }
  } else {
    if (!(point.schema instanceof Type)) {
      throw new TypeError(`Extension ${point.id} requires an ArkType payload schema`);
    }
    if (Object.keys(point.schema.json).length === 0 || hasLooseObjectSchema(point.schema.json)) {
      throw new TypeError(`Extension ${point.id} payload object schemas must reject undeclared fields`);
    }
  }
  assertFallbackValue(point, 'defaultValue');
  assertFallbackValue(point, 'legacyFallbackValue');
  return point;
}

export function assertExtensionBinding(value: unknown): ExtensionBinding {
  return ExtensionBindingSchema.assert(value) as ExtensionBinding;
}

export function assertPromptExtensionResolution(value: unknown): PromptExtensionResolution {
  return PromptExtensionResolutionSchema.assert(value) as PromptExtensionResolution;
}
