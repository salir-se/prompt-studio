/**
 * Machine-readable "prompt structure contract" types.
 *
 * A host application may register built-in contracts for its own default prompts. Prompt Studio ships
 * no built-in prompts, so `PROMPT_STRUCTURE_CONTRACTS` is empty; every verification path also accepts
 * project-authored profiles (see `./verification-contracts`).
 */

import type { Schema as JsonSchema } from '@cfworker/json-schema';

export interface RequiredPlaceholder {
  name: string;
  /** 'warning' = load-bearing agent data; 'info' = ambient brand/datetime or optional var. */
  severity: 'warning' | 'info';
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type PromptInputContract =
  | {
      readonly kind: 'free-text';
      readonly description: string;
    }
  | {
      readonly kind: 'json';
      readonly description: string;
      readonly jsonSchema: JsonSchema;
      readonly examples: readonly JsonValue[];
    };

export interface PromptOutputContract {
  kind: 'json' | 'tool-call' | 'freeform';
  /** Human/LLM-readable description of the output format the pipeline parses. */
  description: string;
  /** Literal strings that must still appear in the prompt text (e.g. JSON keys). */
  requiredMentions?: readonly string[];
  /** Draft 2020-12 schema for structured JSON. Optional only for legacy contracts during migration. */
  jsonSchema?: JsonSchema;
  /** Positive fixtures validated against `jsonSchema`. */
  examples?: readonly JsonValue[];
  /** Required terminal tool when `kind === 'tool-call'`. */
  requiredToolName?: string;
}

export interface PromptStructureContract {
  promptKey: string;
  /** The DEFAULT (un-edited) prompt text for this key — the single source other modules read instead of re-declaring their own copy. */
  defaultText: string;
  /** Placeholders in the DEFAULT prompt ∩ runtime-supplied set — DERIVED at module load. */
  requiredPlaceholders: readonly RequiredPlaceholder[];
  /** Tool names the DEFAULT prompt text actually mentions — DERIVED via tokenizePromptText. */
  defaultToolMentions: readonly string[];
  outputContract?: PromptOutputContract;
  /** One-sentence hand-curated mission (feeds a later LLM verifier's "mission not inverted" check). */
  missionSummary: string;
  /**
   * Hand-curated 2-4 sentence explanation of what is genuinely free to
   * customize for this key versus what is load-bearing and why — feeds the
   * composer chat's teaching role (`./composer`'s `{{customization_notes}}`).
   * Optional and additive (expand-only): a missing entry degrades to the
   * composer's own empty-state line, never a render failure.
   */
  customizationNotes?: string;
  /**
   * Ground truth for the LLM verifier's `scoring-principles` lens (ADR-177
   * §7): the non-negotiable scoring invariants for keys that produce a scored
   * verdict. Optional and additive — absent means the lens stays silent for
   * this key; only scoring-capable prompts (critic family) declare it.
   */
  scoringPrinciples?: string;
}

/** Built-in contracts keyed by prompt key. Empty: Prompt Studio ships no built-in prompts. */
export const PROMPT_STRUCTURE_CONTRACTS: Readonly<Record<string, PromptStructureContract>> = {};

export function getStructureContract(key: string): PromptStructureContract | undefined {
  return Object.hasOwn(PROMPT_STRUCTURE_CONTRACTS, key) ? PROMPT_STRUCTURE_CONTRACTS[key] : undefined;
}
