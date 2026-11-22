// The reasons a platform gate refuses a complete Critic verdict (ADR-300 and PRD-002 item 31). Dependency-free.
/**
 * The failure reasons where the Critic returned a complete, readable verdict and a platform gate refused it
 * (`validateFreshCriticFeedbackWithReason`): the verdict contradicts itself or the configured rubric. Production keeps
 * the Draft unsent with a "manual review required" reason and a Retry control; a person decides. `invalid-shape` is
 * not here: the verdict could not be read, which is a failed review.
 */
export const CRITIC_GATE_REFUSAL_REASONS = [
  'proof-approval-conflict',
  'deliverability-approval-conflict',
  'rubric-contract-conflict',
] as const;

export type CriticGateRefusalReason = (typeof CRITIC_GATE_REFUSAL_REASONS)[number];

export function isCriticGateRefusalReason(reason: unknown): reason is CriticGateRefusalReason {
  return CRITIC_GATE_REFUSAL_REASONS.some((entry) => entry === reason);
}
