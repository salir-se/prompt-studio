import { maskPromptSourceLiterals } from './prompt-source-literals';

export interface PromptFileReference {
  readonly path: string;
  readonly loadBeforeBody: boolean;
}

/** Source dependencies only: recognition never reads files or executes a host's loading convention. */
export function extractPromptFileReferences(text: string): PromptFileReference[] {
  const source = maskPromptSourceLiterals(text);
  const references = new Map<string, PromptFileReference>();
  // Quoting supports spaces. Unquoted paths end at prose/Markdown delimiters.
  const pattern =
    /(^|[\s([{])(?:@(?:"([^"\n]+)"|'([^'\n]+)'|([^\s<>"'`()[\]{},;]+))|((?:[A-Za-z]:\\|[\w.-]+\\|\\\\)[^\s<>"'`()[\]{},;]+))|\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/gm;
  for (const match of source.matchAll(pattern)) {
    const explicit = match[2] ?? match[3] ?? match[4];
    const raw = explicit ?? match[5] ?? match[6];
    if (!raw) continue;
    const path = raw.replace(/[.!?:]+$/, '').replaceAll('\\', '/');
    if (
      !path ||
      path.startsWith('#') ||
      (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path) && !/^[A-Za-z]:\//.test(path) && !raw.startsWith('\\\\'))
    )
      continue;
    const loadBeforeBody = explicit !== undefined || references.get(path)?.loadBeforeBody === true;
    references.set(path, { path, loadBeforeBody });
  }
  return [...references.values()];
}
