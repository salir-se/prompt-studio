/**
 * Machine-readable rubric declaration inside a CUSTOM Critic prompt (ADR-177
 * §7). An operator who replaces the Critic prompt may define their own scoring
 * criteria and weights (ADR-015); for the app to compute the total instead of
 * trusting the model's arithmetic, the prompt must DECLARE that rubric in a
 * form code can read. The convention is a fenced code block whose info string
 * is `rubric`, carrying a JSON object:
 *
 * ```rubric
 * { "criteria": { "COMMERCIAL_FIT": { "max": 10, "weight": 6 },
 *                 "LOCAL_TONE":     { "max": 10, "weight": 4 } },
 *   "scaleMin": 0 }
 * ```
 *
 * The declaration lives in the prompt text itself (one artifact, ADR-015-
 * consistent) so the deterministic edit-time checks can see it. A custom
 * prompt WITHOUT a declaration keeps exactly today's behavior — reported
 * total, range check only — plus a shadow divergence log; nothing is rejected
 * at runtime for not declaring (expand-only, ADR-062).
 *
 * `scaleMax` is NOT declarable: the ceiling is the pinned literal 100
 * (`Σ (weight × max) === 100`, ADR-177 §2) and `validateCriticRubric` rejects
 * any declaration whose weights cannot reach exactly 100.
 */

import type { CriticRubric } from '@prompt-studio/types';
import { CRITIC_RUBRIC_VERSION, validateCriticRubric } from '@prompt-studio/types/schemas/critic-scoring';

export interface RubricDeclarationResult {
  /** Valid declared rubric envelope, or null when absent/invalid. */
  rubric: CriticRubric | null;
  /** True when a ```rubric fenced block exists at all (even if invalid). */
  declared: boolean;
  /** Human-readable problems (empty when absent or valid). */
  problems: string[];
}

const RUBRIC_FENCE = /```rubric\s*\n([\s\S]*?)```/;

/**
 * Parse the ```rubric declaration out of a custom Critic prompt. Pure; never
 * throws. Absent block → `{ rubric: null, declared: false, problems: [] }`.
 */
export function parseRubricDeclaration(promptText: string | null | undefined): RubricDeclarationResult {
  const match = promptText?.match(RUBRIC_FENCE);
  if (!match) return { rubric: null, declared: false, problems: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    return {
      rubric: null,
      declared: true,
      problems: [`rubric declaration is not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { rubric: null, declared: true, problems: ['rubric declaration must be a JSON object'] };
  }

  const decl = parsed as { criteria?: unknown; scaleMin?: unknown; scaleMax?: unknown };
  if (decl.scaleMax !== undefined && decl.scaleMax !== 100) {
    return {
      rubric: null,
      declared: true,
      problems: ['scaleMax is not declarable — the ceiling is pinned at exactly 100 (ADR-177)'],
    };
  }

  const rubric: CriticRubric = {
    version: CRITIC_RUBRIC_VERSION,
    source: 'custom',
    scaleMin: typeof decl.scaleMin === 'number' ? decl.scaleMin : 0,
    scaleMax: 100,
    criteria: (decl.criteria ?? {}) as CriticRubric['criteria'],
  };
  const problems = validateCriticRubric(rubric);
  return { rubric: problems.length === 0 ? rubric : null, declared: true, problems };
}
