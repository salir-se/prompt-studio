import {
  parsePromptDesign,
  type PromptDesign,
  type PromptVerificationProfile,
  type PromptVerificationRule,
} from '@prompt-studio/prompts';

export const WHOLE_PROMPT = '__whole_prompt__';
export const RULE_NAMES: Record<PromptVerificationRule['kind'], string> = {
  'non-empty': 'Contains instructions',
  'required-placeholder': 'Required variable',
  'known-placeholder': 'Known variables only',
  'required-tool': 'Required tool',
  'required-output-literal': 'Required text',
  'minimum-length': 'Minimum length',
  'forbidden-combination': 'Conflicting instructions',
  'valid-rubric': 'Valid scoring rubric',
  'valid-json-output': 'Valid JSON output instructions',
  'cache-sensitive-dynamic': 'Dynamic values and cache reuse',
  'identity-in-prompt': 'Identity belongs in the prompt',
};

export function ruleDescription(rule: PromptVerificationRule): string {
  switch (rule.kind) {
    case 'required-placeholder':
      return `Includes {{${rule.name}}}.`;
    case 'required-tool':
      return `Mentions ${rule.name}.`;
    case 'required-output-literal':
      return `Includes “${rule.literal}”.`;
    case 'minimum-length':
      return `At least ${rule.minChars} characters.`;
    case 'known-placeholder':
      return `Allowed variables: ${rule.allowedNames.join(', ') || 'none'}.`;
    case 'forbidden-combination':
      return `Does not combine “${rule.first}” and “${rule.second}”.`;
    default:
      return RULE_NAMES[rule.kind];
  }
}

export function profilesForScope(profiles: readonly PromptVerificationProfile[], scope: string) {
  return profiles.filter((profile) =>
    scope === WHOLE_PROMPT ? profile.scope !== 'section' : profile.scope === 'section' && profile.sectionId === scope,
  );
}

/** Preserve every other contract/profile and bump only the definitions that changed. */
export function revisedVerificationDesign(original: PromptDesign, draft: PromptDesign): PromptDesign {
  const verificationProfiles = draft.verificationProfiles.map((profile) => {
    const before = original.verificationProfiles.find((item) => item.id === profile.id);
    if (!before || JSON.stringify(before) === JSON.stringify(profile)) return profile;
    const protectedCriteria = before.principles.filter((item) => item.owner === 'platform');
    for (const protectedCriterion of protectedCriteria) {
      if (
        JSON.stringify(profile.principles.find((item) => item.id === protectedCriterion.id)) !==
        JSON.stringify(protectedCriterion)
      )
        throw new Error('Protected platform criteria cannot be changed.');
    }
    return {
      ...profile,
      version: before.version + 1,
      principles: profile.principles.map((criterion) => {
        const previous = before.principles.find((item) => item.id === criterion.id);
        return previous && JSON.stringify(previous) !== JSON.stringify(criterion)
          ? { ...criterion, version: previous.version + 1 }
          : criterion;
      }),
    };
  });
  return parsePromptDesign(JSON.stringify({ ...draft, version: original.version + 1, verificationProfiles }));
}
