import {
  extractPlaceholderNames,
  type PromptOutputContract,
  type PromptVerificationProfile,
  type PromptVerificationRule,
  tokenizePromptText,
} from '@prompt-studio/prompts';

type PresetDetails = { id: string; label: string; description: string };
export type VerificationPreset = PresetDetails &
  ({ rules: readonly PromptVerificationRule[] } | { kind: PromptVerificationRule['kind'] });
export interface VerificationPresetContext {
  text: string;
  knownVariables: readonly string[];
  toolNames: readonly string[];
  outputContract?: PromptOutputContract;
  selectedText?: string;
}

function ruleMeaning(rule: PromptVerificationRule): string {
  switch (rule.kind) {
    case 'required-placeholder':
    case 'required-tool':
      return JSON.stringify([rule.kind, rule.name]);
    case 'required-output-literal':
      return JSON.stringify([rule.kind, rule.literal]);
    case 'known-placeholder':
      return JSON.stringify([rule.kind, [...new Set(rule.allowedNames)].sort()]);
    case 'forbidden-combination':
      return JSON.stringify([rule.kind, ...[rule.first, rule.second].sort()]);
    case 'minimum-length':
      return JSON.stringify([rule.kind, rule.minChars]);
    default:
      return rule.kind;
  }
}

/** Suggestions describe authored requirements; none modify the prompt or run an LLM. */
export function verificationPresets(
  context: VerificationPresetContext,
  existingRules: readonly PromptVerificationRule[] = [],
): VerificationPreset[] {
  const existing = new Set(existingRules.map(ruleMeaning));
  const presets: VerificationPreset[] = [];
  function suggest(details: PresetDetails, rule: PromptVerificationRule) {
    if (!existing.has(ruleMeaning(rule))) presets.push({ ...details, rules: [rule] });
  }
  const edit = { severity: 'error', enforcement: 'edit' } as const;
  suggest(
    { id: 'non-empty', label: 'Contains instructions', description: 'Prevent an empty prompt or section.' },
    { id: 'non-empty', kind: 'non-empty', ...edit },
  );
  for (const name of extractPlaceholderNames(context.text)) {
    suggest(
      {
        id: `required-placeholder:${name}`,
        label: `Keep {{${name}}}`,
        description: 'Flag future edits that remove this variable from the instructions.',
      },
      { id: `required-placeholder:${name}`, kind: 'required-placeholder', name, ...edit },
    );
  }
  if (context.knownVariables.length && !existingRules.some((rule) => rule.kind === 'known-placeholder')) {
    suggest(
      {
        id: 'known-placeholder',
        label: 'Known variables only',
        description: 'Check variable names against the configured list; detected unknown names remain unknown.',
      },
      {
        id: 'known-placeholder',
        kind: 'known-placeholder',
        allowedNames: [...new Set(context.knownVariables)],
        ...edit,
        severity: 'warning',
      },
    );
  }
  const mentionedTools = new Set(
    tokenizePromptText(context.text, { variables: [...context.knownVariables], tools: [...context.toolNames] })
      .filter((token) => token.kind === 'tool')
      .map((token) => token.name!),
  );
  for (const name of mentionedTools) {
    suggest(
      {
        id: `required-tool:${name}`,
        label: `Keep tool ${name}`,
        description: 'Keep the existing instruction to use this tool.',
      },
      { id: `required-tool:${name}`, kind: 'required-tool', name, ...edit, severity: 'warning' },
    );
  }
  if (context.selectedText?.trim() && context.text.includes(context.selectedText)) {
    suggest(
      {
        id: 'selected-text',
        label: 'Keep selected text',
        description: 'Require this exact phrase in the prompt instructions.',
      },
      { id: 'required-selected-text', kind: 'required-output-literal', literal: context.selectedText, ...edit },
    );
  }
  if (context.outputContract?.kind === 'json' && context.outputContract.jsonSchema) {
    suggest(
      {
        id: 'valid-json-output',
        label: 'Validate JSON contract examples',
        description:
          'Validate saved output examples against the authored JSON Schema. This does not test generated model output.',
      },
      { id: 'valid-json-output', kind: 'valid-json-output', ...edit },
    );
  }
  return [
    ...presets,
    {
      id: 'required-text',
      label: 'Required text',
      description: 'Choose a phrase that must remain in these instructions.',
      kind: 'required-output-literal',
    },
    {
      id: 'forbidden-combination',
      label: 'Conflicting instructions',
      description: 'Choose two instructions that must not appear together.',
      kind: 'forbidden-combination',
    },
    {
      id: 'minimum-length',
      label: 'Minimum length',
      description: 'Choose the minimum number of characters for these instructions.',
      kind: 'minimum-length',
    },
  ];
}

/** Safe to preview and repeat: existing checks and protected criteria keep their identities. */
export function appendVerificationRules(
  profile: PromptVerificationProfile,
  rules: readonly PromptVerificationRule[],
): PromptVerificationProfile {
  const meanings = new Set(profile.deterministicRules.map(ruleMeaning));
  const ids = new Set(profile.deterministicRules.map((rule) => rule.id));
  const added: PromptVerificationRule[] = [];
  for (const rule of rules) {
    const meaning = ruleMeaning(rule);
    if (meanings.has(meaning)) continue;
    let id = rule.id;
    let suffix = 2;
    while (ids.has(id)) id = `${rule.id}-${suffix++}`;
    added.push(id === rule.id ? rule : { ...rule, id });
    ids.add(id);
    meanings.add(meaning);
  }
  return added.length ? { ...profile, deterministicRules: [...profile.deterministicRules, ...added] } : profile;
}

export function recommendedVerificationRules(
  context: VerificationPresetContext,
  existingRules: readonly PromptVerificationRule[] = [],
): readonly PromptVerificationRule[] {
  return verificationPresets(context, existingRules).flatMap((preset) => ('rules' in preset ? preset.rules : []));
}
