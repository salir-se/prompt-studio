/**
 * Pure helpers for prompt-editor "variable assist" UI: tokenizing prompt
 * text into text / variable / unknown-variable / tool / tag spans using the
 * exact same `{{ identifier }}` grammar as the render engine
 * (`PROMPT_PLACEHOLDER_RE`, see `engine.ts`).
 *
 * No I/O, no React — safe to unit test in isolation and reuse from any UI
 * (in-editor highlighting overlay, a variables panel, etc.).
 */

import { PROMPT_PLACEHOLDER_RE } from './engine';

export type PromptTokenKind = 'text' | 'variable' | 'unknown-variable' | 'tool' | 'tag';

export interface PromptToken {
  kind: PromptTokenKind;
  /** Raw slice of the input, braces/angle-brackets included for placeholders/tags. Concatenating all tokens' text reproduces the input byte-for-byte. */
  text: string;
  /** Placeholder, tool, or tag name (no braces/brackets/slash); absent for kind 'text'. */
  name?: string;
}

/**
 * Matches XML-style structure tags operators use to delimit prompt sections
 * (real examples in this repo: `<inbound_email>`, `<warning>`,
 * `<communication_intelligence>`, `<discovered_contacts>`) plus
 * operator-invented ones (e.g. `<special_skill>...</special_skill>`). Tags
 * have no registry — every well-formed tag highlights identically.
 *
 * Grammar: opening `<name>`, closing `</name>`, self-closing `<name/>`,
 * optional attributes only after whitespace. The name charset is anchored to
 * `[A-Za-z_][\w-]*` so a bare `<` immediately followed by anything else never
 * matches — comparisons (`a < b`, `x <= y`), markdown autolinks
 * (`<https://x.dev>`, the `:` right after the name has nowhere to go since
 * attributes require leading whitespace), `<>`, `<3`, or `< spaced>`.
 */
export const PROMPT_TAG_RE = /<\/?([A-Za-z_][\w-]*)(?:\s[^<>]*)?\/?>/g;

/**
 * `PROMPT_PLACEHOLDER_RE`/`PROMPT_TAG_RE` are shared, module-level global
 * `RegExp`s (stateful `lastIndex`). Every scan below uses its own fresh
 * instance so this module can never observe — or cause — cross-call
 * contamination, no matter how a loop elsewhere terminates or how many times
 * these functions are called back to back.
 */
function freshPlaceholderRegex(): RegExp {
  return new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags);
}

function freshTagRegex(): RegExp {
  return new RegExp(PROMPT_TAG_RE.source, PROMPT_TAG_RE.flags);
}

/** Unique placeholder names in first-appearance order. */
export function extractPlaceholderNames(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of text.matchAll(freshPlaceholderRegex())) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** Placeholder names present in text but not in knownVariables (unique, ordered). */
export function findUnknownPlaceholders(text: string, knownVariables: readonly string[]): string[] {
  const known = new Set(knownVariables);
  return extractPlaceholderNames(text).filter((name) => !known.has(name));
}

/** Escapes a literal string for safe embedding inside a `RegExp` source. */
function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a whole-word, longest-name-first alternation for `toolNames`.
 * Sorting by descending length ensures that when one tool name is a prefix
 * of another (e.g. `web` / `web_search`), the longer name wins at any shared
 * starting position — JS regex alternation tries alternatives in listed
 * order and stops at the first success, it does not pick the longest match.
 */
function buildToolWordRegex(toolNames: readonly string[]): RegExp {
  const alternation = [...toolNames]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExpLiteral)
    .join('|');
  return new RegExp(`\\b(?:${alternation})\\b`, 'g');
}

/** Tokenizes a placeholder-free text segment into 'tool' / 'text' tokens. */
function tokenizeTools(segment: string, toolNames: readonly string[]): PromptToken[] {
  if (segment === '') return [];
  if (toolNames.length === 0) return [{ kind: 'text', text: segment }];

  const tokens: PromptToken[] = [];
  let cursor = 0;
  for (const match of segment.matchAll(buildToolWordRegex(toolNames))) {
    // matchAll on a global regex always populates `.index` (spec-guaranteed).
    const start = match.index!;
    if (start > cursor) {
      tokens.push({ kind: 'text', text: segment.slice(cursor, start) });
    }
    tokens.push({ kind: 'tool', text: match[0], name: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < segment.length) {
    tokens.push({ kind: 'text', text: segment.slice(cursor) });
  }
  return tokens;
}

/**
 * Tokenizes a placeholder-free text segment into 'tag' tokens plus, within
 * whatever tag-free text remains, 'tool' / 'text' tokens. Tags are matched
 * first so a tag whose name shadows a tool (`<web_search>`) stays a single
 * 'tag' token instead of also being tool-matched.
 */
function tokenizeSegment(segment: string, toolNames: readonly string[]): PromptToken[] {
  if (segment === '') return [];

  const tokens: PromptToken[] = [];
  let cursor = 0;
  for (const match of segment.matchAll(freshTagRegex())) {
    // matchAll on a global regex always populates `.index` (spec-guaranteed).
    const start = match.index!;
    if (start > cursor) {
      tokens.push(...tokenizeTools(segment.slice(cursor, start), toolNames));
    }
    tokens.push({ kind: 'tag', text: match[0], name: match[1] });
    cursor = start + match[0].length;
  }
  if (cursor < segment.length) {
    tokens.push(...tokenizeTools(segment.slice(cursor), toolNames));
  }
  return tokens;
}

/** Tokenize into text/variable/unknown-variable/tool/tag tokens. */
export function tokenizePromptText(
  text: string,
  known: { variables: readonly string[]; tools?: readonly string[] },
): PromptToken[] {
  const variables = new Set(known.variables);
  const tools = known.tools ?? [];
  const tokens: PromptToken[] = [];
  let cursor = 0;

  for (const match of text.matchAll(freshPlaceholderRegex())) {
    // matchAll on a global regex always populates `.index` (spec-guaranteed).
    const start = match.index!;
    tokens.push(...tokenizeSegment(text.slice(cursor, start), tools));
    const name = match[1];
    tokens.push({ kind: variables.has(name) ? 'variable' : 'unknown-variable', text: match[0], name });
    cursor = start + match[0].length;
  }
  tokens.push(...tokenizeSegment(text.slice(cursor), tools));

  return tokens;
}
