import { type ProjectDefinitions, validateProjectDefinitions } from './project-definitions';

export type DefinitionKind = 'variables' | 'tools';
export type DefinitionImport = Pick<ProjectDefinitions, 'variables' | 'tools'>;

/** Validate the complete upload before offering to mutate the current project. */
export function readDefinitionImport(
  text: string,
  kind: DefinitionKind,
  project: ProjectDefinitions,
): DefinitionImport {
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('format' in value) ||
    value.format !== `prompt-studio-${kind}@1` ||
    Object.keys(value).length !== 2 ||
    !(kind in value)
  ) {
    throw new Error(`Choose a Prompt Studio ${kind} JSON export.`);
  }
  const validated = validateProjectDefinitions({ ...project, [kind]: (value as Record<string, unknown>)[kind] });
  return { variables: kind === 'variables' ? validated.variables : [], tools: kind === 'tools' ? validated.tools : [] };
}

export function mergeDefinitionImport(
  project: ProjectDefinitions,
  imported: DefinitionImport,
  kind: DefinitionKind,
  replace: boolean,
): ProjectDefinitions {
  const entries = new Map(project[kind].map((entry) => [entry.name, entry]));
  for (const entry of imported[kind]) if (replace || !entries.has(entry.name)) entries.set(entry.name, entry);
  return validateProjectDefinitions({ ...project, [kind]: [...entries.values()] });
}

export function exportDefinitions(project: ProjectDefinitions, kind: DefinitionKind): string {
  const validated = validateProjectDefinitions(project);
  return `${JSON.stringify({ format: `prompt-studio-${kind}@1`, [kind]: validated[kind] }, null, 2)}\n`;
}
