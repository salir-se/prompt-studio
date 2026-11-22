// @module-tag pure
import { describe, expect, it } from 'vitest';
import { PROMPT_STRUCTURE_CONTRACTS } from './structure-contracts';
import type { PromptVerificationProfile } from './verification-contracts';
import {
  buildPromptRuleMutation,
  getLegacyConsolidatedVerificationProfile,
  LEGACY_CONSOLIDATED_VERIFICATION_PROFILES,
  mapLegacySemanticVerification,
  runLegacyVerificationProfile,
  runPromptVerificationProfile,
} from './verification-profiles';

const PROFILE_KEYS = Object.keys(PROMPT_STRUCTURE_CONTRACTS);

describe('legacy consolidated verification profiles', () => {
  it.each(PROFILE_KEYS)('%s: canonical default passes its generated profile', (key) => {
    const contract = PROMPT_STRUCTURE_CONTRACTS[key];
    expect(runLegacyVerificationProfile(key, contract.defaultText)).toEqual([]);
  });

  it.each(
    PROFILE_KEYS.flatMap((key) =>
      LEGACY_CONSOLIDATED_VERIFICATION_PROFILES[key].deterministicRules.map((rule) => ({ key, rule })),
    ),
  )('$key: mutation for $rule.id produces that rule finding', ({ key, rule }) => {
    const profile = getLegacyConsolidatedVerificationProfile(key);
    const findings = runPromptVerificationProfile(
      profile,
      buildPromptRuleMutation(rule, PROMPT_STRUCTURE_CONTRACTS[key].defaultText),
    );
    expect(findings.some((finding) => finding.source === 'deterministic' && finding.ruleId === rule.id)).toBe(true);
  });

  it('deep-freezes the published registry and falls back to a minimal profile for an unknown key', () => {
    // Given: a prompt key that no structure contract declares
    const key = 'support-triage';

    // When: the legacy structure profile is requested for it
    const profile = runLegacyVerificationProfile(key, '');
    const signed = runLegacyVerificationProfile(key, 'Classify the message.\nBest regards,\nMaja Lind');

    // Then: the registry is frozen, a strict lookup refuses the key, and the fallback still rejects an
    // empty prompt and warns about a sign-off written into the prompt
    expect(Object.isFrozen(LEGACY_CONSOLIDATED_VERIFICATION_PROFILES)).toBe(true);
    expect(() => getLegacyConsolidatedVerificationProfile(key)).toThrow(/No legacy verification profile/);
    expect(profile.map((finding) => finding.source === 'deterministic' && finding.ruleId)).toEqual(['non-empty']);
    expect(signed).toEqual([
      expect.objectContaining({
        ruleId: 'identity-in-prompt',
        severity: 'warning',
        subject: 'line 2: Best regards, / Maja Lind',
      }),
    ]);
  });
});

describe('generic verification profile runner', () => {
  const scopedProfiles = [
    {
      profile: {
        id: 'section-profile',
        version: 1,
        scope: 'section',
        sectionId: 'scout.mission',
        deterministicRules: [{ id: 'content', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
        principles: [],
      },
      expectedScope: { scope: 'section', sectionId: 'scout.mission' },
    },
    {
      profile: {
        id: 'blueprint-profile',
        version: 1,
        scope: 'blueprint',
        deterministicRules: [{ id: 'content', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
        principles: [],
      },
      expectedScope: { scope: 'blueprint' },
    },
    {
      profile: {
        id: 'consolidated-profile',
        version: 1,
        scope: 'consolidated',
        deterministicRules: [{ id: 'content', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
        principles: [],
      },
      expectedScope: { scope: 'consolidated' },
    },
  ] as const satisfies readonly { profile: PromptVerificationProfile; expectedScope: object }[];

  it.each(scopedProfiles)('emits $profile.scope provenance', ({ profile, expectedScope }) => {
    expect(runPromptVerificationProfile(profile, '')).toEqual([
      expect.objectContaining({
        ...expectedScope,
        source: 'deterministic',
        profile: { id: profile.id, version: profile.version },
        ruleId: 'content',
      }),
    ]);
  });

  it('custom profiles can add, remove, and change rules without changing the runner', () => {
    const outputRule = {
      id: 'required-json-key',
      kind: 'required-output-literal',
      literal: 'totalScore',
      severity: 'warning',
      enforcement: 'edit',
    } as const;
    const base = {
      id: 'custom-blueprint',
      version: 1,
      scope: 'blueprint',
      principles: [],
    } as const;

    expect(runPromptVerificationProfile({ ...base, deterministicRules: [outputRule] }, 'plain output')).toEqual([
      expect.objectContaining({ ruleId: outputRule.id, severity: 'warning', enforcement: 'edit' }),
    ]);
    expect(runPromptVerificationProfile({ ...base, deterministicRules: [] }, 'plain output')).toEqual([]);
    expect(
      runPromptVerificationProfile(
        {
          ...base,
          deterministicRules: [{ ...outputRule, severity: 'error', enforcement: 'runtime' }],
        },
        'plain output',
      ),
    ).toEqual([expect.objectContaining({ ruleId: outputRule.id, severity: 'error', enforcement: 'runtime' })]);
  });

  it('finds an assembled conflict that neither fragment contains alone', () => {
    const conflictRule = {
      id: 'follow-up-policy-conflict',
      kind: 'forbidden-combination',
      first: 'Always send a follow-up.',
      second: 'Never send a follow-up.',
      severity: 'error',
      enforcement: 'activation',
    } as const;
    const profile = {
      id: 'assembled-blueprint',
      version: 1,
      scope: 'blueprint',
      deterministicRules: [conflictRule],
      principles: [],
    } as const satisfies PromptVerificationProfile;

    expect(runPromptVerificationProfile(profile, conflictRule.first)).toEqual([]);
    expect(runPromptVerificationProfile(profile, conflictRule.second)).toEqual([]);
    expect(runPromptVerificationProfile(profile, `${conflictRule.first}\n${conflictRule.second}`)).toEqual([
      expect.objectContaining({
        source: 'deterministic',
        scope: 'blueprint',
        ruleId: conflictRule.id,
        severity: 'error',
        enforcement: 'activation',
      }),
    ]);
  });

  it('verifies structured JSON output examples through a deterministic profile rule', () => {
    const profile = {
      id: 'structured-output',
      version: 1,
      scope: 'consolidated',
      deterministicRules: [
        { id: 'structured-output', kind: 'valid-json-output', severity: 'error', enforcement: 'runtime' },
      ],
      principles: [],
    } as const satisfies PromptVerificationProfile;
    const outputContract = {
      kind: 'json',
      description: 'One score.',
      jsonSchema: {
        type: 'object',
        required: ['score'],
        properties: { score: { type: 'integer', maximum: 100 } },
        additionalProperties: false,
      },
      examples: [{ score: 101 }],
    } as const;

    expect(runPromptVerificationProfile(profile, 'Return JSON.', { outputContract })).toEqual([
      expect.objectContaining({ ruleId: 'structured-output', subject: 'output-example:0' }),
    ]);
  });

  it('warns only for placeholders declared as cache-sensitive dynamic values', () => {
    const profile = {
      id: 'cache-sensitive-values',
      version: 1,
      scope: 'consolidated',
      deterministicRules: [
        {
          id: 'cache-sensitive-dynamic',
          kind: 'cache-sensitive-dynamic',
          severity: 'warning',
          enforcement: 'edit',
        },
      ],
      principles: [],
    } as const satisfies PromptVerificationProfile;
    const text = 'Stable instructions. Generated at {{current_timestamp}} for {{configured_tone}}.';

    expect(runPromptVerificationProfile(profile, text, { dynamicVariableNames: ['current_timestamp'] })).toEqual([
      expect.objectContaining({
        ruleId: 'cache-sensitive-dynamic',
        severity: 'warning',
        subject: 'current_timestamp',
        message: expect.stringContaining('before the cache breakpoint'),
      }),
    ]);
    expect(runPromptVerificationProfile(profile, text, { dynamicVariableNames: [] })).toEqual([]);
  });
});

/** A consolidated profile carrying the six semantic lenses a structure contract generates. */
function semanticProfile(id: string): PromptVerificationProfile {
  const principle = (principleId: string, severity: 'error' | 'warning' = 'error') => ({
    id: principleId,
    version: 1,
    owner: 'platform' as const,
    statement: `Preserve the ${principleId} contract.`,
    severity,
    allowedCustomization: 'Wording may change while the prompt keeps its declared functional contract.',
    sectionIds: [],
  });
  return {
    id: `${id}.legacy.consolidated`,
    version: 1,
    scope: 'consolidated',
    deterministicRules: [{ id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
    principles: [
      principle('semantic-tools'),
      principle('semantic-output'),
      principle('semantic-mission'),
      principle('semantic-placeholder'),
      principle('scoring-principles'),
      principle('other', 'warning'),
    ],
  };
}

describe('legacy profile adapters', () => {
  it.each([
    'semantic-tools',
    'semantic-output',
    'semantic-mission',
    'semantic-placeholder',
    'scoring-principles',
    'other',
  ] as const)('maps adversarial %s results to semantic provenance', (category) => {
    // Given: a consolidated profile and a semantic finding that quotes the edited prompt exactly
    const profile = semanticProfile('support-triage');
    const evidenceQuote = `Conflicting ${category} instruction.`;
    // When: the legacy semantic verification is mapped onto the profile
    const [finding] = mapLegacySemanticVerification(profile, `Edited prompt.\n${evidenceQuote}`, {
      verdict: 'fail',
      findings: [
        {
          severity: 'info',
          category,
          message: `Adversarial ${category} mutation.`,
          evidenceQuote,
          proposedCorrection: `Restore the ${category} contract.`,
        },
      ],
    });
    const principle = profile.principles.find((candidate) => candidate.id === category);

    // Then: the finding carries semantic provenance and the matching principle's severity
    expect(finding).toEqual({
      source: 'semantic',
      profile: { id: profile.id, version: profile.version },
      scope: 'consolidated',
      principleId: category,
      severity: principle?.severity,
      message: `Adversarial ${category} mutation.`,
      evidenceQuote,
      proposedCorrection: `Restore the ${category} contract.`,
    });
  });

  it('rejects semantic evidence that is not an exact substring of the edited prompt', () => {
    // Given: a consolidated profile and an edited prompt that does not contain the cited evidence
    const profile = semanticProfile('support-triage');
    // When / Then: mapping the finding refuses the invented quote
    expect(() =>
      mapLegacySemanticVerification(profile, 'The actual edited prompt.', {
        verdict: 'fail',
        findings: [
          {
            severity: 'error',
            category: 'semantic-mission',
            message: 'The mission is inverted.',
            evidenceQuote: 'Text that is not present.',
            proposedCorrection: 'Restore the mission.',
          },
        ],
      }),
    ).toThrow(/not an exact quote/);
  });
});
