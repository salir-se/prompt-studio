import {
  LEGACY_PROMPT_ROOTS,
  type LegacyPromptRootInventoryEntry,
  type LegacyPromptSourceRef,
  PROMPT_KEY_TOOL_NAMES,
  type PromptDesign,
} from '@prompt-studio/prompts';
import type { StudioManifestDocument } from '../manifest/manifest-schema';
import { readWorkspacePrompt } from '../prompt-repo/workspace-document';
import type { CanonicalPromptRoot, CanonicalPromptSource } from './canonical-prompt-contract';
import { bundledCanonicalPromptSource } from './canonical-prompt-source';
import { bundledPromptContentSource, type PromptContentSource } from './prompt-content-source';

/**
 * Root-catalog builder for the prompt-studio sidebar.
 *
 * Joins the merged `LEGACY_PROMPT_ROOTS` inventory (`@prompt-studio/prompts`) with a
 * `PromptContentSource` (defaulting to `bundledPromptContentSource`). Roots are not uniformly
 * loadable — some are plain string constants, some are resolved at runtime from one of a handful
 * of named variants, one is assembled inline in the SPA (no importable symbol at all), and a few
 * live in modules this app cannot import (an eval-only script, or the www app). `buildRootCatalog`
 * derives the full list — and each root's loadability — from `LEGACY_PROMPT_ROOTS` itself; the
 * content source is only asked "do you have text for this symbol?" per entry. Never hard-code the
 * root list here.
 *
 * This module never imports prompt-text symbols (e.g. `SCOUT_PROMPT`) directly — see
 * `./prompt-content-source.ts` for why that import boundary matters.
 */

export type RootLoadability = 'constant' | 'resolver-variants' | 'inline' | 'external';

export interface CatalogVariant {
  symbol: string;
  text: string;
}

export interface CatalogRoot {
  /** Inventory id (e.g. 'scout'). */
  id: string;
  /** Human title derived from the id (e.g. 'Scout', 'Critic Outbound (agent loop)'). */
  title: string;
  group?: StudioManifestDocument['group'];
  loadability: RootLoadability;
  status: 'live' | 'callable' | 'evaluation';
  /** Present iff `loadability === 'constant'`. */
  text?: string;
  /** Present iff `loadability === 'resolver-variants'`. */
  variants?: readonly CatalogVariant[];
  /** Union of tool names reachable from this root's editable keys, deduped and sorted. */
  toolNames: readonly string[];
  protectedSkills: readonly string[];
  /** e.g. 'SCOUT_PROMPT' or '<inline scheduler runtime system prompt>'. */
  ownerLabel: string;
  /** The raw inventory entry, kept for the inspector view. */
  entry: LegacyPromptRootInventoryEntry;
  /** Canonical ADR-200 text and verification metadata when this loadable root has migrated. */
  verification?: CanonicalPromptRoot;
  /** Versioned Studio-authored contracts for roots created inside a configuration. */
  design?: PromptDesign;
}

/** An inline-assembled root has no importable symbol at all — see `<inline ...>` owners in the inventory. */
function isInlineOwner(owner: LegacyPromptSourceRef): boolean {
  return owner.symbol.startsWith('<');
}

/** True when every listed variant symbol resolves via the content source — a partial match is not good enough. */
function resolveVariants(
  variants: readonly LegacyPromptSourceRef[],
  source: PromptContentSource,
): CatalogVariant[] | undefined {
  if (variants.length === 0) {
    return undefined;
  }
  const resolved = variants
    .map((variant) => ({ symbol: variant.symbol, text: source.getPromptText(variant.symbol) }))
    .filter((variant): variant is CatalogVariant => variant.text !== null);
  return resolved.length === variants.length ? resolved : undefined;
}

interface RootClassification {
  loadability: RootLoadability;
  text?: string;
  variants?: readonly CatalogVariant[];
}

/**
 * Classifies a single inventory entry against the content source. Order matters only where an
 * entry could otherwise match more than one shape; today no entry does (inline owners have no
 * variants, and every resolver-owned entry's own `owner.symbol` is a function name, never a symbol
 * the content source resolves), so this reads as a plain decision list.
 */
function classifyRoot(entry: LegacyPromptRootInventoryEntry, source: PromptContentSource): RootClassification {
  if (isInlineOwner(entry.owner)) {
    return { loadability: 'inline' };
  }

  const resolvedVariants = resolveVariants(entry.variants, source);
  if (resolvedVariants) {
    return { loadability: 'resolver-variants', variants: resolvedVariants };
  }

  const constantText = source.getPromptText(entry.owner.symbol);
  if (constantText !== null) {
    return { loadability: 'constant', text: constantText };
  }

  return { loadability: 'external' };
}

/** Union of tool names reachable from a root's editable keys, deduped and sorted for a stable sidebar render. */
function resolveToolNames(editableKeys: readonly string[]): readonly string[] {
  const names = new Set<string>();
  for (const key of editableKeys) {
    for (const name of PROMPT_KEY_TOOL_NAMES[key] ?? []) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/** Parenthetical suffixes that describe a *variant* of an id's base name rather than a distinct word. */
const TITLE_SUFFIX_PARENTHETICALS: ReadonlyArray<{ suffix: string; label: string }> = [
  { suffix: '-agent-loop', label: 'agent loop' },
  { suffix: '-single-call', label: 'single call' },
];

/** Words whose conventional casing is an acronym, not title case (e.g. 'cv' -> 'CV', not 'Cv'). */
const TITLE_WORD_ACRONYMS: Readonly<Record<string, string>> = {
  cv: 'CV',
  icp: 'ICP',
};

function titleWord(word: string): string {
  return TITLE_WORD_ACRONYMS[word] ?? word.charAt(0).toUpperCase() + word.slice(1);
}

/** Derives a human title from an inventory id, e.g. 'scout' -> 'Scout', 'critic-outbound-agent-loop' -> 'Critic Outbound (agent loop)'. */
function titleForId(id: string): string {
  const suffixMatch = TITLE_SUFFIX_PARENTHETICALS.find(({ suffix }) => id.endsWith(suffix));
  const base = suffixMatch ? id.slice(0, id.length - suffixMatch.suffix.length) : id;
  const title = base.split('-').map(titleWord).join(' ');
  return suffixMatch ? `${title} (${suffixMatch.label})` : title;
}

/**
 * The manifest shape `buildRootCatalog` consumes. Structural (not the full `StudioManifest`) so
 * tests can pass minimal fixtures — every field it reads is here and nothing else.
 */
export interface RootCatalogManifest {
  readonly catalog?:
    | { readonly source: 'legacy-inventory' }
    | { readonly source: 'explicit'; readonly documents: readonly StudioManifestDocument[] };
  readonly extraDocuments?: readonly StudioManifestDocument[];
}

/**
 * Synthesizes an inventory-shaped entry for a manifest-declared document (ADR-235
 * `extraDocuments`, and `catalog.source: 'explicit'` documents for third-party manifests).
 * These documents are NOT in `LEGACY_PROMPT_ROOTS` — the manifest is the operator's way to
 * declare editable documents the inventory does not know — but every consumer of `CatalogRoot`
 * reads `entry.editableKeys`/`entry.protectedSkills`, so a shape-complete synthetic entry (all
 * empty collections, the document's declared source as owner) keeps those consumers untouched.
 *
 * A file source's owner symbol follows the inline-owner convention (a leading `<`): it names
 * where the text lives without pretending an importable constant exists.
 */
function manifestDocumentToEntry(document: StudioManifestDocument): LegacyPromptRootInventoryEntry {
  const owner =
    document.source.kind === 'symbol'
      ? { module: document.source.module, symbol: document.source.symbol }
      : { module: document.source.path, symbol: `<file ${document.source.path}>` };
  return {
    id: document.id,
    kind: 'system',
    status: 'live',
    owner,
    consumers: [],
    editableKeys: [...(document.editableKeys ?? [])],
    dynamicSources: [],
    toolSets: [],
    variants: [],
    ownedFragments: [],
    protectedSkills: [],
    legacyIdentity: [],
  };
}

/**
 * Builds the prompt-root catalog for the studio sidebar, deterministically, from `LEGACY_PROMPT_ROOTS`.
 * `source` defaults to `bundledPromptContentSource` so every existing caller keeps working unchanged;
 * a later task swaps in a runtime implementation that reads content from a mounted repository instead.
 *
 * `manifest` (ADR-235):
 *  - `legacy-inventory` (the shipped salir manifest) appends the manifest's `extraDocuments` as
 *    first-class roots after the inventory roots: a document whose symbol resolves through the
 *    source is a `constant` root with text (fully editable + historied, exactly like an inventory
 *    constant); anything else degrades to `external` rather than breaking the catalog.
 *  - `explicit` (third-party manifests) builds ONLY from the manifest's declared documents — the
 *    salir inventory roots are deliberately absent, which is the entire point of the universal
 *    editor: a third-party manifest describes a third-party prompt tree.
 *
 * `fileTexts` carries the fetched text of file-sourced documents (`.md` files read through the
 * bridge — see `fetchManifestFileTexts`); symbol sources resolve through `source` as always.
 */
export function buildRootCatalog(
  source: PromptContentSource = bundledPromptContentSource,
  manifest?: RootCatalogManifest,
  fileTexts?: ReadonlyMap<string, string>,
  canonicalSource: CanonicalPromptSource = bundledCanonicalPromptSource,
): readonly CatalogRoot[] {
  const manifestDocuments = ((): readonly StudioManifestDocument[] => {
    if (manifest?.catalog?.source === 'explicit') {
      // explicit documents first; extraDocuments appended only when not shadowed by id.
      const ids = new Set(manifest.catalog.documents.map((document) => document.id));
      return [
        ...manifest.catalog.documents,
        ...(manifest.extraDocuments ?? []).filter((document) => !ids.has(document.id)),
      ];
    }
    return manifest?.extraDocuments ?? [];
  })();

  const manifestRoots = manifestDocuments.map((document): CatalogRoot => {
    const entry = manifestDocumentToEntry(document);
    const fetched =
      document.source.kind === 'symbol'
        ? source.getPromptText(document.source.symbol)
        : (fileTexts?.get(document.source.path) ?? null);
    const workspace = document.source.kind === 'file' && fetched ? readWorkspacePrompt(fetched) : null;
    // A file in the person's folder is theirs to open even before its text has loaded.
    // A missing symbol still has no prompt text, so that row stays unreadable.
    const text = workspace ? workspace.text : document.source.kind === 'file' ? (fetched ?? '') : fetched;
    return {
      id: entry.id,
      title: workspace?.design.title ?? document.title,
      group: document.group,
      loadability: text !== null ? 'constant' : 'external',
      status: 'live',
      ...(text !== null ? { text } : {}),
      ...(workspace ? { design: workspace.design } : {}),
      toolNames: workspace ? workspace.design.tools : resolveToolNames(entry.editableKeys),
      protectedSkills: entry.protectedSkills,
      ownerLabel: entry.owner.symbol,
      entry,
    };
  });

  if (manifest?.catalog?.source === 'explicit') {
    return manifestRoots;
  }

  const inventoryRoots = LEGACY_PROMPT_ROOTS.map((entry): CatalogRoot => {
    const classification = classifyRoot(entry, source);
    const verification = classification.loadability === 'constant' ? canonicalSource.getRoot(entry.id) : null;

    return {
      id: entry.id,
      title: titleForId(entry.id),
      loadability: classification.loadability,
      status: entry.status,
      ...(verification ? { text: verification.text, verification } : {}),
      ...(!verification && classification.text !== undefined ? { text: classification.text } : {}),
      ...(classification.variants !== undefined ? { variants: classification.variants } : {}),
      toolNames: resolveToolNames(entry.editableKeys),
      protectedSkills: entry.protectedSkills,
      ownerLabel: entry.owner.symbol,
      entry,
    };
  });

  return [...inventoryRoots, ...manifestRoots];
}
