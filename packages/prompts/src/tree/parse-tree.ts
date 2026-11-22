import { maskPromptSourceLiterals } from '../prompt-source-literals';
import { extractPlaceholderNames, tokenizePromptText } from '../variable-assist';
/**
 * Pure, multi-dialect parser: turns a raw prompt source string into the
 * frozen `PromptTree` shape defined in `./types.ts` (ADR-200 observed model).
 *
 * No React, no DOM, no I/O — a single-pass, line-oriented scan over the
 * source string plus a full-text tag scan, assembled into a nested tree with
 * a stack. Best-effort by design: nothing here throws on malformed input,
 * everything surfaces as a `PromptParseDiagnostic` instead (see the type doc
 * on `PromptParseDiagnostic`).
 */
import type { SectionPair } from './parse-source';
import { classifyTags, findTagOccurrences, makeLineLocator, splitLines } from './parse-source';
import type { PromptParseDiagnostic, PromptTree, PromptTreeNode, SectionDelimiterKind } from './types';

// ── Dialect line-matchers ────────────────────────────────────────────────────

/**
 * Charset for the label portion of a `caps-label` line (everything before an
 * optional trailing parenthetical and the mandatory colon): letters, digits,
 * spaces, and the punctuation the brief calls out (`/ & ' ’ - — . ,`). No
 * lowercase — that's what keeps ordinary sentence-case prose from ever being
 * mistaken for a label (see `hasRequiredCapsLabelShape`).
 */
const CAPS_LABEL_CHARSET = "[A-Z0-9 /&'’.,\\-—]";

/**
 * Matches at the START of a line only (no `$` anchor) — deliberately, not a
 * whole-line match. Real prompt labels like `YOUR MISSION: Search the web…`
 * carry body text on the SAME physical line right after the colon (verified
 * against `scout.ts`); anchoring the whole pattern to end-of-line would miss
 * every one of them. Everything after the match (this line's tail, plus any
 * following lines) becomes the section's body — see `sameLineBodyStart`.
 */
const CAPS_LABEL_RE = new RegExp(`^(${CAPS_LABEL_CHARSET}+?)(\\s*\\([^)]*\\))?:`);

/**
 * Same grammar as `CAPS_LABEL_RE`, prefixed with the `N. ` numbered-list
 * marker — NO leading `\s*` before the digit. Every real numbered sub-label
 * (`1. JOB POSTINGS (existing channels):` in `scout.ts`) sits at column 0;
 * allowing leading whitespace here would let an indented markdown bullet
 * (`   - DELEGATION READINESS (…):`) masquerade as a numbered sub-label too.
 */
const NUMBERED_LABEL_RE = new RegExp(`^\\d+\\.\\s+(${CAPS_LABEL_CHARSET}+?)(\\s*\\([^)]*\\))?:`);

/** `^#{1,6} ` per the brief — a literal space after the hashes, no leading whitespace tolerated. */
const ATX_HEADING_RE = /^(#{1,6}) (.*)$/;

/** "Require at least one A-Z letter and a total label of 2+ characters." */
function hasRequiredCapsLabelShape(rawLabel: string): boolean {
  const trimmed = rawLabel.trim();
  return trimmed.length >= 2 && /[A-Z]/.test(trimmed);
}

/**
 * Rejects a markdown list item from ever being mistaken for a caps-label or
 * numbered sub-label. Two real defects this guards against (found by
 * parsing the actual `SCOUT_PROMPT`):
 *   1. `CAPS_LABEL_CHARSET` includes both space and `-`, so an INDENTED
 *      bullet like `   - DELEGATION READINESS (most important…):` was
 *      silently accepted — the leading spaces and the `-` marker just read
 *      as ordinary label characters — and worse, promoted to a phantom
 *      depth-1 section that truncated its true parent (`SCORING RUBRIC`)
 *      early. `hasLeadingWhitespace` below closes that hole (a genuine
 *      label always starts at column 0, per the survey of real prompts).
 *   2. Per the brief's explicit follow-up requirement, an UNINDENTED
 *      `- FOO:` (column 0, no leading whitespace) must still never become a
 *      section — checked independently so it doesn't slip through on the
 *      indentation rule alone.
 */
function startsWithMarkdownListMarker(lineText: string): boolean {
  const firstNonWhitespace = lineText.replace(/^\s+/, '')[0];
  return firstNonWhitespace === '-' || firstNonWhitespace === '*' || firstNonWhitespace === '+';
}

/** A genuine caps-label/numbered-sub-label always starts at column 0 — see `startsWithMarkdownListMarker`. */
function hasLeadingWhitespace(lineText: string): boolean {
  return lineText.length > 0 && /^\s/.test(lineText);
}

interface LabelMatch {
  /** Title with delimiter syntax (numbering, trailing colon) stripped, parenthetical normalized to one space. */
  title: string;
  /** Offset, within the line, where same-line body text begins (may equal `line.text.length`). */
  sameLineBodyStart: number;
}

function joinLabelAndParen(label: string, paren: string | undefined): string {
  const labelTrimmed = label.trim();
  const parenTrimmed = (paren ?? '').trim();
  return parenTrimmed ? `${labelTrimmed} ${parenTrimmed}` : labelTrimmed;
}

function matchCapsLabelLine(lineText: string): LabelMatch | null {
  if (startsWithMarkdownListMarker(lineText) || hasLeadingWhitespace(lineText)) return null;
  const m = CAPS_LABEL_RE.exec(lineText);
  if (!m || !hasRequiredCapsLabelShape(m[1])) return null;
  const matchEnd = m.index + m[0].length;
  const sameLineBodyStart = lineText[matchEnd] === ' ' ? matchEnd + 1 : matchEnd;
  return { title: joinLabelAndParen(m[1], m[2]), sameLineBodyStart };
}

function matchNumberedLabelLine(lineText: string): LabelMatch | null {
  if (startsWithMarkdownListMarker(lineText) || hasLeadingWhitespace(lineText)) return null;
  const m = NUMBERED_LABEL_RE.exec(lineText);
  if (!m || !hasRequiredCapsLabelShape(m[1])) return null;
  const matchEnd = m.index + m[0].length;
  const sameLineBodyStart = lineText[matchEnd] === ' ' ? matchEnd + 1 : matchEnd;
  return { title: joinLabelAndParen(m[1], m[2]), sameLineBodyStart };
}

function matchAtxHeadingLine(lineText: string): { level: number; title: string } | null {
  const m = ATX_HEADING_RE.exec(lineText);
  if (!m) return null;
  return { level: m[1].length, title: m[2].trim() };
}

// ── Id derivation ─────────────────────────────────────────────────────────────

/** Derives a stable, url-safe slug from a title. Never empty (falls back to `'section'`). */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // drop combining diacritics introduced by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * Builds a globally stable, derived node id: `parentId/localSlug`, where
 * `localSlug` is the title's slug, disambiguated only when it collides with
 * an EARLIER sibling under the same parent (per-parent counters). Never an
 * array index, never random — see the `id` doc on `PromptTreeNode`.
 */
function makeIdFactory() {
  const countsByParent = new Map<string, Map<string, number>>();
  return (parentId: string | null, titleSeed: string): string => {
    const slug = slugify(titleSeed);
    const groupKey = parentId ?? '';
    let counts = countsByParent.get(groupKey);
    if (!counts) {
      counts = new Map();
      countsByParent.set(groupKey, counts);
    }
    const occurrence = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, occurrence);
    const localSlug = occurrence === 1 ? slug : `${slug}-${occurrence}`;
    return parentId ? `${parentId}/${localSlug}` : localSlug;
  };
}

// ── Tool mention extraction ──────────────────────────────────────────────────

/**
 * Bare, whole-word, unique, first-appearance-order occurrences of `toolNames`
 * in `text`. Reuses `tokenizePromptText` (already matches tags before tools,
 * so a tag-shaped `<web_search>` is never double-counted as a tool mention —
 * see the `toolMentions` doc on `PromptTreeNode`) rather than re-implementing
 * the whole-word tool matcher `variable-assist.ts` keeps private.
 */
function extractToolMentions(text: string, toolNames: readonly string[]): string[] {
  if (toolNames.length === 0) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const token of tokenizePromptText(text, { variables: [], tools: toolNames })) {
    if (token.kind === 'tool' && token.name !== undefined && !seen.has(token.name)) {
      seen.add(token.name);
      names.push(token.name);
    }
  }
  return names;
}

// ── Tree assembly ─────────────────────────────────────────────────────────────

/** An in-progress node still open on the assembly stack. */
interface Frame {
  node: PromptTreeNode;
  /** Absolute source offset where this node's own body begins. */
  contentStart: number;
  isXml: boolean;
  /** Set only for `isXml` frames — links back to the `SectionPair` that opened it. */
  pairId?: number;
}

/**
 * Parses `input.text` into a `PromptTree`. Pure and best-effort: malformed or
 * ambiguous input never throws, it is downgraded to a `PromptParseDiagnostic`
 * alongside whatever tree the parser could still recover.
 */
export function parsePromptTree(input: { key: string; text: string; toolNames?: readonly string[] }): PromptTree {
  const { key, text } = input;
  const toolNames = input.toolNames ?? [];
  const toolNameSet = new Set(toolNames);

  const lines = splitLines(text);
  const structureText = maskPromptSourceLiterals(text);
  const lineOfOffset = makeLineLocator(lines);
  const { tagClassifications, pairs } = classifyTags(
    findTagOccurrences(structureText),
    lines,
    lineOfOffset,
    toolNameSet,
  );

  const openLineToPair = new Map<number, SectionPair>();
  const closeLineToPair = new Map<number, SectionPair>();
  for (const pair of pairs) {
    openLineToPair.set(pair.openLineIndex, pair);
    closeLineToPair.set(pair.closeLineIndex, pair);
  }

  const diagnostics: PromptParseDiagnostic[] = [];
  const root: PromptTreeNode[] = [];
  const stack: Frame[] = [];
  const makeId = makeIdFactory();

  let lastAtxLevel = 0;
  // Depth of the nearest preceding top-level caps-label — numbered sub-labels
  // nest one level under it regardless of what else the stack currently holds
  // (see the `caps-label` numbered-sub-section rule in the parser brief).
  let lastCapsLabelDepth = 0;

  function currentParentFrame(): Frame | undefined {
    return stack[stack.length - 1];
  }

  function closeFrame(frame: Frame, endOffset: number): void {
    const { node } = frame;
    node.range.end = endOffset;
    const textEnd = node.children.length > 0 ? node.children[0].range.start : endOffset;
    node.text = text.slice(frame.contentStart, textEnd);
    node.variables = extractPlaceholderNames(node.text);
    node.toolMentions = extractToolMentions(node.text, toolNames);
  }

  /**
   * Closes every open, non-xml frame whose depth is >= `depth` (the standard
   * heading-nesting "pop siblings and shallower ancestors" rule). An open
   * `xml-tag` frame is never popped this way — its scope only ends at its own
   * matching closing tag (handled separately in the main loop) — so a
   * caps-label/atx/numbered line found INSIDE an still-open xml block nests
   * under it instead of prematurely closing it.
   */
  function popNonXmlDeeperOrEqual(depth: number, endOffset: number): void {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.isXml || top.node.depth < depth) break;
      stack.pop();
      closeFrame(top, endOffset);
    }
  }

  function pushNode(node: PromptTreeNode, contentStart: number, isXml: boolean, pairId?: number): void {
    const parent = currentParentFrame();
    if (parent) parent.node.children.push(node);
    else root.push(node);
    stack.push({ node, contentStart, isXml, pairId });
  }

  function makeNode(
    id: string,
    title: string,
    delimiter: SectionDelimiterKind,
    depth: number,
    rangeStart: number,
    tag?: string,
  ): PromptTreeNode {
    return {
      id,
      title,
      delimiter,
      depth,
      text: '',
      range: { start: rangeStart, end: rangeStart },
      ...(tag !== undefined ? { tag } : {}),
      variables: [],
      toolMentions: [],
      children: [],
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (structureText.slice(line.start, line.end).trim() === '' && line.text.trim() !== '') continue;

    const closePair = closeLineToPair.get(i);
    if (closePair !== undefined) {
      // The enclosing block is ending here — force-close its frame AND any
      // still-open descendants (their body is cut short at the same offset).
      while (stack.length > 0) {
        const top = stack.pop() as Frame;
        closeFrame(top, line.start);
        if (top.pairId === closePair.id) break;
      }
      continue;
    }

    const openPair = openLineToPair.get(i);
    if (openPair !== undefined) {
      const parent = currentParentFrame();
      const depth = (parent?.node.depth ?? 0) + 1;
      const id = makeId(parent?.node.id ?? null, openPair.name);
      const node = makeNode(id, openPair.name, 'xml-tag', depth, line.start, openPair.name);
      pushNode(node, line.endWithNewline, true, openPair.id);
      continue;
    }

    const numbered = matchNumberedLabelLine(line.text);
    if (numbered) {
      const intrinsicDepth = lastCapsLabelDepth + 1;
      popNonXmlDeeperOrEqual(intrinsicDepth, line.start);
      const parent = currentParentFrame();
      // Normally `depth === intrinsicDepth` (popping already guarantees
      // parent.depth < intrinsicDepth). The two can diverge only when an
      // ancestor `xml-tag` frame blocks popping (see
      // `popNonXmlDeeperOrEqual`) — e.g. this numbered item sits inside a
      // still-open xml block whose own depth already exceeds the formula
      // value, so `depth` must still reflect true nesting, not silently go
      // backwards below the enclosing block.
      const depth = Math.max(intrinsicDepth, (parent?.node.depth ?? 0) + 1);
      const id = makeId(parent?.node.id ?? null, numbered.title);
      const node = makeNode(id, numbered.title, 'caps-label', depth, line.start);
      const contentStart =
        numbered.sameLineBodyStart >= line.text.length ? line.endWithNewline : line.start + numbered.sameLineBodyStart;
      pushNode(node, contentStart, false);
      continue;
    }

    const capsLabel = matchCapsLabelLine(line.text);
    if (capsLabel) {
      const intrinsicDepth = 1;
      popNonXmlDeeperOrEqual(intrinsicDepth, line.start);
      const parent = currentParentFrame();
      // See the identical comment in the numbered-label branch above: only
      // diverges from `intrinsicDepth` (1) when nested inside a still-open
      // xml-tag block.
      const depth = Math.max(intrinsicDepth, (parent?.node.depth ?? 0) + 1);
      lastCapsLabelDepth = depth;
      const id = makeId(parent?.node.id ?? null, capsLabel.title);
      const node = makeNode(id, capsLabel.title, 'caps-label', depth, line.start);
      const contentStart =
        capsLabel.sameLineBodyStart >= line.text.length
          ? line.endWithNewline
          : line.start + capsLabel.sameLineBodyStart;
      pushNode(node, contentStart, false);
      continue;
    }

    const atx = matchAtxHeadingLine(line.text);
    if (atx) {
      if (lastAtxLevel > 0 && atx.level > lastAtxLevel + 1) {
        diagnostics.push({
          code: 'skipped-heading-level',
          severity: 'warning',
          message: `Heading level jumps from #${lastAtxLevel} to #${atx.level}, skipping an intermediate level.`,
          range: { start: line.start, end: line.end },
        });
      }
      lastAtxLevel = atx.level;
      const intrinsicDepth = atx.level;
      popNonXmlDeeperOrEqual(intrinsicDepth, line.start);
      const parent = currentParentFrame();
      const depth = Math.max(intrinsicDepth, (parent?.node.depth ?? 0) + 1);
      const id = makeId(parent?.node.id ?? null, atx.title);
      const node = makeNode(id, atx.title, 'atx-heading', depth, line.start);
      pushNode(node, line.endWithNewline, false);
    }
  }

  // Close whatever is still open at end-of-document. By construction every
  // `xml-tag` frame was opened only for a confirmed-balanced pair, so only
  // atx/caps-label/numbered frames can still be open here.
  while (stack.length > 0) {
    closeFrame(stack.pop() as Frame, text.length);
  }

  for (const classification of tagClassifications) {
    if (classification.reason === 'unbalanced-open') {
      diagnostics.push({
        code: 'unbalanced-tag',
        severity: 'warning',
        message: `<${classification.name}> has no matching counterpart.`,
        range: classification.range,
      });
    }
  }

  if (root.length > 0 && root[0].range.start > 0) {
    const preamble = structureText.slice(0, root[0].range.start);
    if (preamble.trim() !== '') {
      diagnostics.push({
        code: 'text-before-first-section',
        severity: 'info',
        message: 'Text precedes the first detected section and was not attached to any node.',
        range: { start: 0, end: root[0].range.start },
      });
    }
  }

  let maxDepth = 0;
  const walk = (nodes: readonly PromptTreeNode[]): void => {
    for (const node of nodes) {
      if (node.depth > maxDepth) maxDepth = node.depth;
      walk(node.children);
    }
  };
  walk(root);

  return { key, text, maxDepth, children: root, tagClassifications, diagnostics };
}
