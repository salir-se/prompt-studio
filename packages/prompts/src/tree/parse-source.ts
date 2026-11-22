import { PROMPT_TAG_RE } from '../variable-assist';
import type { PromptTagClassification, PromptTagClassificationReason } from './types';

// ── Line model ───────────────────────────────────────────────────────────────

/** One physical line of the source, with its offsets recorded for range-building. */
interface SourceLine {
  /** Raw line content, excluding the trailing `\n` (if any). */
  text: string;
  /** Offset of this line's first character in the source string. */
  start: number;
  /** Offset just past this line's last character, excluding a trailing `\n`. */
  end: number;
  /** Offset just past this line's trailing `\n`, or equal to `end` for a final line with none. */
  endWithNewline: number;
}

/** Splits `source` into `SourceLine`s. A trailing `\n` never produces a phantom empty final line. */
export function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let cursor = 0;
  for (;;) {
    const newlineIndex = source.indexOf('\n', cursor);
    if (newlineIndex === -1) {
      if (cursor < source.length || lines.length === 0) {
        lines.push({ text: source.slice(cursor), start: cursor, end: source.length, endWithNewline: source.length });
      }
      return lines;
    }
    lines.push({
      text: source.slice(cursor, newlineIndex),
      start: cursor,
      end: newlineIndex,
      endWithNewline: newlineIndex + 1,
    });
    cursor = newlineIndex + 1;
  }
}

/** Binary search from an absolute source offset to its containing line index. */
export function makeLineLocator(lines: readonly SourceLine[]): (offset: number) => number {
  return (offset: number) => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

// ── Tag scanning + classification ────────────────────────────────────────────

interface TagOccurrence {
  name: string;
  start: number;
  end: number;
  raw: string;
  kind: 'open' | 'close' | 'self-close';
}

export function findTagOccurrences(text: string): TagOccurrence[] {
  // Fresh RegExp instance per scan — PROMPT_TAG_RE is a shared, stateful
  // global; reusing it directly would leak `lastIndex` across calls/modules.
  const re = new RegExp(PROMPT_TAG_RE.source, PROMPT_TAG_RE.flags);
  const occurrences: TagOccurrence[] = [];
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    const start = match.index;
    const kind: TagOccurrence['kind'] = raw.startsWith('</') ? 'close' : raw.endsWith('/>') ? 'self-close' : 'open';
    occurrences.push({ name: match[1], start, end: start + raw.length, raw, kind });
  }
  return occurrences;
}

/** A balanced, promotable `<name>…</name>` block-level pair. */
export interface SectionPair {
  id: number;
  name: string;
  openLineIndex: number;
  closeLineIndex: number;
}

interface TagScanResult {
  tagClassifications: PromptTagClassification[];
  pairs: SectionPair[];
}

/**
 * Classifies every tag occurrence in `text` and identifies which ones form a
 * balanced, block-level, non-tool pair eligible for section promotion.
 *
 * Precedence (mirrors the type doc on `PromptTagClassificationReason`):
 *   1. known tool name — always wins, even over an otherwise-balanced block pair.
 *   2. not block-level (shares its line with other content) — 'inline-not-block-level',
 *      never promoted even if balanced elsewhere in the source.
 *   3. block-level open/close matched via a simple per-occurrence stack (last-in-
 *      first-out, like well-formed HTML) — 'balanced-block-promoted'.
 *   4. anything left unmatched (an open with no close, a close with no open, or a
 *      block-level self-closing tag, which can never pair) — 'unbalanced-open'.
 */
export function classifyTags(
  occurrences: readonly TagOccurrence[],
  lines: readonly SourceLine[],
  lineOfOffset: (offset: number) => number,
  toolNames: ReadonlySet<string>,
): TagScanResult {
  const reasonByOccurrence = new Map<TagOccurrence, PromptTagClassificationReason>();
  const consumedCloses = new Set<TagOccurrence>();
  const pairs: SectionPair[] = [];
  const openStack: Array<{ occurrence: TagOccurrence; lineIndex: number }> = [];
  let nextPairId = 0;

  for (const occ of occurrences) {
    if (toolNames.has(occ.name)) {
      reasonByOccurrence.set(occ, 'known-tool-name');
      continue;
    }

    const lineIndex = lineOfOffset(occ.start);
    const blockLevel = lines[lineIndex].text.trim() === occ.raw;
    if (!blockLevel) {
      reasonByOccurrence.set(occ, 'inline-not-block-level');
      continue;
    }

    if (occ.kind === 'open') {
      openStack.push({ occurrence: occ, lineIndex });
      continue; // reason decided once we know whether a matching close ever shows up
    }
    if (occ.kind === 'self-close') {
      // A self-closing tag has no distinct closing partner to pair with, so
      // it can never become a `balanced-block-promoted` section.
      reasonByOccurrence.set(occ, 'unbalanced-open');
      continue;
    }
    // occ.kind === 'close'
    const top = openStack[openStack.length - 1];
    if (top && top.occurrence.name === occ.name) {
      openStack.pop();
      pairs.push({ id: nextPairId++, name: occ.name, openLineIndex: top.lineIndex, closeLineIndex: lineIndex });
      reasonByOccurrence.set(top.occurrence, 'balanced-block-promoted');
      consumedCloses.add(occ); // the pair is represented by the opening occurrence only
    } else {
      reasonByOccurrence.set(occ, 'unbalanced-open');
    }
  }
  for (const { occurrence } of openStack) {
    reasonByOccurrence.set(occurrence, 'unbalanced-open');
  }

  const tagClassifications: PromptTagClassification[] = [];
  for (const occ of occurrences) {
    if (consumedCloses.has(occ)) continue;
    const reason = reasonByOccurrence.get(occ);
    if (!reason) continue; // unreachable: every occurrence is assigned a reason above
    tagClassifications.push({
      name: occ.name,
      range: { start: occ.start, end: occ.end },
      treatedAsSection: reason === 'balanced-block-promoted',
      reason,
    });
  }
  return { tagClassifications, pairs };
}
