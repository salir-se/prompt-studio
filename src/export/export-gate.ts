/**
 * Export gate — Stage C of the prompt-studio rollout (docs/prompts/studio-rollout-plan.md): export
 * REFUSES on undeclared variables and deterministic activation/runtime errors ("declare before use").
 *
 * Policy decisions this module encodes:
 *
 *  - **Editing is never blocked** (ADR-151 posture). Undeclared use and findings stay loud, visible
 *    feedback while authoring — this gate applies ONLY at export time. Nothing here is wired into the
 *    edit/save path.
 *  - **Only deterministic activation/runtime errors refuse.** Edit-time rules and semantic findings
 *    remain advisory, matching ADR-200's verification-state contract.
 *  - **The refusal is overridable, but never silently.** A forced export must carry a permanent record
 *    of what it overrode: `buildForceRecord` yields `forced: true` plus the human-readable description
 *    of every overridden reason, destined for the export manifest. Forcing an export the gate already
 *    allowed records nothing — there was nothing to override.
 *
 * Pure module: no React, no IO. Inputs are the OUTPUTS of the existing checks — the string list from
 * `undeclaredVariables()` (registry/variables-registry.ts) and the `PromptVerificationFinding[]` that
 * `runLegacyVerificationProfile` (@prompt-studio/prompts) returns — so the gate never re-implements either.
 */

import type { PromptVerificationFinding } from '@prompt-studio/prompts';

/**
 * One reason the gate refuses an export.
 *
 * `ruleId` is the deterministic finding's identifying rule id.
 */
export type ExportRefusalReason =
  | { readonly kind: 'undeclared-variable'; readonly name: string }
  | { readonly kind: 'error-finding'; readonly message: string; readonly ruleId: string };

export interface ExportGateResult {
  readonly allowed: boolean;
  readonly reasons: readonly ExportRefusalReason[];
}

export interface ExportGateInput {
  /** Output of `undeclaredVariables()` — the gate dedupes/sorts defensively rather than trusting callers. */
  readonly undeclaredVariables: readonly string[];
  /** Findings from `runLegacyVerificationProfile` (or any `PromptVerificationFinding` producer). */
  readonly findings: readonly PromptVerificationFinding[];
}

/**
 * Evaluates the export gate: one reason per distinct undeclared variable (deduped, sorted with the
 * same `localeCompare` order the registry uses) and one reason per deterministic activation/runtime
 * error. Edit-time and semantic findings never contribute a reason — advisory only.
 * `allowed` is true exactly when there are zero reasons.
 */
export function evaluateExportGate(input: ExportGateInput): ExportGateResult {
  const variableReasons: ExportRefusalReason[] = [...new Set(input.undeclaredVariables)]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ kind: 'undeclared-variable', name }));

  const findingReasons: ExportRefusalReason[] = input.findings.flatMap((finding) => {
    if (
      finding.source !== 'deterministic' ||
      finding.severity !== 'error' ||
      (finding.enforcement !== 'activation' && finding.enforcement !== 'runtime')
    ) {
      return [];
    }
    return [{ kind: 'error-finding', message: finding.message, ruleId: finding.ruleId }];
  });

  const reasons = [...variableReasons, ...findingReasons];
  return { allowed: reasons.length === 0, reasons };
}

/**
 * Stable human-readable one-liner for a refusal reason — shown in the refusal dialog AND written
 * verbatim into the export manifest's `overriddenReasons`, so treat the wording as a contract
 * (tests assert it verbatim).
 */
export function describeRefusalReason(reason: ExportRefusalReason): string {
  switch (reason.kind) {
    case 'undeclared-variable':
      return `Undeclared variable {{${reason.name}}} — declare it in the Variables panel before exporting.`;
    case 'error-finding':
      return `Verification error [${reason.ruleId}]: ${reason.message}`;
  }
}

/**
 * Builds the manifest record of a (possibly forced) export.
 *
 * - Gate allowed, or force not requested → `{ forced: false, overriddenReasons: [] }` — nothing was
 *   overridden, so nothing is recorded (forcing an allowed export overrides nothing).
 * - Gate refused AND force requested → `{ forced: true, overriddenReasons }` with EVERY refusal
 *   reason described via `describeRefusalReason`. A forced export must never lose the record of what
 *   it overrode — this is the accountability half of the override.
 */
export function buildForceRecord(
  result: ExportGateResult,
  force: boolean,
): { readonly forced: boolean; readonly overriddenReasons: readonly string[] } {
  if (result.allowed || !force) return { forced: false, overriddenReasons: [] };
  return { forced: true, overriddenReasons: result.reasons.map(describeRefusalReason) };
}
