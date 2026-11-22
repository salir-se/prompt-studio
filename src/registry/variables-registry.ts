/**
 * Session-scoped variables registry — "declare before use": a `{{variable}}` should have a name AND a
 * documented purpose before any prompt uses it, per the studio's design brief. This module is the pure,
 * in-memory precursor to two longer-lived contracts already accepted elsewhere:
 *
 *  - ADR-200's `PromptVariablePolicy` (`packages/prompts/src/composition-contracts.ts`) — the rich,
 *    persisted per-variable policy (schema, lifecycle, encoding, presentation) a real composition tree
 *    will carry once that migration lands.
 *  - ADR-202 §9's exported `variables/variables.json` — the ZIP file layout a blueprint export writes
 *    a prompt's variable declarations to.
 *
 * Until either of those exists in the studio's write path, `VariablesRegistry` lives only in
 * `App.tsx`'s React state for the lifetime of the browser tab — nothing here persists across a reload,
 * and nothing here is sent anywhere. See `App.tsx`'s module doc for how the registry seeds from
 * `buildBuiltinRegistry()` and is threaded through the edit dialog, verification, and final-prompt
 * preview.
 *
 * The BUILT-IN half of the registry is `PROMPT_VARIABLE_DOCS` (@prompt-studio/prompts) — the hand-curated,
 * already-shipped set backing the Variables panel and the `known-placeholder` verification rule. This
 * module flattens it into the same `DeclaredVariable` shape a SESSION declaration takes, so both
 * sources combine and render identically wherever "known variables" is consumed.
 *
 * Enforcement posture (ADR-151/ADR-202): undeclared use is a loud, visible FINDING, never a save/edit
 * gate — see `undeclaredVariables` below and its callers in `App.tsx`/`VariablesPanel.tsx`. A hard gate
 * is deferred to ZIP export/activation, once a real `PromptVariablePolicy` exists to enforce against.
 */

import { extractPlaceholderNames, PROMPT_PLACEHOLDER_RE, PROMPT_VARIABLE_DOCS } from '@prompt-studio/prompts';

export interface DeclaredVariable {
  readonly name: string;
  readonly purpose: string;
  readonly sample: string;
  readonly required: boolean;
  readonly source: 'builtin' | 'session';
}

export interface VariablesRegistry {
  readonly entries: readonly DeclaredVariable[];
}

export interface DeclareVariableInput {
  readonly name: string;
  readonly purpose: string;
  readonly sample?: string;
  readonly required?: boolean;
}

export interface DeclareVariableError {
  readonly error: string;
}

/**
 * Anchors the REAL `{{name}}` placeholder grammar (`PROMPT_PLACEHOLDER_RE`, `@prompt-studio/prompts`'
 * `engine.ts`) to the full string, mirroring `strict-renderer.ts`'s own `PROMPT_VARIABLE_NAME_RE` — a
 * bare identifier is valid iff wrapping it in `{{ }}` matches the exact same grammar the render engine
 * and the highlighter use. Never a hand-rolled identifier regex.
 */
const WRAPPED_PLACEHOLDER_RE = new RegExp(`^(?:${PROMPT_PLACEHOLDER_RE.source})$`);

function isValidVariableName(name: string): boolean {
  return name !== '' && WRAPPED_PLACEHOLDER_RE.test(`{{${name}}}`);
}

/**
 * Flattens `PROMPT_VARIABLE_DOCS` into one `DeclaredVariable` per distinct name — the registry's
 * built-in seed (`source: 'builtin'`). Mirrors `variable-docs.ts`'s own `mergeVariableDocs` tie-break:
 * later prompt keys win on a name collision. Sorted by name for a deterministic, diff-friendly order.
 */
export function buildBuiltinRegistry(): VariablesRegistry {
  const byName = new Map<string, DeclaredVariable>();
  for (const doc of Object.values(PROMPT_VARIABLE_DOCS)) {
    for (const variable of doc.variables) {
      byName.set(variable.key, {
        name: variable.key,
        purpose: variable.label,
        sample: variable.sample,
        required: variable.required ?? true,
        source: 'builtin',
      });
    }
  }
  return { entries: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Declares a new SESSION variable — the enforcement primitive behind "declare before use". Returns a
 * NEW registry (never mutates `r`) or a `{ error }` on:
 *  - an invalid identifier — validated via the real `{{name}}` placeholder grammar;
 *  - a duplicate name, built-in or session (case-sensitive, same as the placeholder grammar itself);
 *  - an empty/whitespace-only purpose — the whole point of the registry is documenting the "why", not
 *    just registering a name.
 */
export function declareVariable(
  r: VariablesRegistry,
  v: DeclareVariableInput,
): VariablesRegistry | DeclareVariableError {
  const name = v.name.trim();
  if (!isValidVariableName(name)) {
    return {
      error: `"${v.name}" is not a valid variable name — must match {{identifier}} (letters, digits, underscore, not starting with a digit).`,
    };
  }
  if (r.entries.some((entry) => entry.name === name)) {
    return { error: `"${name}" is already declared.` };
  }
  const purpose = v.purpose.trim();
  if (purpose === '') {
    return { error: 'Purpose is required — describe why the prompt needs this variable.' };
  }

  const entry: DeclaredVariable = {
    name,
    purpose,
    sample: v.sample?.trim() ?? '',
    required: v.required ?? true,
    source: 'session',
  };
  return { entries: [...r.entries, entry] };
}

/** Placeholder names used in `docText` that are not declared anywhere in `registry` — deduped, sorted. */
export function undeclaredVariables(registry: VariablesRegistry, docText: string): readonly string[] {
  const declared = new Set(registry.entries.map((entry) => entry.name));
  return extractPlaceholderNames(docText)
    .filter((name) => !declared.has(name))
    .sort((a, b) => a.localeCompare(b));
}
