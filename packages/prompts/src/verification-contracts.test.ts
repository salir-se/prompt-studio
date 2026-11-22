// @module-tag pure
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  derivePromptVerificationState,
  PromptSemanticStatusSchema,
  PromptVerificationEnforcementSchema,
  PromptVerificationFindingSchema,
  PromptVerificationProfileSchema,
  PromptVerificationReportSchema,
  PromptVerificationRuleSchema,
  PromptVerificationScopeSchema,
  PromptVerificationSeveritySchema,
  PromptVerificationStateSchema,
} from './verification-contracts';

const valid = (schema: (value: unknown) => unknown, value: unknown): boolean => !(schema(value) instanceof type.errors);

const profileRef = { id: 'scout.verification', version: 1 };
const deterministicFinding = {
  source: 'deterministic',
  profile: profileRef,
  scope: 'consolidated',
  ruleId: 'mission-not-empty',
  severity: 'error',
  enforcement: 'runtime',
  message: 'The section is empty.',
  subject: 'scout.mission',
} as const;
const semanticFinding = {
  source: 'semantic',
  profile: profileRef,
  scope: 'consolidated',
  principleId: 'mission-preservation',
  severity: 'warning',
  message: 'The final prompt weakens the mission.',
  evidenceQuote: 'Ignore the ICP.',
  proposedCorrection: 'Keep the ICP as the targeting authority.',
} as const;

describe('PromptVerificationRuleSchema', () => {
  const common = { id: 'rule-1', severity: 'error', enforcement: 'activation' } as const;

  it.each([
    { ...common, kind: 'non-empty' },
    { ...common, kind: 'required-placeholder', name: 'icp_text' },
    { ...common, kind: 'known-placeholder', allowedNames: ['icp_text', 'current_date'] },
    { ...common, kind: 'required-tool', name: 'save_lead' },
    { ...common, kind: 'required-output-literal', literal: 'totalScore' },
    { ...common, kind: 'valid-rubric' },
    { ...common, kind: 'cache-sensitive-dynamic' },
    { ...common, kind: 'minimum-length', minChars: 100 },
    { ...common, kind: 'forbidden-combination', first: 'always send', second: 'never send' },
  ])('accepts the $kind branch', (rule) => {
    expect(valid(PromptVerificationRuleSchema, rule)).toBe(true);
  });

  it('rejects unknown rule kinds and branch-specific extra fields', () => {
    expect(valid(PromptVerificationRuleSchema, { ...common, kind: 'made-up' })).toBe(false);
    expect(valid(PromptVerificationRuleSchema, { ...common, kind: 'non-empty', name: 'extra' })).toBe(false);
  });
});

describe('verification profile and finding schemas', () => {
  const principle = {
    id: 'mission-preservation',
    version: 1,
    owner: 'platform',
    statement: 'Preserve the Scout mission.',
    severity: 'error',
    allowedCustomization: 'Wording and examples may change.',
    sectionIds: ['scout.mission'],
  } as const;

  it('accepts every scope, severity, and enforcement value', () => {
    for (const scope of ['section', 'blueprint', 'consolidated']) {
      expect(valid(PromptVerificationScopeSchema, scope)).toBe(true);
    }
    for (const severity of ['info', 'warning', 'error']) {
      expect(valid(PromptVerificationSeveritySchema, severity)).toBe(true);
    }
    for (const enforcement of ['edit', 'activation', 'runtime']) {
      expect(valid(PromptVerificationEnforcementSchema, enforcement)).toBe(true);
    }
  });

  it('accepts an immutable profile and rejects unknown nested fields', () => {
    const profile = {
      ...profileRef,
      scope: 'section',
      sectionId: 'scout.mission',
      deterministicRules: [{ id: 'mission-not-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
      principles: [principle],
      dependsOn: ['scout.context'],
    };
    expect(valid(PromptVerificationProfileSchema, profile)).toBe(true);
    expect(
      valid(PromptVerificationProfileSchema, {
        ...profile,
        principles: [{ ...principle, unexpected: true }],
      }),
    ).toBe(false);
  });

  it('requires sectionId for section profiles and rejects it for non-section profiles', () => {
    const common = {
      ...profileRef,
      deterministicRules: [],
      principles: [principle],
    };

    expect(valid(PromptVerificationProfileSchema, { ...common, scope: 'section', sectionId: 'scout.mission' })).toBe(
      true,
    );
    expect(valid(PromptVerificationProfileSchema, { ...common, scope: 'section' })).toBe(false);
    for (const scope of ['blueprint', 'consolidated']) {
      expect(valid(PromptVerificationProfileSchema, { ...common, scope })).toBe(true);
      expect(valid(PromptVerificationProfileSchema, { ...common, scope, sectionId: 'scout.mission' })).toBe(false);
    }
  });

  it('accepts deterministic and semantic provenance findings', () => {
    expect(
      valid(PromptVerificationFindingSchema, {
        source: 'deterministic',
        profile: profileRef,
        scope: 'section',
        sectionId: 'scout.mission',
        ruleId: 'mission-not-empty',
        severity: 'error',
        enforcement: 'runtime',
        message: 'The section is empty.',
        subject: 'scout.mission',
      }),
    ).toBe(true);
    expect(
      valid(PromptVerificationFindingSchema, {
        ...semanticFinding,
      }),
    ).toBe(true);
  });

  it.each([deterministicFinding, semanticFinding])(
    'requires sectionId for $source section findings and rejects it for non-section findings',
    (finding) => {
      expect(valid(PromptVerificationFindingSchema, { ...finding, scope: 'section' })).toBe(false);
      expect(valid(PromptVerificationFindingSchema, { ...finding, scope: 'section', sectionId: 'scout.mission' })).toBe(
        true,
      );
      for (const scope of ['blueprint', 'consolidated']) {
        expect(valid(PromptVerificationFindingSchema, { ...finding, scope })).toBe(true);
        expect(valid(PromptVerificationFindingSchema, { ...finding, scope, sectionId: 'scout.mission' })).toBe(false);
      }
    },
  );

  it('requires non-empty evidence and a proposed correction for semantic findings', () => {
    const { evidenceQuote, ...withoutEvidence } = semanticFinding;
    const { proposedCorrection, ...withoutCorrection } = semanticFinding;
    expect(evidenceQuote).toBeTruthy();
    expect(proposedCorrection).toBeTruthy();
    expect(valid(PromptVerificationFindingSchema, withoutEvidence)).toBe(false);
    expect(valid(PromptVerificationFindingSchema, withoutCorrection)).toBe(false);
    expect(valid(PromptVerificationFindingSchema, { ...semanticFinding, evidenceQuote: '' })).toBe(false);
    expect(valid(PromptVerificationFindingSchema, { ...semanticFinding, proposedCorrection: '' })).toBe(false);
  });

  it('rejects unknown finding fields', () => {
    expect(valid(PromptVerificationFindingSchema, { ...deterministicFinding, unexpected: true })).toBe(false);
    expect(valid(PromptVerificationFindingSchema, { ...semanticFinding, unexpected: true })).toBe(false);
  });
});

describe('PromptVerificationReportSchema', () => {
  const report = {
    key: {
      blueprint: { id: 'scout', version: 1 },
      profile: profileRef,
      contentHash: 'sha256:content',
      profileHash: 'sha256:profile',
      dependencies: [{ id: 'scout.context', contentHash: 'sha256:dep-content', profileHash: 'sha256:dep-profile' }],
      extensionContractsHash: 'sha256:extensions',
      toolContractsHash: 'sha256:tools',
      verifierConfigurationHash: 'sha256:verifier',
    },
    state: 'verified',
    semanticStatus: 'passed',
    findings: [],
  } as const;

  it('accepts every report state and semantic status', () => {
    for (const state of ['valid', 'verified', 'warning', 'invalid', 'degraded']) {
      expect(valid(PromptVerificationStateSchema, state)).toBe(true);
    }
    for (const status of ['not-run', 'passed', 'findings', 'unavailable']) {
      expect(valid(PromptSemanticStatusSchema, status)).toBe(true);
    }
    expect(valid(PromptVerificationReportSchema, report)).toBe(true);
  });

  it('rejects unknown fields at report, key, dependency, and blueprint levels', () => {
    expect(valid(PromptVerificationReportSchema, { ...report, unexpected: true })).toBe(false);
    expect(valid(PromptVerificationReportSchema, { ...report, key: { ...report.key, unexpected: true } })).toBe(false);
    expect(
      valid(PromptVerificationReportSchema, {
        ...report,
        key: { ...report.key, dependencies: [{ ...report.key.dependencies[0], unexpected: true }] },
      }),
    ).toBe(false);
    expect(
      valid(PromptVerificationReportSchema, {
        ...report,
        key: { ...report.key, blueprint: { ...report.key.blueprint, unexpected: true } },
      }),
    ).toBe(false);
  });

  it('requires the exact verification-profile reference even when findings are empty', () => {
    const { profile, ...keyWithoutProfile } = report.key;
    expect(profile).toEqual(profileRef);
    expect(valid(PromptVerificationReportSchema, { ...report, key: keyWithoutProfile })).toBe(false);
  });

  it('requires verifier configuration identity for deterministic and semantic reports', () => {
    const { verifierConfigurationHash, ...keyWithoutVerifierConfiguration } = report.key;
    expect(verifierConfigurationHash).toBe('sha256:verifier');
    expect(valid(PromptVerificationReportSchema, { ...report, key: keyWithoutVerifierConfiguration })).toBe(false);
  });

  it.each([
    { semanticStatus: 'not-run', findings: [], state: 'valid' },
    { semanticStatus: 'passed', findings: [], state: 'verified' },
    { semanticStatus: 'unavailable', findings: [], state: 'degraded' },
    { semanticStatus: 'findings', findings: [semanticFinding], state: 'warning' },
    { semanticStatus: 'passed', findings: [deterministicFinding], state: 'invalid' },
  ] as const)('requires derived state $state for $semanticStatus reports', ({ semanticStatus, findings, state }) => {
    expect(derivePromptVerificationState(semanticStatus, findings)).toBe(state);
    expect(valid(PromptVerificationReportSchema, { ...report, semanticStatus, findings, state })).toBe(true);
    expect(
      valid(PromptVerificationReportSchema, {
        ...report,
        semanticStatus,
        findings,
        state: state === 'valid' ? 'verified' : 'valid',
      }),
    ).toBe(false);
  });
});
