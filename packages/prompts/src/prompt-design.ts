import { lazyType } from '@prompt-studio/types/lazy-type';
import { type } from 'arktype';
import type { PromptRootRequestField } from './composition-contracts';
import { promptDesignSections, promptSectionId } from './prompt-design-sections';
import type { JsonValue, PromptInputContract, PromptOutputContract } from './structure-contracts';
import { verifyStructuredJsonInput, verifyStructuredJsonOutputExamples } from './structured-output';
import { parsePromptTree } from './tree/parse-tree';
import { type PromptVerificationProfile, PromptVerificationProfileSchema } from './verification-contracts';
import { runPromptVerificationProfile } from './verification-profiles';

export const PROMPT_DESIGN_FORMAT = 'salir-prompt-design@1' as const;
export const PROMPT_WORKFLOW_TEMPLATE = `flowchart LR
  input["Input"] --> prompt["Prompt"] --> output["Output"]`;

export interface PromptSectionDesign {
  readonly sectionId: string;
  readonly input: PromptInputContract;
  readonly workflow: string;
  readonly output: PromptOutputContract;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJsonValue);
}

const JsonValueSchema = lazyType(() =>
  type('unknown').narrow(
    (value, context) => isJsonValue(value) || context.reject({ expected: 'JSON-serializable data', actual: '' }),
  ),
);
const JsonObjectSchema = lazyType(() =>
  JsonValueSchema.narrow(
    (value, context) =>
      (typeof value === 'object' && value !== null && !Array.isArray(value)) ||
      context.reject({ expected: 'a JSON object', actual: '' }),
  ),
);

const FreeTextInputSchema = lazyType(() => type({ kind: "'free-text'", description: 'string > 0', '+': 'reject' }));
const JsonInputSchema = lazyType(() =>
  type({
    kind: "'json'",
    description: 'string > 0',
    jsonSchema: JsonObjectSchema,
    examples: JsonValueSchema.array(),
    '+': 'reject',
  }),
);
export const PromptInputContractSchema = lazyType(() => FreeTextInputSchema.or(JsonInputSchema));

const outputFields = {
  description: 'string > 0',
  'requiredMentions?': 'string[]',
} as const;
const FreeformOutputSchema = lazyType(() => type({ ...outputFields, kind: "'freeform'", '+': 'reject' }));
const ToolCallOutputSchema = lazyType(() =>
  type({
    ...outputFields,
    kind: "'tool-call'",
    requiredToolName: 'string > 0',
    '+': 'reject',
  }),
);
const JsonOutputSchema = lazyType(() =>
  type({
    ...outputFields,
    kind: "'json'",
    jsonSchema: JsonObjectSchema,
    examples: JsonValueSchema.array(),
    '+': 'reject',
  }),
);
export const AuthoredPromptOutputContractSchema = lazyType(() =>
  FreeformOutputSchema.or(ToolCallOutputSchema).or(JsonOutputSchema),
);

export const PromptSectionDesignSchema = lazyType(() =>
  type({
    sectionId: 'string > 0',
    input: PromptInputContractSchema,
    workflow: 'string',
    output: AuthoredPromptOutputContractSchema,
    '+': 'reject',
  }),
);

const AuthoredVariableSchema = lazyType(() =>
  type({
    name: 'string > 0',
    purpose: 'string > 0',
    sample: 'string',
    required: 'boolean',
    lifecycle: "'configuration' | 'runtime' | 'server-only'",
    encoding: "'xml-text' | 'json'",
    presentation: "'placeholder' | 'resolved' | 'redacted'",
    '+': 'reject',
  }),
);

export const PromptDesignSchema = lazyType(() =>
  type({
    format: `'${PROMPT_DESIGN_FORMAT}'`,
    id: 'string > 0',
    title: 'string > 0',
    version: 'number.integer >= 1',
    requestField: "'systemPrompt' | 'userMessage'",
    maxDepth: 'number.integer >= 1',
    input: PromptInputContractSchema,
    tools: 'string[]',
    workflow: 'string',
    sectionDesigns: PromptSectionDesignSchema.array(),
    output: AuthoredPromptOutputContractSchema,
    variables: AuthoredVariableSchema.array(),
    verificationProfiles: PromptVerificationProfileSchema.array(),
    '+': 'reject',
  }),
);

type InferredPromptDesign = typeof PromptDesignSchema.infer;
export type PromptDesign = Readonly<
  Omit<InferredPromptDesign, 'input' | 'output' | 'sectionDesigns' | 'verificationProfiles'> & {
    readonly input: PromptInputContract;
    readonly output: PromptOutputContract;
    readonly sectionDesigns: readonly PromptSectionDesign[];
    readonly verificationProfiles: readonly PromptVerificationProfile[];
  }
>;

export interface PromptDesignIssue {
  readonly code:
    | 'duplicate-profile-id'
    | 'duplicate-section-design'
    | 'duplicate-variable-name'
    | 'deterministic-verification-failed'
    | 'input-example-invalid'
    | 'platform-principle-not-editable'
    | 'missing-section-profile'
    | 'missing-section-design'
    | 'output-example-invalid'
    | 'profile-dependency-cycle'
    | 'profile-dependency-not-found'
    | 'profile-section-not-found'
    | 'section-design-not-found';
  readonly message: string;
  readonly subject?: string;
}

export interface CreateBlankPromptDesignInput {
  readonly id: string;
  readonly title: string;
  readonly requestField?: PromptRootRequestField;
}

export function createBlankPromptDesign(input: CreateBlankPromptDesignInput): {
  readonly design: PromptDesign;
  readonly text: string;
} {
  const sectionId = `${input.id}.mission`;
  return {
    text: `## Mission\n\n<mission>\nDescribe this prompt's primary responsibility.\n</mission>\n`,
    design: {
      format: PROMPT_DESIGN_FORMAT,
      id: input.id,
      title: input.title,
      version: 1,
      requestField: input.requestField ?? 'systemPrompt',
      maxDepth: 3,
      input: { kind: 'free-text', description: 'Free-text user request.' },
      tools: [],
      workflow: PROMPT_WORKFLOW_TEMPLATE,
      sectionDesigns: [
        {
          sectionId,
          input: { kind: 'free-text', description: 'Content and context entering this section.' },
          workflow: PROMPT_WORKFLOW_TEMPLATE,
          output: { kind: 'freeform', description: 'Instructions produced by this section.' },
        },
      ],
      output: { kind: 'freeform', description: 'Free-text response.' },
      variables: [],
      verificationProfiles: [
        {
          id: `${sectionId}.verification`,
          version: 1,
          scope: 'section',
          sectionId,
          deterministicRules: [{ id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
          principles: [],
        },
        {
          id: `${input.id}.consolidated.verification`,
          version: 1,
          scope: 'consolidated',
          deterministicRules: [{ id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
          principles: [],
          dependsOn: [`${sectionId}.verification`],
        },
      ],
    },
  };
}

export function parsePromptDesign(text: string): PromptDesign {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('Prompt design is not valid JSON.');
  }
  const parsed = PromptDesignSchema(value);
  if (parsed instanceof type.errors) throw new TypeError(`Prompt design is invalid: ${parsed.summary}`);
  return parsed as PromptDesign;
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function cycleMembers(nodes: readonly { id: string; dependencies: readonly string[] }[]): readonly string[] {
  const dependencies = new Map(nodes.map((node) => [node.id, node.dependencies]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) {
      cycles.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency)) visit(dependency);
      if (cycles.has(dependency)) cycles.add(id);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of dependencies.keys()) visit(id);
  return [...cycles].sort();
}

export function validatePromptDesign(design: PromptDesign, text: string): readonly PromptDesignIssue[] {
  const issues: PromptDesignIssue[] = [];
  const tree = parsePromptTree({ key: design.id, text, toolNames: design.tools });
  const sections = promptDesignSections(tree.children);
  const sectionIds = new Set(sections.map((section) => promptSectionId(design.id, section)));
  const profilesById = new Map(design.verificationProfiles.map((profile) => [profile.id, profile]));

  for (const id of duplicates(design.verificationProfiles.map((profile) => profile.id))) {
    issues.push({ code: 'duplicate-profile-id', subject: id, message: `Verification profile ${id} is duplicated.` });
  }
  for (const name of duplicates(design.variables.map((variable) => variable.name))) {
    issues.push({ code: 'duplicate-variable-name', subject: name, message: `Variable ${name} is duplicated.` });
  }
  for (const sectionId of sectionIds) {
    if (!design.sectionDesigns.some((sectionDesign) => sectionDesign.sectionId === sectionId)) {
      issues.push({
        code: 'missing-section-design',
        subject: sectionId,
        message: `Section ${sectionId} has no sub-prompt design.`,
      });
    }
    if (
      !design.verificationProfiles.some((profile) => profile.scope === 'section' && profile.sectionId === sectionId)
    ) {
      issues.push({
        code: 'missing-section-profile',
        subject: sectionId,
        message: `Section ${sectionId} has no verification profile.`,
      });
    }
  }
  for (const profile of design.verificationProfiles) {
    if (profile.scope === 'section' && !sectionIds.has(profile.sectionId)) {
      issues.push({
        code: 'profile-section-not-found',
        subject: profile.id,
        message: `Profile ${profile.id} refers to missing section ${profile.sectionId}.`,
      });
    }
    for (const dependency of profile.dependsOn ?? []) {
      if (!profilesById.has(dependency)) {
        issues.push({
          code: 'profile-dependency-not-found',
          subject: profile.id,
          message: `Profile ${profile.id} depends on missing profile ${dependency}.`,
        });
      }
    }
    for (const principle of profile.principles) {
      if (principle.owner === 'platform') {
        issues.push({
          code: 'platform-principle-not-editable',
          subject: principle.id,
          message: `Platform principle ${principle.id} is read-only and cannot be authored in a project prompt.`,
        });
      }
    }
  }
  for (const profileId of cycleMembers(
    design.verificationProfiles.map((profile) => ({ id: profile.id, dependencies: profile.dependsOn ?? [] })),
  )) {
    issues.push({
      code: 'profile-dependency-cycle',
      subject: profileId,
      message: `Profile dependency cycle includes ${profileId}.`,
    });
  }

  for (const sectionId of duplicates(design.sectionDesigns.map((sectionDesign) => sectionDesign.sectionId))) {
    issues.push({
      code: 'duplicate-section-design',
      subject: sectionId,
      message: `Section ${sectionId} has more than one sub-prompt design.`,
    });
  }
  for (const sectionDesign of design.sectionDesigns) {
    if (!sectionIds.has(sectionDesign.sectionId)) {
      issues.push({
        code: 'section-design-not-found',
        subject: sectionDesign.sectionId,
        message: `Sub-prompt design refers to missing section ${sectionDesign.sectionId}.`,
      });
    }
  }

  for (const contract of [
    { subject: undefined, input: design.input, output: design.output },
    ...design.sectionDesigns.map((section) => ({
      subject: section.sectionId,
      input: section.input,
      output: section.output,
    })),
  ]) {
    const prefix = contract.subject ? `${contract.subject}: ` : '';
    if (contract.input.kind === 'json') {
      if (contract.input.examples.length === 0) {
        issues.push({
          code: 'input-example-invalid',
          subject: contract.subject,
          message: `${prefix}Structured JSON input needs at least one valid example.`,
        });
      }
      contract.input.examples.forEach((example, index) => {
        const result = verifyStructuredJsonInput(contract.input, JSON.stringify(example));
        if (!result.valid) {
          issues.push({
            code: 'input-example-invalid',
            subject: contract.subject ?? String(index),
            message: `${prefix}Input example ${index + 1}: ${result.errors.join(' ')}`,
          });
        }
      });
    }
    if (contract.output.kind === 'json') {
      for (const failure of verifyStructuredJsonOutputExamples(contract.output)) {
        issues.push({
          code: 'output-example-invalid',
          subject: contract.subject ?? String(failure.exampleIndex),
          message: `${prefix}Output example ${failure.exampleIndex + 1}: ${failure.errors.join(' ')}`,
        });
      }
    }
  }

  for (const profile of design.verificationProfiles) {
    const section =
      profile.scope === 'section'
        ? sections.find((candidate) => promptSectionId(design.id, candidate) === profile.sectionId)
        : undefined;
    for (const finding of runPromptVerificationProfile(profile, section?.text ?? text, {
      toolNames: design.tools,
      outputContract: design.output,
    })) {
      if (finding.source !== 'deterministic') continue;
      issues.push({
        code: 'deterministic-verification-failed',
        subject: finding.ruleId,
        message: `${profile.id}: ${finding.message}`,
      });
    }
  }
  return issues;
}
