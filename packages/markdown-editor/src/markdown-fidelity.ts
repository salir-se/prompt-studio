/**
 * Text-fidelity rules for the WYSIWYG editor. Milkdown keeps a ProseMirror document, not the author's source, and
 * writes the whole document back on every edit, so its output can differ from what the author typed: different
 * bullet markers, blank lines, and backslash escapes the parser never needed. These rules decide what may replace
 * the author's text. They are free of `@milkdown/*`: the caller passes the editor's own Markdown parser.
 */

/** Parses Markdown into a syntax tree (mdast). Use the editor's own parser so both agree on meaning. */
export type ParseMarkdown = (markdown: string) => unknown;

/**
 * How faithfully a round trip through the editor keeps a text: `exact` = byte for byte; `equivalent` = the same
 * Markdown meaning written differently (bullet marker, blank lines); `changed` = the meaning differs.
 */
export type Fidelity = 'exact' | 'equivalent' | 'changed';

/** What a field requires before it may open in the Visual view. */
export type RequiredFidelity = Exclude<Fidelity, 'changed'>;

const RANK: Record<Fidelity, number> = { changed: 0, equivalent: 1, exact: 2 };

/** Escapable ASCII punctuation (CommonMark §2.4). */
const ESCAPE = /\\[!-/:-@[-`{-~]/g;

function withoutPositions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutPositions);
  if (node === null || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'position') copy[key] = withoutPositions(value);
  }
  return copy;
}

function meaningOf(markdown: string, parse: ParseMarkdown): string {
  return JSON.stringify(withoutPositions(parse(markdown)));
}

/**
 * Removes every backslash escape whose removal leaves the Markdown meaning unchanged, so `{{product\_name}}`,
 * `\<critic\_workflow>` and `\[CONFIRM …]` read as typed. An escape inside code, or one that stops emphasis, a link or
 * a list from forming, changes the meaning when removed, so it stays.
 *
 * Most serializer escapes are all redundant, so the whole set is tried first (one parse); a set that changes the
 * meaning is split in halves until each needed escape stands alone. Every accepted removal is checked against the
 * whole document together with the removals already accepted, so the result always means what the input meant.
 */
export function removeRedundantEscapes(markdown: string, parse: ParseMarkdown): string {
  if (!markdown.includes('\\')) return markdown;
  const meaning = meaningOf(markdown, parse);
  const escapes = [...markdown.matchAll(ESCAPE)].map((match) => match.index);
  const removed = new Set<number>();
  // Drops the backslash at each index in `drop` (UTF-16 indexes, as the regular expression reports them).
  const without = (drop: ReadonlySet<number>) => {
    let text = '';
    let from = 0;
    for (const index of escapes) {
      if (!drop.has(index)) continue;
      text += markdown.slice(from, index);
      from = index + 1;
    }
    return text + markdown.slice(from);
  };
  const tryRemoving = (group: number[]): void => {
    if (group.length === 0) return;
    const trial = new Set([...removed, ...group]);
    if (meaningOf(without(trial), parse) === meaning) {
      for (const index of group) removed.add(index);
      return;
    }
    if (group.length === 1) return;
    const middle = group.length >> 1;
    tryRemoving(group.slice(0, middle));
    tryRemoving(group.slice(middle));
  };
  tryRemoving(escapes);
  return without(removed);
}

/** Compares the author's text with what the editor would write back for it. */
export function measureFidelity(original: string, roundTripped: string, parse: ParseMarkdown): Fidelity {
  if (original === roundTripped) return 'exact';
  return meaningOf(original, parse) === meaningOf(roundTripped, parse) ? 'equivalent' : 'changed';
}

/** True when a field that requires `required` may open in the Visual view after a round trip of `measured`. */
export function visualKeepsText(measured: Fidelity, required: RequiredFidelity): boolean {
  return RANK[measured] >= RANK[required];
}
