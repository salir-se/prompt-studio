import {
  createBlankPromptDesign,
  parsePromptDesign,
  type PromptDesign,
  type PromptRootRequestField,
} from '@prompt-studio/prompts';
import { initializeSectionMetadata } from '../design/section-metadata';
import type { ProjectVariable } from './project-definitions';

/**
 * The design the editor loads and the git file are produced together.
 * A second open reads that file back into the same design.
 */

const MARKER = '<!-- prompt-studio-design:';

export interface WorkspacePrompt {
  readonly design: PromptDesign;
  readonly text: string;
  readonly configuration: string;
  readonly document: { readonly path: string; readonly text: string };
}

export function createWorkspacePrompt(input: {
  readonly id: string;
  readonly title: string;
  readonly requestField?: PromptRootRequestField;
  readonly configuration: string;
  readonly tool: string;
  readonly variable: string;
  readonly variableDefinition?: ProjectVariable;
}): WorkspacePrompt {
  const blank = createBlankPromptDesign({
    id: input.id,
    title: input.title,
    requestField: input.requestField,
  });
  const configuration = input.configuration.trim();
  const tool = input.tool.trim();
  const variable = input.variable.trim();
  const design = parsePromptDesign(
    JSON.stringify({
      ...blank.design,
      tools: tool.length > 0 ? [tool] : [],
      variables: [
        ...(variable.length > 0
          ? [
              input.variableDefinition ?? {
                name: variable,
                purpose: `Value supplied for ${variable}.`,
                sample: '',
                required: true,
                lifecycle: 'runtime',
                encoding: 'xml-text',
                presentation: 'placeholder',
              },
            ]
          : []),
        ...(configuration.length > 0
          ? [
              {
                name: 'configuration',
                purpose: 'Active configuration for this prompt.',
                sample: configuration,
                required: true,
                lifecycle: 'configuration',
                encoding: 'xml-text',
                presentation: 'resolved',
              },
            ]
          : []),
      ],
    }),
  );
  return {
    design,
    text: blank.text,
    configuration,
    document: workspaceFileForDesign(design, blank.text, configuration),
  };
}

export function workspaceFileForDesign(
  design: PromptDesign,
  text: string,
  configuration: string,
): { readonly path: string; readonly text: string } {
  return {
    path: `prompts/${design.id}.md`,
    text: encodeWorkspaceFile(text, initializeSectionMetadata(design, text), configuration),
  };
}

export function readWorkspacePrompt(fileText: string): Omit<WorkspacePrompt, 'document'> | null {
  const start = fileText.indexOf(MARKER);
  if (start < 0) return null;
  const end = fileText.indexOf('-->', start);
  if (end < 0) return null;
  const encoded = fileText.slice(start + MARKER.length, end).trim();
  try {
    const payload = JSON.parse(decodeBase64(encoded)) as { design?: unknown; configuration?: unknown };
    if (typeof payload.configuration !== 'string') return null;
    const design = parsePromptDesign(JSON.stringify(payload.design));
    return { design, text: fileText.slice(0, start), configuration: payload.configuration };
  } catch {
    return null;
  }
}

function encodeWorkspaceFile(text: string, design: PromptDesign, configuration: string): string {
  const encoded = encodeBase64(JSON.stringify({ design, configuration }));
  return `${text}${MARKER}${encoded}-->\n`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Retain the open document's location, including a skill entrypoint. */
export function workspaceFileForRoot(
  root: { id: string; design?: PromptDesign },
  text: string,
  existing?: { path: string; text: string },
): { readonly path: string; readonly text: string } {
  const configuration = existing ? (readWorkspacePrompt(existing.text)?.configuration ?? 'Default') : 'Default';
  const file = root.design
    ? workspaceFileForDesign(root.design, text, configuration)
    : { path: `prompts/${root.id}.md`, text };
  return { ...file, path: existing?.path ?? file.path };
}
