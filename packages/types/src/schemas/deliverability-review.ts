import { type } from 'arktype';
import { lazyType } from '../lazy-type';

/**
 * Risk levels the Critic's DELIVERABILITY criterion reports (ADR-300). `high` means a content filter or a wary
 * recipient would read the draft as spam or phishing; the matching criterion score is 1, an automatic rejection.
 */
export const DeliverabilityRiskSchema = lazyType(() => type("'low' | 'medium' | 'high'"));
export type DeliverabilityRisk = typeof DeliverabilityRiskSchema.infer;

/**
 * One content risk the Critic found, quoted from the draft. `source` separates checks modelled on Apache
 * SpamAssassin's content rules from semantic quality checks; the Critic never claims to have run SpamAssassin.
 */
export const DeliverabilityFindingSchema = lazyType(() =>
  type({
    category: "'subject' | 'content' | 'url' | 'credibility' | 'outreach' | 'compliance'",
    source: "'spamassassin_inspired' | 'semantic'",
    severity: DeliverabilityRiskSchema,
    /** The exact offending text or field name. */
    evidence: 'string',
    reason: 'string',
    /** The smallest correction that removes the risk. */
    suggestion: 'string',
    confidence: '0 <= number <= 1',
  }).onUndeclaredKey('ignore'),
);
export type DeliverabilityFinding = typeof DeliverabilityFindingSchema.infer;

/**
 * Structured result of the DELIVERABILITY criterion, stored next to its score. Authentication, reputation, transport
 * headers and DNS are invisible to a content review, so `technicalChecks` is always `not_checked`: never a pass.
 * `requiresManualReview` marks a finding a rewrite cannot settle (a possible compliance issue, an impersonation signal);
 * such a draft is never approved by the Salir bot, only by a person.
 */
export const DeliverabilityReviewSchema = lazyType(() =>
  type({
    contentRisk: DeliverabilityRiskSchema,
    findings: DeliverabilityFindingSchema.array(),
    technicalChecks: "'not_checked'",
    requiresManualReview: 'boolean',
  }).onUndeclaredKey('ignore'),
);
export type DeliverabilityReview = typeof DeliverabilityReviewSchema.infer;
