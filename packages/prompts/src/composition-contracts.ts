import type { Type } from 'arktype';
import type { ExtensionBinding } from './extension-contracts';

export type PromptVariableLifecycle = 'configuration' | 'runtime' | 'server-only';
export type PromptVariableEncoding = 'xml-text' | 'json';
export type VariablePresentation = 'placeholder' | 'resolved' | 'redacted';
export type PromptRootRequestField = 'systemPrompt' | 'userMessage';

export interface PromptVariablePolicy {
  readonly name: string;
  readonly schema: Type;
  readonly lifecycle: PromptVariableLifecycle;
  readonly encoding: PromptVariableEncoding;
  readonly presentation: VariablePresentation;
}

/** Stable structural node. Array order is prompt order; nesting determines heading depth from the H1 root. */
export interface PromptSection {
  readonly id: string;
  readonly tag: string;
  readonly children: readonly PromptSection[];
}

/** Immutable authored content for one stable section. */
export interface PromptSectionVersion {
  readonly id: string;
  readonly sectionId: string;
  readonly version: number;
  readonly heading: string;
  readonly template: string;
  readonly variables: readonly PromptVariablePolicy[];
}

export interface PromptBlueprint {
  readonly id: string;
  readonly version: number;
  readonly maxDepth: number;
  readonly root: PromptSection;
  /** Exact dynamic slots available to migrated configurations. Omitted by legacy adapters. */
  readonly extensionPoints?: readonly PromptVersionReference[];
}

export interface PromptVersionReference {
  readonly id: string;
  readonly version: number;
}

/** Exact blueprint and section-version selection; the blueprint remains authoritative for order. */
export interface PromptConfiguration {
  readonly id: string;
  readonly version: number;
  readonly blueprint: PromptVersionReference;
  readonly sectionVersions: Readonly<Record<string, PromptVersionReference>>;
  /** Resolver identities only; executable resolver code remains in the runtime composition root. */
  readonly extensionBindings?: Readonly<Record<string, ExtensionBinding>>;
}
