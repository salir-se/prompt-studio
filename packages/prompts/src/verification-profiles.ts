import { findIdentityInPrompt, identityInPromptMessage } from './identity-in-prompt';
import { parseRubricDeclaration } from './rubric-declaration';
import type { PromptOutputContract } from './structure-contracts';
import { PROMPT_STRUCTURE_CONTRACTS, type PromptStructureContract } from './structure-contracts';
import { verifyStructuredJsonOutputExamples } from './structured-output';
import { extractPlaceholderNames, findUnknownPlaceholders, tokenizePromptText } from './variable-assist';
import { PROMPT_VARIABLE_DOCS } from './variable-docs';
import type {
  PromptVerificationFinding,
  PromptVerificationPrinciple,
  PromptVerificationProfile,
  PromptVerificationRule,
} from './verification-contracts';
import type { PromptVerification } from './verifier';

/** Below this fraction of the default prompt's length, flag a possible large deletion. */
export const LENGTH_SANITY_RATIO = 0.25;

export interface PromptVerificationRunOptions {
  /** Overrides the allowed names of `known-placeholder` rules for runtime-provided variables. */
  readonly knownVariables?: readonly string[];
  /** Overrides the names recognized while evaluating `required-tool` rules. */
  readonly toolNames?: readonly string[];
  /** Authored output contract used by `valid-json-output`. */
  readonly outputContract?: PromptOutputContract;
  /** Variables whose values can change between otherwise identical requests. */
  readonly dynamicVariableNames?: readonly string[];
  /**
   * Placeholders the active built-in sales configuration has deliberately banned from this
   * prompt (`salesModeBannedPlaceholders`): a `required-placeholder` rule for one of these is
   * the defect the configuration removed the placeholder to prevent, so it never reports.
   */
  readonly bannedPlaceholders?: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function semanticPrinciples(contract: PromptStructureContract): PromptVerificationPrinciple[] {
  const allowedCustomization =
    contract.customizationNotes ?? 'Wording may change while the prompt keeps its declared functional contract.';
  const principle = (
    id: string,
    statement: string,
    severity: PromptVerificationPrinciple['severity'] = 'error',
  ): PromptVerificationPrinciple => ({
    id,
    version: 1,
    owner: 'platform',
    statement,
    severity,
    allowedCustomization,
    sectionIds: [],
  });

  return [
    principle('semantic-tools', 'Preserve load-bearing tool usage, ordering, and preconditions.'),
    principle('semantic-output', `Preserve the output contract: ${contract.outputContract?.description ?? 'freeform'}`),
    principle('semantic-mission', contract.missionSummary),
    principle(
      'semantic-placeholder',
      'Keep every surviving placeholder in a context where its value remains meaningful.',
    ),
    principle(
      'scoring-principles',
      contract.scoringPrinciples ?? 'Do not introduce an incoherent scoring scale or output envelope.',
    ),
    principle('other', 'Report only material functional regressions outside the named semantic lenses.', 'warning'),
  ];
}

/**
 * [SAAS-001.R9] Advisory on every prompt: Settings own the signature and sender details, so an email
 * address or sign-off block in a prompt (custom or pinned) is a warning, never an error.
 */
const IDENTITY_IN_PROMPT_RULE: PromptVerificationRule = {
  id: 'identity-in-prompt',
  kind: 'identity-in-prompt',
  severity: 'warning',
  enforcement: 'edit',
};

function byName<T extends string>(left: T, right: T): number {
  return left.localeCompare(right);
}

function legacyRules(contract: PromptStructureContract): PromptVerificationRule[] {
  const docs = PROMPT_VARIABLE_DOCS[contract.promptKey];
  const allowedNames = [...docs.variables.map((variable) => variable.key), ...(docs.alsoResolves ?? [])];

  return [
    { id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' },
    ...[...contract.requiredPlaceholders]
      .sort((left, right) => byName(left.name, right.name))
      .map(({ name, severity }): PromptVerificationRule => ({
        id: `required-placeholder:${name}`,
        kind: 'required-placeholder',
        name,
        severity,
        enforcement: 'edit',
      })),
    {
      id: 'known-placeholder',
      kind: 'known-placeholder',
      allowedNames,
      severity: 'warning',
      enforcement: 'edit',
    },
    ...[...contract.defaultToolMentions].sort(byName).map((name): PromptVerificationRule => ({
      id: `required-tool:${name}`,
      kind: 'required-tool',
      name,
      severity: 'warning',
      enforcement: 'edit',
    })),
    ...[...(contract.outputContract?.requiredMentions ?? [])].sort(byName).map((literal): PromptVerificationRule => ({
      id: `required-output-literal:${literal}`,
      kind: 'required-output-literal',
      literal,
      severity: 'error',
      enforcement: 'runtime',
    })),
    ...(contract.scoringPrinciples
      ? ([{ id: 'valid-rubric', kind: 'valid-rubric', severity: 'error', enforcement: 'activation' }] as const)
      : []),
    IDENTITY_IN_PROMPT_RULE,
    {
      id: 'minimum-length',
      kind: 'minimum-length',
      minChars: Math.ceil(contract.defaultText.length * LENGTH_SANITY_RATIO),
      severity: 'warning',
      enforcement: 'edit',
    },
  ];
}

function createLegacyProfile(contract: PromptStructureContract): PromptVerificationProfile {
  return deepFreeze({
    id: `${contract.promptKey}.legacy.consolidated`,
    version: 1,
    scope: 'consolidated',
    deterministicRules: legacyRules(contract),
    principles: semanticPrinciples(contract),
  });
}

export const LEGACY_CONSOLIDATED_VERIFICATION_PROFILES: Readonly<Record<string, PromptVerificationProfile>> =
  deepFreeze(
    Object.fromEntries(
      Object.entries(PROMPT_STRUCTURE_CONTRACTS).map(([key, contract]) => [key, createLegacyProfile(contract)]),
    ),
  );

export function getLegacyConsolidatedVerificationProfile(promptKey: string): PromptVerificationProfile {
  const profile = LEGACY_CONSOLIDATED_VERIFICATION_PROFILES[promptKey];
  if (!profile) throw new TypeError(`No legacy verification profile for prompt key: ${promptKey}`);
  return profile;
}

/** Internal compatibility profile: unknown legacy keys still reject an empty prompt and otherwise stay silent. */
export function getLegacyStructureVerificationProfile(promptKey: string): PromptVerificationProfile {
  return (
    LEGACY_CONSOLIDATED_VERIFICATION_PROFILES[promptKey] ?? {
      id: `${promptKey}.legacy.consolidated`,
      version: 1,
      scope: 'consolidated',
      deterministicRules: [
        { id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' },
        IDENTITY_IN_PROMPT_RULE,
      ],
      principles: [],
    }
  );
}

function deterministicFinding(
  profile: PromptVerificationProfile,
  rule: PromptVerificationRule,
  message: string,
  subject?: string,
): PromptVerificationFinding {
  const finding = {
    source: 'deterministic' as const,
    profile: { id: profile.id, version: profile.version },
    ruleId: rule.id,
    severity: rule.severity,
    enforcement: rule.enforcement,
    message,
    ...(subject ? { subject } : {}),
  };
  if (profile.scope === 'section') {
    return { ...finding, scope: 'section', sectionId: profile.sectionId };
  }
  return { ...finding, scope: profile.scope };
}

function evaluateRule(
  profile: PromptVerificationProfile,
  rule: PromptVerificationRule,
  text: string,
  options: PromptVerificationRunOptions,
): PromptVerificationFinding[] {
  switch (rule.kind) {
    case 'non-empty':
      return text.trim() === ''
        ? [
            deterministicFinding(
              profile,
              rule,
              'The prompt is empty — an empty prompt renders no instructions to the agent.',
              'non-empty',
            ),
          ]
        : [];
    case 'required-placeholder':
      return options.bannedPlaceholders?.includes(rule.name) || extractPlaceholderNames(text).includes(rule.name)
        ? []
        : [
            deterministicFinding(
              profile,
              rule,
              `Required placeholder {{${rule.name}}} is missing — the runtime supplies it and the default prompt uses it.`,
              rule.name,
            ),
          ];
    case 'known-placeholder':
      return findUnknownPlaceholders(text, options.knownVariables ?? rule.allowedNames)
        .sort(byName)
        .map((name) =>
          deterministicFinding(
            profile,
            rule,
            `{{${name}}} is not a variable the runtime resolves — it will render as empty text.`,
            name,
          ),
        );
    case 'required-tool': {
      const mentioned = tokenizePromptText(text, {
        variables: options.knownVariables ?? [],
        tools: options.toolNames ?? [rule.name],
      }).some((token) => token.kind === 'tool' && token.name === rule.name);
      return mentioned
        ? []
        : [
            deterministicFinding(
              profile,
              rule,
              `The default prompt instructs the agent to use ${rule.name}; the edit no longer mentions it.`,
              rule.name,
            ),
          ];
    }
    case 'required-output-literal':
      return text.includes(rule.literal)
        ? []
        : [
            deterministicFinding(
              profile,
              rule,
              `Output-format key "${rule.literal}" no longer appears — downstream parsing expects it.`,
              rule.literal,
            ),
          ];
    case 'valid-rubric': {
      const declaration = parseRubricDeclaration(text);
      if (!declaration.declared) return [];
      return declaration.problems.map((problem) =>
        deterministicFinding(profile, rule, `Rubric declaration invalid: ${problem}`, 'rubric'),
      );
    }
    case 'valid-json-output':
      return verifyStructuredJsonOutputExamples(
        options.outputContract ?? { kind: 'json', description: 'Missing structured output contract.' },
      ).map((failure) =>
        deterministicFinding(
          profile,
          rule,
          `Structured JSON output example ${failure.exampleIndex + 1} is invalid: ${failure.errors.join(' ')}`,
          `output-example:${failure.exampleIndex}`,
        ),
      );
    case 'cache-sensitive-dynamic':
      return extractPlaceholderNames(text)
        .filter((name) => options.dynamicVariableNames?.includes(name))
        .sort(byName)
        .map((name) =>
          deterministicFinding(
            profile,
            rule,
            `Cache-sensitive dynamic value: {{${name}}} may change between requests. If it appears before the cache breakpoint, it reduces prompt-cache reuse and cost savings. Keep dynamic values after stable instructions when possible.`,
            name,
          ),
        );
    case 'identity-in-prompt':
      return findIdentityInPrompt(text).map((match) =>
        deterministicFinding(profile, rule, identityInPromptMessage(match.kind), `line ${match.line}: ${match.text}`),
      );
    case 'minimum-length':
      return text.trim().length < rule.minChars
        ? [
            deterministicFinding(
              profile,
              rule,
              'The edit is much shorter than the default prompt — a large deletion may have removed load-bearing instructions.',
              'minimum-length',
            ),
          ]
        : [];
    case 'forbidden-combination':
      return text.includes(rule.first) && text.includes(rule.second)
        ? [
            deterministicFinding(
              profile,
              rule,
              `Prompt contains forbidden combination: "${rule.first}" and "${rule.second}".`,
              `${rule.first} + ${rule.second}`,
            ),
          ]
        : [];
  }
}

/** Minimal violating text fixture for each text-level deterministic rule. */
export function buildPromptRuleMutation(rule: PromptVerificationRule, text: string): string {
  switch (rule.kind) {
    case 'non-empty':
      return '';
    case 'required-placeholder':
      return text.replaceAll(`{{${rule.name}}}`, '');
    case 'known-placeholder':
      return `${text}\n{{definitely_unknown_variable}}`;
    case 'required-tool':
      return text.replaceAll(rule.name, '');
    case 'required-output-literal':
      return text.replaceAll(rule.literal, '');
    case 'valid-rubric':
      return `${text}\n\n\`\`\`rubric\n{ "criteria": { "FIT": { "max": 5, "weight": 15 } } }\n\`\`\``;
    case 'identity-in-prompt':
      return `${text}\nBest regards,\nMaja Lind`;
    case 'minimum-length':
      return text.slice(0, Math.max(1, rule.minChars - 1));
    case 'forbidden-combination':
      return `${text}\n${rule.first}\n${rule.second}`;
    case 'valid-json-output':
    case 'cache-sensitive-dynamic':
      return text;
  }
}

/** Pure deterministic interpreter for section, blueprint, and consolidated verification profiles. */
export function runPromptVerificationProfile(
  profile: PromptVerificationProfile,
  text: string,
  options: PromptVerificationRunOptions = {},
): readonly PromptVerificationFinding[] {
  const nonEmptyFindings = profile.deterministicRules
    .filter((rule) => rule.kind === 'non-empty')
    .flatMap((rule) => evaluateRule(profile, rule, text, options));
  if (nonEmptyFindings.length > 0) return nonEmptyFindings;

  return profile.deterministicRules
    .filter((rule) => rule.kind !== 'non-empty')
    .flatMap((rule) => evaluateRule(profile, rule, text, options));
}

export function runLegacyVerificationProfile(
  promptKey: string,
  text: string,
  profile: PromptVerificationProfile = getLegacyStructureVerificationProfile(promptKey),
  options?: PromptVerificationRunOptions,
): readonly PromptVerificationFinding[] {
  return runPromptVerificationProfile(profile, text, options);
}

export function mapLegacySemanticVerification(
  profile: PromptVerificationProfile,
  editedText: string,
  verification: PromptVerification,
): readonly PromptVerificationFinding[] {
  return verification.findings.map((finding) => {
    const principle = profile.principles.find((candidate) => candidate.id === finding.category);
    if (!principle) throw new TypeError(`Legacy semantic finding has no profile principle: ${finding.category}`);
    if (!editedText.includes(finding.evidenceQuote)) {
      throw new TypeError(
        `Semantic finding evidence is not an exact quote from the edited prompt: ${finding.category}`,
      );
    }

    const mapped = {
      source: 'semantic' as const,
      profile: { id: profile.id, version: profile.version },
      principleId: principle.id,
      severity: principle.severity,
      message: finding.message,
      evidenceQuote: finding.evidenceQuote,
      proposedCorrection: finding.proposedCorrection,
    };
    if (profile.scope === 'section') {
      return { ...mapped, scope: 'section' as const, sectionId: profile.sectionId };
    }
    return { ...mapped, scope: profile.scope };
  });
}
