/**
 * Variable documentation types for prompt keys.
 *
 * A host application may document the variables its built-in prompts receive. Prompt Studio ships no
 * built-in prompts, so both catalogs are empty; project variables come from the project registry.
 */

export interface PromptVariableDoc {
  key: string;
  label: string;
  sample: string;
  /** Set to `false` for a variable that is only sometimes present (default: always present). */
  required?: boolean;
}

export interface PromptKeyVariableDocs {
  promptKey: string;
  /** false when the key's text is injected as a VALUE into another prompt — {{ }} is NOT supported there (icp). */
  supportsPlaceholders: boolean;
  variables: PromptVariableDoc[];
  /**
   * Names the runtime ALSO resolves but that are intentionally left out of the
   * curated panel list (noise for operators). Feed these into the highlighter's
   * known-variable set so a placeholder that would resolve is never flagged
   * "unknown" — classification-only, never rendered in the Variables panel.
   */
  alsoResolves?: readonly string[];
  /** Caveat line rendered under the list (optional). */
  note?: string;
}

/** Documented variables per built-in prompt key. Empty: Prompt Studio ships no built-in prompts. */
export const PROMPT_VARIABLE_DOCS: Readonly<Record<string, PromptKeyVariableDocs>> = {};

/** Tool names per built-in prompt key. Empty: Prompt Studio ships no built-in prompts. */
export const PROMPT_KEY_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {};
