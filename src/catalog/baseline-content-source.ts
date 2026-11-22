/**
 * CONTAINER-BUILD variant of the `BaselineContentSource` seam (see `./baseline-content-source.ts`
 * for why the seam exists). Swapped in only for `bun run build:container` via `vite.config.ts`'s
 * conditional `resolve.alias`, exactly like `./prompt-content-source.container.ts` — same
 * build-time-module-swap rationale (a runtime branch would leave the statically-imported
 * reference prose reachable, and therefore emitted). This module imports NO prose: it fetches
 * `docs/prompts/generated/sales-mode-baselines.json` from the operator's mounted repo through the
 * read-only bridge — an allowed root, generated + drift-pinned by
 * `apps/eval/src/scripts/generate-sales-mode-baselines.ts` (ADR-235).
 *
 * `BaselineContent`/`BaselineContentSource` are re-declared here verbatim rather than imported
 * from `./baseline-content-source`: that specifier is exactly what the container build's alias
 * redirects to THIS file, so importing from it here would resolve back to this module. TypeScript's
 * structural typing makes the original and this copy interchangeable for every consumer (the
 * alias only affects Vite's bundler, never `tsgo`).
 */

import { installedCatalogSkipsSalirSources } from './salir-catalog-gate';

/** Mirrors `BaselineContent` in `./baseline-content-source.ts` — see this module's doc comment. */
export interface BaselineContent {
  readonly id: string;
  readonly version: number;
  readonly generationLabel: string;
  readonly prompts: Readonly<Record<string, string>>;
}

/** Mirrors `BaselineContentSource` in `./baseline-content-source.ts` — see this module's doc comment. */
export interface BaselineContentSource {
  getBaselines(): readonly BaselineContent[];
}

/** Path inside the operator's mounted repo; `docs/prompts` is a bridge-allowed root. */
const BASELINES_JSON_PATH = 'docs/prompts/generated/sales-mode-baselines.json';

/** Duplicated from `fs-bridge.ts` on purpose — see `bridge-content-source.ts`'s module doc. */
const STUDIO_TOKEN_HEADER = 'x-studio-token';

function readStudioToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

interface BaselineJsonRecord {
  id?: unknown;
  version?: unknown;
  generationLabel?: unknown;
  prompts?: unknown;
}

/** Narrow, never-throw parse of one JSON record; anything off-shape degrades to `null`. */
function parseBaseline(record: BaselineJsonRecord): BaselineContent | null {
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  if (typeof record.version !== 'number' || !Number.isFinite(record.version)) return null;
  if (typeof record.generationLabel !== 'string') return null;
  if (typeof record.prompts !== 'object' || record.prompts === null) return null;
  const prompts: Record<string, string> = {};
  for (const [slot, text] of Object.entries(record.prompts)) {
    if (typeof text !== 'string') return null;
    prompts[slot] = text;
  }
  return { id: record.id, version: record.version, generationLabel: record.generationLabel, prompts };
}

let baselines: readonly BaselineContent[] = [];

async function prime(): Promise<void> {
  // Reset FIRST: a re-prime whose fetch fails must leave the source empty (reflecting the
  // current mount), not silently serve a stale list from a previous successful prime.
  baselines = [];
  try {
    if (typeof fetch !== 'function') return;
    const token = readStudioToken();
    if (!token) {
      console.warn('[baseline-content-source] no studio-token meta tag; reference configurations unavailable');
      return;
    }
    if (await installedCatalogSkipsSalirSources()) return;
    const response = await fetch(`/__studio/file?path=${encodeURIComponent(BASELINES_JSON_PATH)}`, {
      headers: { [STUDIO_TOKEN_HEADER]: token },
    });
    if (!response.ok) {
      console.warn(`[baseline-content-source] bridge responded ${response.status} for "${BASELINES_JSON_PATH}"`);
      return;
    }
    const body = (await response.json()) as { ok?: boolean; text?: string };
    if (!body.ok || typeof body.text !== 'string') return;
    const parsed: unknown = JSON.parse(body.text);
    if (!Array.isArray(parsed)) return;
    baselines = parsed
      .map((record) => parseBaseline(record as BaselineJsonRecord))
      .filter((baseline): baseline is BaselineContent => baseline !== null);
  } catch (error) {
    // Degraded, not dead: an absent/corrupt projection leaves "New configuration from" with only
    // the shipped default, and the app keeps working. Logged once at prime time.
    console.warn('[baseline-content-source] failed to load reference baselines', error);
  }
}

/** Container-build binding of the seam's export name (mirrors the prompt-content pattern). */
export const bundledBaselineContentSource: BaselineContentSource = {
  getBaselines() {
    return baselines;
  },
};

/**
 * Must be awaited once before the first `getBaselines()` — see `main.tsx`'s prime ordering.
 * Re-priming re-fetches (deliberately no "already primed" guard): the single production call
 * site awaits once at boot, and tests need to prime repeatedly against different fetch stubs.
 */
export async function primeBaselineContentSource(): Promise<void> {
  await prime();
}
