/**
 * Interim localStorage persistence for SESSION variable declarations — rollout-plan decision 2
 * (`docs/prompts/studio-rollout-plan.md` §6): until ZIP persistence (ADR-202 §9's exported
 * `variables/variables.json`) fully lands in the studio's write path, session declarations survive a
 * reload via a per-prompt-root localStorage entry. This module is the pure boundary around that cache;
 * wiring it into `App.tsx`'s registry state is a separate change.
 *
 * Two invariants shape everything here:
 *
 *  - **Only SESSION entries persist.** Built-in entries (`source: 'builtin'`) always re-derive from
 *    `buildBuiltinRegistry()` (`variables-registry.ts`) and are NEVER written to storage — persisting
 *    them would freeze a hand-curated, still-evolving set (`PROMPT_VARIABLE_DOCS`) into every dev's
 *    cache. For the same reason the stored shape carries no `source` field at all: every loaded entry
 *    is stamped `source: 'session'` on the way out, so stale data can never impersonate a builtin.
 *  - **localStorage is a boundary → validate what you read.** The payload is parsed through an arktype
 *    schema with `'+': 'reject'` (CLAUDE.md rule); malformed, stale, or truncated data silently yields
 *    the empty list. A dev tool must never crash on a bad cache, so every failure mode — absent key,
 *    invalid JSON, schema rejection, a throwing storage — degrades to "no saved declarations".
 *
 * Writes are equally best-effort: a quota-exceeded or disabled storage swallows the error and the
 * declaration simply doesn't survive the reload — persistence never breaks declaring.
 */

import { type } from 'arktype';
import type { DeclaredVariable } from './variables-registry';

/**
 * Versioned key namespace — key = prefix + rootKey. Exported so tests can lock the format: changing it
 * silently would orphan every dev's saved declarations (the old keys would simply stop being read).
 */
export const STORAGE_KEY_PREFIX = 'prompt-studio:registry:v1:';

/** The narrow slice of `Storage` this module needs — injectable so tests never touch real localStorage. */
export type RegistryStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The persisted payload — `DeclaredVariable` minus `source` (see module doc for why `source` is never
 * stored). `'+': 'reject'` at both levels proves nothing else slipped into the cache (CLAUDE.md:
 * types are not proof).
 */
const storedDeclaration = type({
  name: 'string',
  purpose: 'string',
  sample: 'string',
  required: 'boolean',
  '+': 'reject',
});

const storedRegistry = type({
  declarations: storedDeclaration.array(),
  '+': 'reject',
});

function defaultStorage(): RegistryStorage | undefined {
  // `globalThis.localStorage` is absent in pure-node contexts and can THROW on access in some
  // sandboxed browser modes — treat both as "no storage".
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Loads the saved SESSION declarations for a prompt root. Every loaded entry is stamped
 * `source: 'session'` — the stored shape intentionally has no `source` field (see module doc). Any
 * failure — absent key, invalid JSON, schema rejection, a throwing storage — returns `[]`; this
 * function never throws.
 */
export function loadSessionDeclarations(
  rootKey: string,
  storage: RegistryStorage | undefined = defaultStorage(),
): readonly DeclaredVariable[] {
  if (!storage) {
    return [];
  }
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY_PREFIX + rootKey);
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const validated = storedRegistry(parsed);
  if (validated instanceof type.errors) {
    return [];
  }
  return validated.declarations.map((declaration) => ({ ...declaration, source: 'session' as const }));
}

/**
 * Saves the SESSION half of a registry's entries for a prompt root — built-in entries are filtered
 * out and `source` is stripped from the stored shape (see module doc). Best-effort: a throwing
 * storage (quota exceeded, disabled) is swallowed; this function never throws.
 */
export function saveSessionDeclarations(
  rootKey: string,
  entries: readonly DeclaredVariable[],
  storage: RegistryStorage | undefined = defaultStorage(),
): void {
  if (!storage) {
    return;
  }
  const declarations = entries
    .filter((entry) => entry.source === 'session')
    .map(({ name, purpose, sample, required }) => ({ name, purpose, sample, required }));
  try {
    storage.setItem(STORAGE_KEY_PREFIX + rootKey, JSON.stringify({ declarations }));
  } catch {
    // Best-effort cache — quota/disabled storage must never break declaring.
  }
}
