import { lazyType } from '@prompt-studio/types/lazy-type';
import { type } from 'arktype';

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export const PromptVerificationScopeSchema = lazyType(() => type("'section' | 'blueprint' | 'consolidated'"));
export type PromptVerificationScope = typeof PromptVerificationScopeSchema.infer;

export const PromptVerificationSeveritySchema = lazyType(() => type("'info' | 'warning' | 'error'"));
export type PromptVerificationSeverity = typeof PromptVerificationSeveritySchema.infer;

export const PromptVerificationEnforcementSchema = lazyType(() => type("'edit' | 'activation' | 'runtime'"));
export type PromptVerificationEnforcement = typeof PromptVerificationEnforcementSchema.infer;

const ruleFields = {
  id: 'string > 0',
  severity: PromptVerificationSeveritySchema,
  enforcement: PromptVerificationEnforcementSchema,
} as const;

const NonEmptyRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'non-empty'",
    '+': 'reject',
  }),
);

const RequiredPlaceholderRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'required-placeholder'",
    name: 'string > 0',
    '+': 'reject',
  }),
);

const KnownPlaceholderRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'known-placeholder'",
    allowedNames: 'string[]',
    '+': 'reject',
  }),
);

const RequiredToolRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'required-tool'",
    name: 'string > 0',
    '+': 'reject',
  }),
);

const RequiredOutputLiteralRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'required-output-literal'",
    literal: 'string > 0',
    '+': 'reject',
  }),
);

const ValidRubricRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'valid-rubric'",
    '+': 'reject',
  }),
);

const ValidJsonOutputRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'valid-json-output'",
    '+': 'reject',
  }),
);

const CacheSensitiveDynamicRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'cache-sensitive-dynamic'",
    '+': 'reject',
  }),
);

const IdentityInPromptRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'identity-in-prompt'",
    '+': 'reject',
  }),
);

const MinimumLengthRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'minimum-length'",
    minChars: 'number.integer >= 0',
    '+': 'reject',
  }),
);

const ForbiddenCombinationRuleSchema = lazyType(() =>
  type({
    ...ruleFields,
    kind: "'forbidden-combination'",
    first: 'string > 0',
    second: 'string > 0',
    '+': 'reject',
  }),
);

export const PromptVerificationRuleSchema = lazyType(() =>
  NonEmptyRuleSchema.or(RequiredPlaceholderRuleSchema)
    .or(KnownPlaceholderRuleSchema)
    .or(RequiredToolRuleSchema)
    .or(RequiredOutputLiteralRuleSchema)
    .or(ValidRubricRuleSchema)
    .or(ValidJsonOutputRuleSchema)
    .or(CacheSensitiveDynamicRuleSchema)
    .or(IdentityInPromptRuleSchema)
    .or(MinimumLengthRuleSchema)
    .or(ForbiddenCombinationRuleSchema),
);
export type PromptVerificationRule = DeepReadonly<typeof PromptVerificationRuleSchema.infer>;

export const PromptVerificationPrincipleSchema = lazyType(() =>
  type({
    id: 'string > 0',
    version: 'number.integer >= 1',
    owner: "'platform' | 'configuration'",
    statement: 'string > 0',
    severity: PromptVerificationSeveritySchema,
    allowedCustomization: 'string > 0',
    sectionIds: 'string[]',
    '+': 'reject',
  }),
);
export type PromptVerificationPrinciple = DeepReadonly<typeof PromptVerificationPrincipleSchema.infer>;

// A function, not an object: `.array()` on a schema builds it, and that belongs inside the lazy thunks below.
const verificationProfileFields = () =>
  ({
    id: 'string > 0',
    version: 'number.integer >= 1',
    deterministicRules: PromptVerificationRuleSchema.array(),
    principles: PromptVerificationPrincipleSchema.array(),
    'dependsOn?': 'string[]',
  }) as const;

const SectionPromptVerificationProfileSchema = lazyType(() =>
  type({
    ...verificationProfileFields(),
    scope: "'section'",
    sectionId: 'string > 0',
    '+': 'reject',
  }),
);

const NonSectionPromptVerificationProfileSchema = lazyType(() =>
  type({
    ...verificationProfileFields(),
    scope: "'blueprint' | 'consolidated'",
    '+': 'reject',
  }),
);

export const PromptVerificationProfileSchema = lazyType(() =>
  SectionPromptVerificationProfileSchema.or(NonSectionPromptVerificationProfileSchema),
);
export type PromptVerificationProfile = DeepReadonly<typeof PromptVerificationProfileSchema.infer>;

const PromptVersionReferenceSchema = lazyType(() =>
  type({
    id: 'string > 0',
    version: 'number.integer >= 1',
    '+': 'reject',
  }),
);

const findingFields = {
  profile: PromptVersionReferenceSchema,
  severity: PromptVerificationSeveritySchema,
  message: 'string > 0',
} as const;

const deterministicFindingFields = {
  source: "'deterministic'",
  ruleId: 'string > 0',
  enforcement: PromptVerificationEnforcementSchema,
  'subject?': 'string > 0',
} as const;

const semanticFindingFields = {
  source: "'semantic'",
  principleId: 'string > 0',
  evidenceQuote: 'string > 0',
  proposedCorrection: 'string > 0',
} as const;

const SectionDeterministicFindingSchema = lazyType(() =>
  type({
    ...findingFields,
    ...deterministicFindingFields,
    scope: "'section'",
    sectionId: 'string > 0',
    '+': 'reject',
  }),
);

const NonSectionDeterministicFindingSchema = lazyType(() =>
  type({
    ...findingFields,
    ...deterministicFindingFields,
    scope: "'blueprint' | 'consolidated'",
    '+': 'reject',
  }),
);

const SectionSemanticFindingSchema = lazyType(() =>
  type({
    ...findingFields,
    ...semanticFindingFields,
    scope: "'section'",
    sectionId: 'string > 0',
    '+': 'reject',
  }),
);

const NonSectionSemanticFindingSchema = lazyType(() =>
  type({
    ...findingFields,
    ...semanticFindingFields,
    scope: "'blueprint' | 'consolidated'",
    '+': 'reject',
  }),
);

export const PromptVerificationFindingSchema = lazyType(() =>
  SectionDeterministicFindingSchema.or(NonSectionDeterministicFindingSchema)
    .or(SectionSemanticFindingSchema)
    .or(NonSectionSemanticFindingSchema),
);
export type PromptVerificationFinding = DeepReadonly<typeof PromptVerificationFindingSchema.infer>;

const PromptVerificationDependencySchema = lazyType(() =>
  type({
    id: 'string > 0',
    contentHash: 'string > 0',
    profileHash: 'string > 0',
    '+': 'reject',
  }),
);

export const PromptVerificationReportKeySchema = lazyType(() =>
  type({
    blueprint: PromptVersionReferenceSchema,
    profile: PromptVersionReferenceSchema,
    contentHash: 'string > 0',
    profileHash: 'string > 0',
    dependencies: PromptVerificationDependencySchema.array(),
    'extensionContractsHash?': 'string > 0',
    'toolContractsHash?': 'string > 0',
    verifierConfigurationHash: 'string > 0',
    '+': 'reject',
  }),
);
export type PromptVerificationReportKey = DeepReadonly<typeof PromptVerificationReportKeySchema.infer>;

export const PromptVerificationStateSchema = lazyType(() =>
  type("'valid' | 'verified' | 'warning' | 'invalid' | 'degraded'"),
);
export type PromptVerificationState = typeof PromptVerificationStateSchema.infer;

export const PromptSemanticStatusSchema = lazyType(() => type("'not-run' | 'passed' | 'findings' | 'unavailable'"));
export type PromptSemanticStatus = typeof PromptSemanticStatusSchema.infer;

export function derivePromptVerificationState(
  semanticStatus: PromptSemanticStatus,
  findings: readonly PromptVerificationFinding[],
): PromptVerificationState {
  const invalid = findings.some(
    (finding) =>
      finding.source === 'deterministic' &&
      finding.severity === 'error' &&
      (finding.enforcement === 'activation' || finding.enforcement === 'runtime'),
  );
  if (invalid) return 'invalid';

  const needsAcknowledgement =
    semanticStatus === 'findings' ||
    findings.some(
      (finding) =>
        finding.severity === 'warning' ||
        finding.source === 'semantic' ||
        (finding.source === 'deterministic' && finding.severity === 'error'),
    );
  if (needsAcknowledgement) return 'warning';
  if (semanticStatus === 'unavailable') return 'degraded';
  if (semanticStatus === 'passed') return 'verified';
  return 'valid';
}

export const PromptVerificationReportSchema = lazyType(() =>
  type({
    key: PromptVerificationReportKeySchema,
    state: PromptVerificationStateSchema,
    semanticStatus: PromptSemanticStatusSchema,
    findings: PromptVerificationFindingSchema.array(),
    '+': 'reject',
  }).narrow(
    (report, context) =>
      report.state === derivePromptVerificationState(report.semanticStatus, report.findings) ||
      context.mustBe('a verification report whose state matches its semantic status and findings'),
  ),
);
type InferredPromptVerificationReport = typeof PromptVerificationReportSchema.infer;
export type PromptVerificationReport = Readonly<
  Omit<InferredPromptVerificationReport, 'key' | 'findings'> & {
    readonly key: PromptVerificationReportKey;
    readonly findings: readonly PromptVerificationFinding[];
  }
>;
