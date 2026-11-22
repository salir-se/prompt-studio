/**
 * Built-in prompt catalog.
 *
 * A host application can describe the prompts it ships (inventory roots, migrated tree-backed roots,
 * structure contracts, variable docs). Prompt Studio itself ships no built-in prompts: every catalog
 * here is empty and the editor works only from the project the user opens. The types stay so a
 * project-supplied catalog keeps one shape.
 */

import type {
  PromptBlueprint,
  PromptConfiguration,
  PromptRootRequestField,
  PromptSectionVersion,
} from './composition-contracts';
import type { PromptExtensionPoint } from './extension-contracts';
import type { LegacyPromptRootInventoryEntry } from './root-inventory-contract';
import type { PromptOutputContract } from './structure-contracts';
import type { PromptVerificationProfile } from './verification-contracts';

export type PromptRootMigrationStatus = 'shadow' | 'active';

export interface PromptSkillMount {
  readonly name: string;
  readonly version: number;
  readonly sectionId: string;
}

/** One atomic runtime-selectable section/profile identity admitted by a migrated root. */
export interface PromptManifestVariant {
  readonly sections: Readonly<Record<string, { readonly id: string; readonly version: number }>>;
  readonly verificationProfiles: Readonly<Record<string, { readonly id: string; readonly version: number }>>;
}

/** Canonical source for migrated runtime roots and their generated blueprint documentation. */
export interface MigratedPromptRootDefinition {
  readonly legacyRootId: string;
  /** Request field represented by renderedPromptHash. Omitted roots govern systemPrompt. */
  readonly governedRequestField?: PromptRootRequestField;
  readonly blueprint: PromptBlueprint;
  readonly configuration: PromptConfiguration;
  readonly sectionVersions: readonly PromptSectionVersion[];
  readonly extensionPoints: readonly PromptExtensionPoint[];
  readonly runtimeConsumers: readonly string[];
  readonly migrationStatus: PromptRootMigrationStatus;
  readonly source: string;
  readonly verificationProfiles: readonly PromptVerificationProfile[];
  readonly manifestVariants?: readonly PromptManifestVariant[];
  readonly skillMounts: readonly PromptSkillMount[];
  readonly toolNames: readonly string[];
  readonly outputContract: PromptOutputContract;
  readonly conversationStateResponsibilities: readonly string[];
  readonly evaluationIds: readonly string[];
  readonly testLinks: readonly string[];
  readonly productDocumentationLinks: readonly string[];
  readonly exceptionalAdrLinks: readonly string[];
}

/** Inventory of built-in prompt roots. Empty: Prompt Studio ships no built-in prompts. */
export const LEGACY_PROMPT_ROOTS: readonly LegacyPromptRootInventoryEntry[] = [];

/** Built-in tree-backed prompt roots. Empty: Prompt Studio ships no built-in prompts. */
export const MIGRATED_PROMPT_ROOTS: readonly MigratedPromptRootDefinition[] = [];
