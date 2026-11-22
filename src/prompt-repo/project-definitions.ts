import { PROMPT_PLACEHOLDER_RE, type PromptDesign } from '@prompt-studio/prompts';
import { type } from 'arktype';

export type ProjectVariable = PromptDesign['variables'][number];
export interface ProjectTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}
export interface ProjectDefinitions {
  readonly format: 'prompt-studio-project@1';
  readonly name: string;
  readonly variables: readonly ProjectVariable[];
  readonly tools: readonly ProjectTool[];
}
const variable = type({
  name: 'string > 0',
  purpose: 'string > 0',
  sample: 'string',
  required: 'boolean',
  lifecycle: "'configuration' | 'runtime' | 'server-only'",
  encoding: "'xml-text' | 'json'",
  presentation: "'placeholder' | 'resolved' | 'redacted'",
  '+': 'reject',
});
const tool = type({
  name: 'string > 0',
  description: 'string > 0',
  inputSchema: { '[string]': 'unknown' },
  '+': 'reject',
});
const project = type({
  format: "'prompt-studio-project@1'",
  name: 'string > 0',
  variables: variable.array(),
  tools: tool.array(),
  '+': 'reject',
});

export function emptyProjectDefinitions(name: string): ProjectDefinitions {
  return { format: 'prompt-studio-project@1', name, variables: [], tools: [] };
}
export function validateProjectDefinitions(input: unknown): ProjectDefinitions {
  const parsed = project(input);
  if (parsed instanceof type.errors)
    throw new Error('Invalid project definitions. Check required fields, names, and tool schemas.');
  for (const [kind, entries] of [
    ['variable', parsed.variables],
    ['tool', parsed.tools],
  ] as const) {
    const names = new Set<string>();
    for (const entry of entries) {
      if (
        !(kind === 'variable'
          ? new RegExp(`^(?:${PROMPT_PLACEHOLDER_RE.source})$`).test(`{{${entry.name}}}`)
          : /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(entry.name))
      )
        throw new Error(`Invalid ${kind} name: ${entry.name}`);
      if (names.has(entry.name)) throw new Error(`Duplicate ${kind}: ${entry.name}`);
      names.add(entry.name);
    }
  }
  for (const entry of parsed.tools) {
    if (Array.isArray(entry.inputSchema) || entry.inputSchema === null)
      throw new Error(`Tool ${entry.name} input schema must be a JSON object.`);
  }
  for (const entry of parsed.variables) {
    if ((entry.lifecycle === 'server-only' || entry.presentation === 'redacted') && entry.sample !== '') {
      throw new Error(`Remove the sample value from secret variable ${entry.name} before saving or exporting.`);
    }
  }
  return parsed;
}
