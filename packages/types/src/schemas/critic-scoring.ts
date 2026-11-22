import { type } from 'arktype';
import { lazyType } from '../lazy-type';
import { DeliverabilityReviewSchema } from './deliverability-review';
import { LanguageReviewSchema } from './outreach-language';

const CriticScoresSchema = lazyType(() =>
  type({
    '[string]': {
      score: 'number',
      feedback: 'string',
    },
  }).describe('Per-criterion scores and feedback from the Critic agent'),
);

const CriticRubricCriterionSchema = lazyType(() =>
  type({
    // Per-criterion ceiling for the 1..max (or declared) score range.
    max: 'number > 0',
    // Contribution multiplier: the criterion adds weight × score points.
    weight: 'number > 0',
    'label?': 'string',
    'description?': 'string',
  })
    // Unknown keys are ignored, not rejected — future per-criterion metadata
    // must not break older readers (ADR-177 principle 4).
    .onUndeclaredKey('ignore'),
);

/**
 * Self-describing Critic rubric envelope (ADR-177). Travels on the Message so
 * the renderer and the total computation read the SAME declared weights —
 * never a code-side table selected by criterion-name heuristics.
 *
 * `scaleMax` is typed `number` for wire-compatibility but is a PINNED literal:
 * `validateCriticRubric` rejects anything but exactly 100, and the ceiling
 * invariant `Σ (weight × max) === 100` guarantees a perfect draft scores 100.
 * `scaleMin` records the lowest attainable total and stays the rubric author's
 * choice (20 for the built-in 1-5 criterion floor).
 */
export const CriticRubricSchema = lazyType(() =>
  type({
    // Rubric-contract version (NOT the score scale — that is criticScoreVersion).
    version: 'number.integer > 0',
    source: "'builtin' | 'custom'",
    scaleMin: 'number >= 0',
    scaleMax: 'number',
    criteria: type({ '[string]': CriticRubricCriterionSchema }),
  })
    .describe('Self-describing Critic scoring rubric (ADR-177)')
    .onUndeclaredKey('ignore'),
);

export type CriticRubric = typeof CriticRubricSchema.infer;

/**
 * One claim a draft makes about the represented person, and the evidence under it.
 *
 * The Critic's PROOF criterion already verifies that every candidate claim is
 * present in the selected profile — it computes the claim-to-evidence mapping on
 * every single draft and then discards it, keeping only a prose `feedback`
 * string. That is the most expensive thing the reviewer knows and the cheapest
 * thing to hand back.
 *
 * It is handed to the PERSON, not the pipeline. A candidate approving prose
 * written about them needs to know which specific assertions they have just
 * committed to defending in a screening call two weeks later; `lane` tells them
 * how hard each one will be to defend. `unsupported` should never survive to an
 * approved draft — its presence is a PROOF failure the Critic is also scoring.
 */
const CriticClaimSchema = lazyType(() =>
  type({
    /** The assertion as the draft makes it, quoted or closely paraphrased. */
    claim: 'string > 0',
    /** Where it comes from in the selected profile, or why nothing backs it. */
    evidence: 'string',
    lane: "'proven' | 'transferable' | 'stretch' | 'unsupported'",
  }).onUndeclaredKey('ignore'),
);

export const CriticFeedbackSchema = lazyType(() =>
  type({
    'languageReview?': LanguageReviewSchema,
    'deliverabilityReview?': DeliverabilityReviewSchema,
    verdict: "'APPROVED' | 'REJECTED' | 'REVIEW_FAILED'",
    // Weighted sum on a 0-100 scale (ADR-087). Kept as a plain `number` rather
    // than a bounded range so historical drafts scored on the legacy 0-75 scale
    // still parse.
    totalScore: 'number',
    scores: CriticScoresSchema,
    topIssue: 'string',
    rewriteHint: 'string',
    'claimLedger?': CriticClaimSchema.array(),
    // Optional, expand-only: see critic-gate-refusal.ts.
    'gateRefusal?': "'proof-approval-conflict' | 'deliverability-approval-conflict' | 'rubric-contract-conflict'",
  })
    .describe("Critic agent's review of a draft message")
    .onUndeclaredKey('ignore'),
);

const FreshCriticScoreSchema = lazyType(() =>
  type({
    score: '1 <= number.integer <= 5',
    feedback: 'string',
  }).onUndeclaredKey('reject'),
);

/**
 * Strict boundary for a newly-produced Critic result (BHG-006).
 *
 * Keep this separate from `CriticFeedbackSchema`: stored legacy feedback must
 * remain readable, while fresh LLM output must be closed and bounded before it
 * can approve or persist anything.
 */
export const FreshCriticFeedbackSchema = lazyType(() =>
  type({
    'languageReview?': LanguageReviewSchema,
    // Optional and expand-only (ADR-300): every Critic that scores DELIVERABILITY returns it; custom prompts and
    // pinned earlier versions do not, and must keep parsing.
    'deliverabilityReview?': DeliverabilityReviewSchema,
    verdict: "'APPROVED' | 'REJECTED' | 'REVIEW_FAILED'",
    // Shape-only at this boundary. Built-in rubrics are recomputed below from
    // their bounded criterion scores; custom rubrics retain the 0-100 check.
    totalScore: 'number',
    scores: type({ '[string]': FreshCriticScoreSchema }),
    // Advisory narrative strings, not verdict gates: a model that omits one must
    // not void an otherwise complete, bounded verdict — a whole review used to
    // fail as "Critic API unavailable" over a missing rewriteHint
    // (critic-report-composition-error). `validateFreshCriticFeedback` defaults
    // absent keys to ''; a PRESENT key is still type-checked, and undeclared
    // keys are still rejected.
    'topIssue?': 'string',
    'rewriteHint?': 'string',
    // Optional and expand-only. This boundary rejects undeclared keys, so a mode
    // whose Critic emits a ledger would otherwise fail validation and surface as
    // "Critic API unavailable" — the whole review discarded over an extra field.
    // Optional keeps every mode that does not emit one parsing exactly as before.
    'claimLedger?': CriticClaimSchema.array(),
  })
    .describe('Fresh Critic feedback validated before use')
    .onUndeclaredKey('reject'),
);

export interface FreshCriticFeedbackValidationOptions {
  /** ADR-015 lets an operator replace the Critic rubric along with its prompt. */
  allowCustomRubric?: boolean;
}

export type FreshCriticFeedbackFailureReason =
  'invalid-shape' | 'proof-approval-conflict' | 'deliverability-approval-conflict' | 'rubric-contract-conflict';

export type FreshCriticFeedbackValidationResult =
  { ok: true; feedback: CriticFeedback } | { ok: false; reason: FreshCriticFeedbackFailureReason };

/** Validate fresh Critic output and retain a safe failure category for callers that need diagnostics. */
export function validateFreshCriticFeedbackWithReason(
  data: unknown,
  options: FreshCriticFeedbackValidationOptions = {},
): FreshCriticFeedbackValidationResult {
  const result = FreshCriticFeedbackSchema(data);
  if (result instanceof type.errors || !Number.isFinite(result.totalScore))
    return { ok: false, reason: 'invalid-shape' };
  // Materialize omitted narrative keys as '' — the canonical "no hint" value
  // the REVIEW_FAILED envelope already uses — so every returned (and later
  // persisted) feedback still satisfies the stored CriticFeedbackSchema.
  const feedback: CriticFeedback = {
    ...result,
    topIssue: result.topIssue ?? '',
    rewriteHint: result.rewriteHint ?? '',
  };
  // PROOF means every factual claim is supported. An APPROVED result that
  // scores its own PROOF below the maximum is internally contradictory and
  // must fail closed before a score or verdict can authorize anything.
  if (feedback.verdict === 'APPROVED' && feedback.scores.PROOF && feedback.scores.PROOF.score !== 5)
    return { ok: false, reason: 'proof-approval-conflict' };
  // A content-risk review of `high` is a DELIVERABILITY score of 1, an automatic rejection (ADR-300). An approval
  // that carries one contradicts itself and fails closed, whatever rubric produced it.
  if (feedback.verdict === 'APPROVED' && feedback.deliverabilityReview?.contentRisk === 'high')
    return { ok: false, reason: 'deliverability-approval-conflict' };
  // REVIEW_FAILED is never allowed to approve or persist a score, so the
  // processor may carry its deliberately-empty diagnostic shape.
  if (feedback.verdict === 'REVIEW_FAILED') {
    return feedback.totalScore >= 0 && feedback.totalScore <= 100
      ? { ok: true, feedback }
      : { ok: false, reason: 'rubric-contract-conflict' };
  }

  const actualCriteria = Object.keys(feedback.scores).sort();
  if (options.allowCustomRubric) {
    // A custom prompt may define independent criteria and its own 0-100
    // aggregation formula (ADR-015). The closed schemas above still enforce
    // every field, enum, and per-criterion bound; only the canonical key set
    // and built-in weighted-sum check are deliberately inapplicable.
    return actualCriteria.length > 0 && feedback.totalScore >= 0 && feedback.totalScore <= 100
      ? { ok: true, feedback }
      : { ok: false, reason: 'rubric-contract-conflict' };
  }

  const weights = criticCriterionWeightsFor(feedback.scores);
  const expectedCriteria = Object.keys(weights).sort();
  if (
    expectedCriteria.length !== actualCriteria.length ||
    expectedCriteria.some((criterion, index) => criterion !== actualCriteria[index])
  ) {
    return { ok: false, reason: 'rubric-contract-conflict' };
  }
  const recomputedTotal = expectedCriteria.reduce(
    (total, criterion) => total + weights[criterion] * feedback.scores[criterion].score,
    0,
  );
  return { ok: true, feedback: { ...feedback, totalScore: recomputedTotal } };
}

/** Validate fresh Critic output without tightening the persisted Message schema. */
export function validateFreshCriticFeedback(
  data: unknown,
  options: FreshCriticFeedbackValidationOptions = {},
): CriticFeedback | null {
  const result = validateFreshCriticFeedbackWithReason(data, options);
  return result.ok ? result.feedback : null;
}

/**
 * Strict validator for the Critic Outbound scoring result (BHG-006), gated
 * AFTER `packages/agent/src/critic-outbound.ts` has parsed the raw LLM JSON
 * and normalized it (mapping the prompt's `verdict`/`totalScore`/`scores`
 * shape — or a custom prompt's aliased `pass`/`score`/`criterion_scores`
 * fields — onto this return shape). Distinct from `CriticFeedbackSchema`
 * above (which validates/round-trips already-*stored* `Message.criticFeedback`
 * and stays lenient for legacy 0-75-scale drafts): this one gates a
 * freshly-derived result before any of it can be used to auto-approve a draft,
 * so it can be strict — out-of-range totals or criterion scores fail
 * validation instead of silently approving on hallucinated numbers.
 */
export const CriticOutboundResultSchema = lazyType(() =>
  type({
    score: '0 <= number <= 100',
    pass: 'boolean',
    feedback: 'string',
    suggestions: 'string[]',
    criterionScores: type({ '[string]': '0 <= number.integer <= 5' }),
  })
    .describe('Normalized Critic Outbound scoring result, validated before use (BHG-006)')
    .onUndeclaredKey('ignore'),
);

export type CriticOutboundResult = typeof CriticOutboundResultSchema.infer;

/**
 * Validate a normalized Critic Outbound result before it's allowed to gate
 * `approve_draft` (BHG-006). Returns `null` — never throws — on malformed
 * input; the caller must treat that as a failed review (fallback), never an
 * approval.
 */
export function validateCriticOutboundResult(data: unknown): CriticOutboundResult | null {
  const result = CriticOutboundResultSchema(data);
  return result instanceof type.errors ? null : result;
}

export type CriticFeedback = typeof CriticFeedbackSchema.infer;
export type CriticScores = typeof CriticScoresSchema.infer;

// ── Critic scoring model (ADR-087) ──────────────────────────────────────────
// Canonical home for the 0-100 critic scoring constants. Lives in @prompt-studio/types
// (next to CriticFeedback) so every tier — prompts, domain (score migration),
// and the UI — shares one source of truth.

/** Max raw score for a single Critic criterion (each criterion is scored 1-5). */
export const CRITIC_MAX_CRITERION_SCORE = 5;

/**
 * Current critic scoring-scale version, stamped onto `Message.criticScoreVersion`
 * whenever the Critic writes a score (ADR-087). A message with this version (or
 * higher) has a `criticScore` already on the canonical 0-100 scale; a missing or
 * lower version is a legacy 0-75 score that `canonicalCriticScore` normalizes at
 * read time. Bump this (and add a branch to the normalizer) on the next rubric
 * rescale — never re-mutate stored scores.
 */
export const CRITIC_SCORE_VERSION = 2;

/**
 * A weighted sum at or above this (on the 0-100 scale) is APPROVED, provided no
 * criterion scored 1 (every criterion ≥ 2). See CRITIC_PROMPT's VERDICT RULES.
 */
export const CRITIC_APPROVED_THRESHOLD = 75;

/**
 * Per-criterion weights for the Critic's 0-100 weighted sum (ADR-087, ADR-136, ADR-300).
 *
 * The weights sum to 20, so with each criterion scored 1-5 the weighted sum
 * lands natively on 0-100. A criterion's maximum contribution to the total is
 * `weight × CRITIC_MAX_CRITERION_SCORE`; its actual contribution is
 * `weight × score`. MUST stay in sync with the weights written into
 * CRITIC_PROMPT's per-criterion headers and SCORING FORMULA (guarded by a test).
 *
 * ADR-136 added HUMANITY (AI-pattern detection) at 3x, funded entirely from the
 * writing-quality cluster (BREVITY/TONE/STYLE_MATCH 3→2 each) so RELEVANCE and
 * PROOF stay the heaviest criteria and the sum stays 20. Feedback authored
 * before that rubric normalizes against `CRITIC_CRITERION_WEIGHTS_PRE_HUMANITY`
 * — select the table with `criticCriterionWeightsFor`, never hardcode one.
 *
 * ADR-300 added DELIVERABILITY (content spam risk) at 2x, funded from BREVITY and TONE (2→1 each): TONE's hype
 * and false-urgency checks are the part of spam risk it already owned. Feedback authored under the nine-criterion
 * rubric normalizes against `CRITIC_CRITERION_WEIGHTS_HUMANITY`.
 */
export const CRITIC_CRITERION_WEIGHTS: Record<string, number> = {
  RELEVANCE: 4,
  PROOF: 4,
  HUMANITY: 3,
  DELIVERABILITY: 2,
  STYLE_MATCH: 2,
  BREVITY: 1,
  TONE: 1,
  CTA: 1,
  HONESTY: 1,
  VOICE: 1,
};

/**
 * Frozen ADR-136 weight table (HUMANITY without DELIVERABILITY, 9 criteria, sum 20). Feedback a pinned earlier
 * Critic version authors keeps normalizing against these weights. Never edit.
 */
export const CRITIC_CRITERION_WEIGHTS_HUMANITY: Record<string, number> = {
  RELEVANCE: 4,
  PROOF: 4,
  HUMANITY: 3,
  BREVITY: 2,
  TONE: 2,
  STYLE_MATCH: 2,
  CTA: 1,
  HONESTY: 1,
  VOICE: 1,
};

/**
 * Frozen ADR-087 weight table (pre-HUMANITY, 8 criteria, sum 20). Feedback
 * authored under that rubric — anything without a HUMANITY score — must keep
 * normalizing against THESE weights, or a legacy all-5s draft would render as
 * 90/100 under the rebalanced table. Never edit; the current table above is the
 * only one that moves.
 */
export const CRITIC_CRITERION_WEIGHTS_PRE_HUMANITY: Record<string, number> = {
  RELEVANCE: 4,
  PROOF: 4,
  BREVITY: 3,
  TONE: 3,
  STYLE_MATCH: 3,
  CTA: 1,
  HONESTY: 1,
  VOICE: 1,
};

/**
 * Pick the weight table matching the rubric that authored a feedback's
 * per-criterion scores. Selection is by criteria present (self-describing on
 * every stored record) rather than by `criticScoreVersion`, which tracks the
 * score *scale* (unchanged at 0-100 by ADR-136), not the criterion set.
 */
export function criticCriterionWeightsFor(
  scores: Record<string, { score: number; feedback: string }> | null | undefined,
): Record<string, number> {
  if (!scores || Object.keys(scores).length === 0) return CRITIC_CRITERION_WEIGHTS;
  if ('DELIVERABILITY' in scores) return CRITIC_CRITERION_WEIGHTS;
  return 'HUMANITY' in scores ? CRITIC_CRITERION_WEIGHTS_HUMANITY : CRITIC_CRITERION_WEIGHTS_PRE_HUMANITY;
}

// ── ADR-177: self-describing rubric envelope ────────────────────────────────

/**
 * Current rubric-contract version stamped into `CriticRubric.version`. Tracks
 * the ENVELOPE contract; the score *scale* stays tracked by
 * `CRITIC_SCORE_VERSION` — the two are deliberately separate (ADR-177).
 */
export const CRITIC_RUBRIC_VERSION = 1;

/** Derive a builtin envelope from a weight table — never hand-write the numbers. */
function builtinRubricFrom(weights: Record<string, number>): CriticRubric {
  const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return {
    version: CRITIC_RUBRIC_VERSION,
    source: 'builtin',
    // Fresh builtin criterion scores are bounded 1..max, so the lowest
    // attainable total is Σ weight × 1 (20) — the floor is a rubric property,
    // not a promise that 0 is reachable (ADR-177 principle 1).
    scaleMin: weightSum,
    scaleMax: 100,
    criteria: Object.fromEntries(
      Object.entries(weights).map(([criterion, weight]) => [criterion, { max: CRITIC_MAX_CRITERION_SCORE, weight }]),
    ),
  };
}

/** Envelope for the current 10-criterion rubric (ADR-300 weights). */
export const BUILTIN_CRITIC_RUBRIC: CriticRubric = builtinRubricFrom(CRITIC_CRITERION_WEIGHTS);

/** Envelope for the frozen 9-criterion HUMANITY rubric (ADR-136 weights). */
export const BUILTIN_CRITIC_RUBRIC_HUMANITY: CriticRubric = builtinRubricFrom(CRITIC_CRITERION_WEIGHTS_HUMANITY);

/** Envelope for the frozen pre-HUMANITY 8-criterion rubric (ADR-087 weights). */
export const BUILTIN_CRITIC_RUBRIC_PRE_HUMANITY: CriticRubric = builtinRubricFrom(
  CRITIC_CRITERION_WEIGHTS_PRE_HUMANITY,
);

/**
 * Builtin envelope for a VALIDATED builtin feedback. Sound only downstream of
 * `validateFreshCriticFeedback` without `allowCustomRubric`, which has already
 * proven the criterion set equals a builtin set exactly — the name-collision
 * unsoundness of criteria sniffing exists only for custom rubrics, which get
 * an operator declaration instead (ADR-177 §7).
 */
export function builtinCriticRubricFor(
  scores: Record<string, { score: number; feedback: string }> | null | undefined,
): CriticRubric {
  const weights = criticCriterionWeightsFor(scores);
  if (weights === CRITIC_CRITERION_WEIGHTS) return BUILTIN_CRITIC_RUBRIC;
  return weights === CRITIC_CRITERION_WEIGHTS_HUMANITY
    ? BUILTIN_CRITIC_RUBRIC_HUMANITY
    : BUILTIN_CRITIC_RUBRIC_PRE_HUMANITY;
}

/**
 * Validate a rubric envelope against the ADR-177 invariants. Returns the list
 * of violations (empty = valid). Shared by the write path (never persist a
 * broken envelope) and the edit-time `checkRubric` structure check.
 *
 * The load-bearing rule: **`Σ (weight × max) === 100` exactly** — a perfect
 * draft scores exactly 100. `scaleMax` is a pinned literal, never an author
 * knob; the FLOOR (`scaleMin`) is deliberately the author's choice.
 */
export function validateCriticRubric(rubric: CriticRubric): string[] {
  const problems: string[] = [];
  const parsed = CriticRubricSchema(rubric);
  if (parsed instanceof type.errors) {
    return [`malformed rubric envelope: ${parsed.summary}`];
  }
  const criteria = Object.entries(rubric.criteria);
  if (criteria.length === 0) problems.push('rubric declares no criteria');
  if (rubric.scaleMax !== 100) {
    problems.push(`scaleMax must be exactly 100 (got ${rubric.scaleMax}) — the ceiling is pinned, not configurable`);
  }
  const ceiling = criteria.reduce((sum, [, c]) => sum + c.weight * c.max, 0);
  if (ceiling !== 100) {
    problems.push(
      `Σ (weight × max) must equal exactly 100 so a perfect draft scores 100 — this rubric tops out at ${ceiling}`,
    );
  }
  if (rubric.scaleMin > 100) problems.push(`scaleMin ${rubric.scaleMin} exceeds the 100 ceiling`);
  return problems;
}

export * from './critic-gate-refusal';
