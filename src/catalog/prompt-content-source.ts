import { DEFAULT_MANIFEST } from '../manifest/default-manifest';
import { bridgeContentSource } from './bridge-content-source';
import { installedCatalogSkipsSalirSources } from './salir-catalog-gate';

/**
 * CONTAINER-BUILD variant of the `PromptContentSource` seam (see `./prompt-content-source.ts` for why
 * the seam exists, and `./bridge-content-source.ts` for the runtime-fetch implementation this module
 * wraps). Swapped in ONLY for `bun run build:container`, via `vite.config.ts`'s conditional
 * `resolve.alias`, which redirects the module specifier `./prompt-content-source` to THIS file for
 * that one build. `root-catalog.ts`/`tool-directory.ts` are unchanged — they still write
 * `import { bundledPromptContentSource } from './prompt-content-source'`; the alias is what makes
 * that specifier resolve here instead of the real `prompt-content-source.ts`.
 *
 * ── Why a build-time module swap, not a runtime branch ──────────────────────────────────────────
 * A bundler only omits code nothing imports. A runtime check like
 * `if (import.meta.env.MODE === 'container') { ... } else { ...bundledPromptContentSource... }`
 * inside ONE module would still contain a static `import { SCOUT_PROMPT, ... } from '@prompt-studio/prompts'`
 * at the top of that module — reachable, and therefore emitted into the bundle, even though the
 * branch selecting it never runs at container runtime. The prose import has to be structurally
 * ABSENT from the module Vite resolves for `./prompt-content-source`; only redirecting the specifier
 * itself (this file) guarantees the prose-importing module is never even parsed by Rollup for a
 * container build. This module imports NO prompt/tool prose from `@prompt-studio/prompts` — only the
 * `ToolDefinition` TYPE (erased at build time, not prose) and the bridge-backed source it wraps.
 *
 * ── Local `PromptContentSource`/`ToolSourceList` re-declaration ──────────────────────────────────
 * These two interfaces are copied verbatim from `./prompt-content-source.ts` rather than imported
 * from it: that specifier is exactly what the container build's alias redirects to THIS file, so an
 * `import type { PromptContentSource } from './prompt-content-source'` written here would (under the
 * alias) resolve back to this same module. Duplicating the two-method shape is simpler than reasoning
 * about a self-referential import, and TypeScript's structural typing means every consumer (which
 * still imports the ORIGINAL, un-aliased type declaration via `tsc`'s own resolution — the alias only
 * affects Vite's bundler, never `tsgo`) accepts either shape interchangeably.
 */

/** Mirrors `ToolSourceList`/`ToolSourceEntry` in `./prompt-content-source.ts` — see this module's doc comment. */
export interface ToolSourceEntry {
  readonly name: string;
  readonly description?: string;
  readonly inputKeys: readonly string[];
}

export interface ToolSourceList {
  readonly source: string;
  readonly tools: readonly ToolSourceEntry[];
}

/** Mirrors `PromptContentSource` in `./prompt-content-source.ts` — see this module's doc comment. */
export interface PromptContentSource {
  getPromptText(symbol: string): string | null;
  getToolSourceLists(): readonly ToolSourceList[];
}

/**
 * Container-build binding of the seam's default export name: same public name as the bundled
 * variant (`bundledPromptContentSource`), backed by the bridge-fetched singleton instead of
 * statically-imported prose. Ships zero prompt prose in the bundle; the operator's mounted repo
 * supplies the text at runtime through `/__studio/file` (see `./bridge-content-source.ts`).
 *
 * `getToolSourceLists()` always returns `[]` here — KNOWN AND ACCEPTED LIMITATION, not a bug: tool
 * arrays are structured object literals `bridge-content-source.ts`'s text-extraction heuristic
 * deliberately refuses to parse (see its module doc). The Tools detail panel renders empty in the
 * container build; sidebar per-root tool COUNTS still work because those come from
 * `PROMPT_KEY_TOOL_NAMES`, which is structural metadata (not prose) and stays bundled everywhere.
 */
export const bundledPromptContentSource: PromptContentSource = bridgeContentSource;

/**
 * Fragment symbols the inventory does not know (ADR-235 extraDocuments) — the same symbol→module
 * pairs `DEFAULT_MANIFEST` declares for the catalog, fed into the bridge prime so container mode
 * fetches exactly the files those documents live in (`packages/config/src/defaults.ts` for
 * DEFAULT_PERSONA is only bridge-readable because the manifest's contentRoots include it).
 */
const EXTRA_SYMBOL_MODULES: ReadonlyMap<string, string> = new Map(
  (DEFAULT_MANIFEST.extraDocuments ?? [])
    .filter(
      (document): document is typeof document & { source: { kind: 'symbol'; module: string; symbol: string } } =>
        document.source.kind === 'symbol',
    )
    .map((document) => [document.source.symbol, document.source.module]),
);

/**
 * Must be awaited once, before the catalog is first built (see `main.tsx`) — until
 * `bridgeContentSource.prime()` resolves, `getPromptText` returns `null` for every symbol, so the
 * container UI would otherwise render every prompt root's text empty on first paint.
 */
export async function primeContentSource(): Promise<void> {
  if (await installedCatalogSkipsSalirSources()) return;
  await bridgeContentSource.prime(EXTRA_SYMBOL_MODULES);
}
