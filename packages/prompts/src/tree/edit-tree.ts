/**
 * Pure text-edit operations over a parsed `PromptTree` (ADR-200 / ADR-202).
 *
 * ADR-202 §3 is the contract this module exists to uphold: **section markdown
 * is the source of truth; the graph is a projection; every graph interaction
 * is implemented as a text edit.** Each helper here takes the CURRENT document
 * string plus nodes from the CURRENT parse of that same string, and returns a
 * NEW document string — it never mutates a tree, never persists anything, and
 * never invents a second model that could disagree with the text. The caller
 * re-parses the returned text and the graph follows.
 *
 * Ranges: `PromptTreeNode.range` spans delimiter + body + nested children
 * (see `types.ts`) — with one parser subtlety every splice here must respect:
 * for an `xml-tag` node the frame closes AT THE START of its `</tag>` line
 * (`closeFrame(top, line.start)` in `parse-tree.ts`), so `range.end` EXCLUDES
 * the closing tag itself. `fullExtent` below is the one place that widens an
 * xml extent through its closing line; every remove/move/insert-after
 * operation goes through it so a subtree operation never strands a `</tag>`.
 *
 * New sections use the `xml-tag` dialect (`<name>…</name>`): per ADR-200/202
 * it is the one delimiter with an explicit, machine-checkable extent and a
 * stable tag identity, which is why declaring a tag *creates* the node
 * (ADR-202 §3) and why editors align sections by stable tag.
 *
 * Staleness: every helper trusts the node ranges it is handed. Callers MUST
 * pass nodes from a parse of the very `docText` argument (the studio derives
 * both from one memo), never ranges saved across an edit.
 */

import type { PromptTree, PromptTreeNode } from './types';

/** Where `sectionId` sits among its siblings — the parse-order context reorder/insert need. */
export interface SectionLocation {
  /** The section itself. */
  node: PromptTreeNode;
  /** `null` for a top-level section (its siblings are `tree.children`). */
  parent: PromptTreeNode | null;
  /** The sibling list containing `node`, in parse (document) order. */
  siblings: readonly PromptTreeNode[];
  /** `node`'s index within `siblings`. */
  index: number;
}

/** Depth-first search for `sectionId`, tracking the parent/sibling context it was found in. */
export function locateSection(tree: PromptTree, sectionId: string): SectionLocation | null {
  function walk(siblings: readonly PromptTreeNode[], parent: PromptTreeNode | null): SectionLocation | null {
    for (let index = 0; index < siblings.length; index++) {
      const node = siblings[index];
      if (node.id === sectionId) return { node, parent, siblings, index };
      const found = walk(node.children, node);
      if (found) return found;
    }
    return null;
  }
  return walk(tree.children, null);
}

/**
 * A tag name not already used by any tag occurrence in the tree — `base`
 * itself when free, else `base_2`, `base_3`, … . Checks
 * `tree.tagClassifications` (every tag occurrence the parser saw, section or
 * not) rather than just section nodes, so a proposed name never collides with
 * an inline emphasis/placeholder tag either.
 */
export function uniqueSectionTagName(tree: PromptTree, base = 'new_section'): string {
  const taken = new Set(tree.tagClassifications.map((classification) => classification.name));
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

/** The inserted skeleton for a new `<name>` section — one placeholder line the author replaces. */
export function xmlSectionStub(name: string): string {
  return `<${name}>\nDescribe this section.\n</${name}>`;
}

/** Placeholder body line shared by every stub dialect below. */
const STUB_BODY = 'Describe this section.';

/**
 * The skeleton for a new SIBLING of `section`, spelled in whichever dialect
 * can actually express "sibling" at that spot in the grammar:
 *
 * - `xml-tag` target → an xml stub (`xmlSectionStub`) — the ADR-200/202
 *   preferred dialect, and after an xml extent the enclosing frame is the
 *   target's own parent, so the stub lands as a true sibling.
 * - `caps-label`/`atx-heading` target → the TARGET'S OWN dialect. This is a
 *   grammar constraint, not a style choice: a caps/atx frame stays open until
 *   the next same-dialect delimiter, and an xml tag NEVER pops it
 *   (`popNonXmlDeeperOrEqual` skips xml, and an xml open always nests under
 *   the current frame) — so an xml stub placed after a caps section's extent
 *   would parse as its CHILD. Only a same-dialect heading closes the frame
 *   and opens a sibling: depth-1 caps targets get a `NAME:` line, deeper
 *   caps targets (numbered sub-labels) get an `N. NAME:` line, and atx
 *   targets get a heading with the same `#` marker count read verbatim from
 *   the target's own delimiter line in `docText`.
 */
export function siblingSectionStub(docText: string, section: PromptTreeNode, name: string): string {
  if (section.delimiter === 'xml-tag') return xmlSectionStub(name);

  if (section.delimiter === 'atx-heading') {
    const markers = /^(#{1,6}) /.exec(docText.slice(section.range.start, section.range.start + 8));
    const hashes = markers ? markers[1] : '#'.repeat(Math.min(section.depth, 6));
    return `${hashes} ${name}\n${STUB_BODY}`;
  }

  const capsName = name.replace(/_/g, ' ').toUpperCase();
  // Depth > 1 caps-label nodes are numbered sub-labels (`N. NAME:`) — the numeral's value is not
  // semantic to the parser, so a constant works, but matching the convention keeps the text human.
  if (section.depth > 1) return `9. ${capsName}:\n${STUB_BODY}`;
  return `${capsName}:\n${STUB_BODY}`;
}

/**
 * The character span a subtree OPERATION should act on: `range` as-is for
 * caps/atx nodes, and `range` widened through the end of the `</tag>` closing
 * line for `xml-tag` nodes (see the module doc — the parser's `range.end` for
 * xml stops at the closing line's start). The trailing newline stays outside
 * the extent, so separators between sections survive removes and swaps.
 */
export function fullExtent(docText: string, node: PromptTreeNode): { start: number; end: number } {
  if (node.delimiter !== 'xml-tag') return { start: node.range.start, end: node.range.end };
  const lineBreak = docText.indexOf('\n', node.range.end);
  return { start: node.range.start, end: lineBreak === -1 ? docText.length : lineBreak };
}

/**
 * Caps the newline run that crosses `seamIndex` to at most `\n\n` (one blank
 * line). Every splice below joins/removes text at one or two seams; without
 * this, a removal between two blank-line-separated sections leaves a
 * three-newline run, and repeated add/remove cycles accrete whitespace. Only
 * the seam run is touched — intentional blank lines elsewhere are preserved
 * byte-for-byte.
 */
function capSeamNewlines(text: string, seamIndex: number): string {
  let runStart = seamIndex;
  while (runStart > 0 && text[runStart - 1] === '\n') runStart--;
  let runEnd = seamIndex;
  while (runEnd < text.length && text[runEnd] === '\n') runEnd++;
  const runLength = runEnd - runStart;
  if (runLength <= 2) return text;
  return `${text.slice(0, runStart)}\n\n${text.slice(runEnd)}`;
}

/**
 * Removes `section`'s full extent (delimiter + body + children) from
 * `docText`, capping the leftover seam to one blank line.
 */
export function removeSectionText(docText: string, section: PromptTreeNode): string {
  const extent = fullExtent(docText, section);
  const joined = docText.slice(0, extent.start) + docText.slice(extent.end);
  return capSeamNewlines(joined, extent.start);
}

/**
 * Inserts a new section immediately AFTER `section`'s full extent, as its
 * sibling — spelled in whichever dialect the grammar requires at that spot
 * (see `siblingSectionStub`). Returns the new document text.
 */
export function insertSiblingSectionAfter(docText: string, section: PromptTreeNode, name: string): string {
  const insertAt = fullExtent(docText, section).end;
  const inserted = `\n\n${siblingSectionStub(docText, section, name)}\n\n`;
  const next = docText.slice(0, insertAt) + inserted + docText.slice(insertAt);
  // Two seams: where the stub's leading gap meets the existing text, and where its trailing gap does.
  return capSeamNewlines(capSeamNewlines(next, insertAt + inserted.length), insertAt);
}

/**
 * End offset of `node`'s OWN body (delimiter + `text`, before any children)
 * within `docText`. The parser guarantees `text` occurs verbatim inside
 * `range` (the same invariant the studio's `spliceSectionBody` relies on);
 * an empty body falls back to the end of the delimiter line itself.
 */
function bodyEndOffset(docText: string, node: PromptTreeNode): number {
  const bodyStart = docText.indexOf('\n', node.range.start);
  if (node.text.length > 0 && bodyStart !== -1 && bodyStart < node.range.end) {
    const offsetInRange = docText
      .slice(node.range.start, node.range.end)
      .indexOf(node.text, bodyStart - node.range.start + 1);
    if (offsetInRange !== -1) return node.range.start + offsetInRange + node.text.length;
  }
  const delimiterLineEnd = docText.indexOf('\n', node.range.start);
  return delimiterLineEnd === -1 || delimiterLineEnd >= node.range.end ? node.range.end : delimiterLineEnd;
}

/**
 * Inserts a new `<name>` section as the FIRST CHILD of `parent` — always the
 * xml-tag dialect, the ADR-200/202 preference, which nests correctly under
 * every parent kind. First (not last) child is a grammar constraint, not a
 * style choice: the insertion point is the end of the parent's OWN body,
 * the one offset where the innermost still-open frame is guaranteed to be
 * the parent itself. At the parent's extent END, its last caps/atx child's
 * frame would still be open (only a same-dialect line or the enclosing xml
 * close pops it), so a stub appended there would nest under that CHILD —
 * one level too deep — for every parent whose last child is caps/atx.
 */
export function insertChildSection(docText: string, parent: PromptTreeNode, name: string): string {
  const insertAt = bodyEndOffset(docText, parent);
  const inserted = `\n\n${xmlSectionStub(name)}\n\n`;
  const next = docText.slice(0, insertAt) + inserted + docText.slice(insertAt);
  return capSeamNewlines(capSeamNewlines(next, insertAt + inserted.length), insertAt);
}

/**
 * Swaps `section` with its previous (`'up'`) or next (`'down'`) sibling —
 * both full subtree extents move; the separator text between the two extents
 * stays in place between them. Returns `null` when the move is impossible
 * (unknown id, or already first/last among its siblings).
 */
export function moveSectionAmongSiblings(
  docText: string,
  tree: PromptTree,
  sectionId: string,
  direction: 'up' | 'down',
): string | null {
  const location = locateSection(tree, sectionId);
  if (!location) return null;
  const neighborIndex = direction === 'up' ? location.index - 1 : location.index + 1;
  if (neighborIndex < 0 || neighborIndex >= location.siblings.length) return null;

  const neighbor = location.siblings[neighborIndex];
  const [earlier, later] =
    neighbor.range.start < location.node.range.start ? [neighbor, location.node] : [location.node, neighbor];
  const earlierExtent = fullExtent(docText, earlier);
  const laterExtent = fullExtent(docText, later);
  const separator = docText.slice(earlierExtent.end, laterExtent.start);
  return (
    docText.slice(0, earlierExtent.start) +
    docText.slice(laterExtent.start, laterExtent.end) +
    separator +
    docText.slice(earlierExtent.start, earlierExtent.end) +
    docText.slice(laterExtent.end)
  );
}
