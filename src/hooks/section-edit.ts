import type { PromptTreeNode } from '@prompt-studio/prompts';

/** The editable source body includes descendants, while the node's own text does not. */
export function sectionEditBody(
  source: string,
  section: PromptTreeNode,
): { start: number; end: number; text: string } | null {
  const end = section.range.end;
  const ownEnd = section.children[0]?.range.start ?? end;
  const start = ownEnd - section.text.length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    section.range.start < 0 ||
    start < section.range.start ||
    ownEnd > end ||
    end > source.length ||
    source.slice(start, ownEnd) !== section.text
  )
    return null;
  return { start, end, text: source.slice(start, end) };
}

/** Read and replace the same body range; keep the section's own delimiter/wrapper outside it. */
export function spliceSectionBody(source: string, section: PromptTreeNode, newBody: string): string | null {
  const range = sectionEditBody(source, section);
  if (!range) return null;
  const body = section.delimiter === 'xml-tag' && newBody !== '' && !newBody.endsWith('\n') ? `${newBody}\n` : newBody;
  return source.slice(0, range.start) + body + source.slice(range.end);
}
