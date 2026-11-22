import {
  insertChildSection,
  insertSiblingSectionAfter,
  type PromptTreeNode,
  parsePromptTree,
} from '@prompt-studio/prompts';

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

/** The section's OWN body (no delimiter, no sub-sections) — the range an agent's section edit replaces. */
export function sectionOwnBody(
  source: string,
  section: PromptTreeNode,
): { start: number; end: number; text: string } | null {
  const range = sectionEditBody(source, section);
  if (!range) return null;
  const end = section.children[0]?.range.start ?? section.range.end;
  return { start: range.start, end, text: source.slice(range.start, end) };
}

/**
 * Replaces only the section's own body. The heading/tags, the sub-sections and all other text stay byte-identical.
 * The original trailing line breaks are kept, so the next delimiter (a sub-section or a closing tag) still
 * starts on its own line.
 */
export function spliceSectionOwnBody(source: string, section: PromptTreeNode, newBody: string): string | null {
  const range = sectionOwnBody(source, section);
  if (!range) return null;
  const content = newBody.replace(/(?:\r?\n)+$/, '');
  let trailing = /(?:\r?\n)*$/.exec(range.text)?.[0] ?? '';
  if (trailing === '' && content !== '' && range.end < source.length)
    trailing = source.includes('\r\n') ? '\r\n' : '\n';
  return source.slice(0, range.start) + content + trailing + source.slice(range.end);
}

/** Depth-first lookup of a tree node by id. */
export function findSectionNode(nodes: readonly PromptTreeNode[], id: string): PromptTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findSectionNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function sectionIds(nodes: readonly PromptTreeNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    into.add(node.id);
    sectionIds(node.children, into);
  }
  return into;
}

/**
 * Inserts a section named `name` after `anchor` (a sibling) or as its first sub-section, optionally with `body`
 * instead of the placeholder line. Returns the new text and the new section's id, or null when the new section
 * cannot be located in the re-parsed text.
 */
export function insertSectionText(
  source: string,
  key: string,
  anchor: PromptTreeNode,
  position: 'after' | 'firstChild',
  name: string,
  body?: string,
): { text: string; sectionId: string } | null {
  const before = sectionIds(parsePromptTree({ key, text: source, toolNames: [] }).children);
  const inserted =
    position === 'after' ? insertSiblingSectionAfter(source, anchor, name) : insertChildSection(source, anchor, name);
  const parsed = parsePromptTree({ key, text: inserted, toolNames: [] }).children;
  const added = [...sectionIds(parsed)].filter((id) => !before.has(id));
  const created = added.length === 1 ? findSectionNode(parsed, added[0]) : (findTaggedSection(parsed, name) ?? null);
  if (!created) return null;
  if (body === undefined) return { text: inserted, sectionId: created.id };
  const text = spliceSectionOwnBody(inserted, created, body);
  return text === null ? null : { text, sectionId: created.id };
}

function findTaggedSection(nodes: readonly PromptTreeNode[], tag: string): PromptTreeNode | undefined {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const found = findTaggedSection(node.children, tag);
    if (found) return found;
  }
  return undefined;
}
