import {
  createBlankPromptDesign,
  extractPlaceholderNames,
  extractPromptFileReferences,
  maskPromptSourceLiterals,
  parsePromptDesign,
  parsePromptTree,
  type PromptDesign,
  promptDesignSections,
} from '@prompt-studio/prompts';
import { initializeSectionMetadata } from '../design/section-metadata';
import { type ProjectDefinitions, validateProjectDefinitions } from '../prompt-repo/project-definitions';
import { safeAdoptionReferencePath } from '../prompt-repo/reference-path';
import { workspaceFileForDesign } from '../prompt-repo/workspace-document';

export interface AdoptionAttachment {
  path: string;
  text: string;
}
export interface AdoptionTool {
  name: string;
  description: string;
  schema: string;
}
export interface AdoptionExisting {
  id: string;
  title: string;
  design?: PromptDesign;
}

export function inspectAdoption(text: string, filename: string, ids: readonly string[], existing?: AdoptionExisting) {
  const name = /^name:\s*["']?([^\r\n"']+)/m.exec(text)?.[1]?.trim();
  const heading = /^#\s+(.+)$/m.exec(maskPromptSourceLiterals(text))?.[1]?.trim();
  const skill = /(?:^|\/)SKILL\.md$/i.test(filename) || /^\uFEFF?---\r?\n/.test(text);
  const title = existing?.title ?? name ?? heading ?? filename.replace(/\.[^.]+$/, '') ?? 'Imported prompt';
  const base =
    (name ?? heading ?? filename.replace(/\.[^.]+$/, ''))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'imported-prompt';
  let id = existing?.id ?? base;
  for (let suffix = 2; !existing && ids.includes(id); suffix++) id = `${base}-${suffix}`;
  const tree = parsePromptTree({ key: id, text, toolNames: existing?.design?.tools ?? [] });
  return {
    id,
    title,
    text,
    existing: existing?.design,
    path: existing ? filename : skill ? `skills/${id}/SKILL.md` : `prompts/${id}.md`,
    sections: promptDesignSections(tree.children),
    variables: [...new Set(extractPlaceholderNames(maskPromptSourceLiterals(text)))],
    references: extractPromptFileReferences(text),
    diagnostics: tree.diagnostics,
  };
}
export type AdoptionSource = ReturnType<typeof inspectAdoption>;
export interface AdoptionDraft {
  source: AdoptionSource;
  definitions: ProjectDefinitions;
  variables: Record<string, { purpose: string; sample: string }>;
  tools: readonly AdoptionTool[];
  input: string;
  output: string;
  workflow: string;
  attachments: readonly AdoptionAttachment[];
}

export function buildAdoption(draft: AdoptionDraft) {
  const { source } = draft;
  if (!source.text.trim()) throw new Error('Paste a prompt or choose a file.');
  if (/^\uFEFF?---\r?\n/.test(source.text) && !/^---\s*$/m.test(source.text.slice(source.text.indexOf('\n') + 1)))
    throw new Error('Close the skill frontmatter with a second --- line.');
  if (!draft.input.trim() || !draft.output.trim()) throw new Error('Describe both the input and output before saving.');
  if (!draft.workflow.trim()) throw new Error('Describe the workflow before saving.');
  const base = source.existing ?? createBlankPromptDesign({ id: source.id, title: source.title }).design;
  const variables = source.variables.map((name) => {
    const known =
      draft.definitions.variables.find((item) => item.name === name) ??
      base.variables.find((item) => item.name === name);
    if (known) return known;
    const entry = draft.variables[name];
    if (!entry?.purpose.trim()) throw new Error(`Describe the purpose of variable ${name}.`);
    return {
      name,
      purpose: entry.purpose.trim(),
      sample: entry.sample,
      required: true,
      lifecycle: 'runtime' as const,
      encoding: 'xml-text' as const,
      presentation: 'placeholder' as const,
    };
  });
  const tools = draft.tools
    .filter((tool) => tool.name.trim())
    .map((tool) => {
      const known = draft.definitions.tools.find((item) => item.name === tool.name.trim());
      if (known) return known;
      let inputSchema: unknown;
      try {
        inputSchema = JSON.parse(tool.schema);
      } catch {
        throw new Error(`Tool ${tool.name}: input schema must be valid JSON.`);
      }
      if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema))
        throw new Error(`Tool ${tool.name}: input schema must be a JSON object.`);
      if (!tool.description.trim()) throw new Error(`Describe tool ${tool.name}.`);
      return { name: tool.name.trim(), description: tool.description.trim(), inputSchema };
    });
  // Validate the prompt's selection before merging so duplicate new names cannot be hidden.
  validateProjectDefinitions({ ...draft.definitions, variables, tools });
  const definitions = validateProjectDefinitions({
    ...draft.definitions,
    variables: [
      ...draft.definitions.variables,
      ...variables.filter((entry) => !draft.definitions.variables.some((known) => known.name === entry.name)),
    ],
    tools: [
      ...draft.definitions.tools,
      ...tools.filter((entry) => !draft.definitions.tools.some((known) => known.name === entry.name)),
    ],
  });
  const design = initializeSectionMetadata(
    parsePromptDesign(
      JSON.stringify({
        ...base,
        title: source.title,
        maxDepth: Math.max(base.maxDepth, ...source.sections.map((node) => node.depth)),
        input: { ...base.input, description: draft.input.trim() },
        output: { ...base.output, description: draft.output.trim() },
        workflow: draft.workflow,
        variables: [
          ...base.variables.filter((entry) => !variables.some((item) => item.name === entry.name)),
          ...variables,
        ],
        tools: [...new Set([...base.tools, ...tools.map((entry) => entry.name)])],
      }),
    ),
    source.text,
  );
  const folder = source.path.slice(0, source.path.lastIndexOf('/'));
  const seen = new Set([source.path]);
  const attachments = draft.attachments.map((file) => {
    if (!safeAdoptionReferencePath(file.path))
      throw new Error(`Unsupported reference file: ${file.path}. Choose text references inside this folder.`);
    const path = `${folder}/${file.path}`;
    if (seen.has(path)) throw new Error(`Duplicate reference file: ${file.path}`);
    seen.add(path);
    return { path, text: file.text };
  });
  return {
    id: source.id,
    design,
    text: source.text,
    definitions,
    documents: [{ ...workspaceFileForDesign(design, source.text, 'Default'), path: source.path }, ...attachments],
  };
}
export type AdoptionResult = ReturnType<typeof buildAdoption>;
