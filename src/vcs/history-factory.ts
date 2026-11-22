/**
 * History-provider factory (ADR-203): selects the implementation behind the single `HistoryProvider`
 * interface at boot. `'auto'` is CLAUDE.md's safe-fallback rule applied to a genuinely risky
 * dependency — the git provider runs isomorphic-git + memfs in the browser, and if it fails to load
 * or initialize in a given environment, the studio degrades to `SimpleHistoryProvider` with a logged,
 * visible reason instead of failing hard. Projects and history keep working; only git-specific depth
 * is lost.
 *
 * The git implementation is referenced ONLY through the lazy `loadGitProvider` hook (a dynamic
 * import supplied by the caller) — this module must never import isomorphic-git/memfs itself, so the
 * fallback path stays dependency-free and the provider choice stays swappable (ADR-203: no git
 * import outside the git provider's module).
 */

import type { HistoryProvider } from './history-provider';
import { SimpleHistoryProvider } from './simple-history-provider';
import type { SnapshotStore } from './snapshot-store';

/** Boot-time selection: a concrete implementation, or `'auto'` = try git, degrade to simple. */
export type HistoryProviderKind = 'git' | 'simple' | 'auto';

/** What the git provider module must export for the factory's lazy hook to construct it. */
export interface GitHistoryProviderModule {
  createGitHistoryProvider(store: SnapshotStore): HistoryProvider;
}

export interface CreateHistoryProviderDeps {
  /** Where the chosen provider persists/restores its snapshot. */
  readonly snapshotStore: SnapshotStore;
  /**
   * Lazy loader for the git provider module (typically `() => import('./git-history-provider')`).
   * Optional so the factory ships before the git task lands: absent means git is not wired yet.
   */
  readonly loadGitProvider?: () => Promise<GitHistoryProviderModule>;
  /** Called with the failure reason when `'auto'` degrades from git to simple — log it visibly. */
  readonly onDegrade?: (reason: string) => void;
}

/**
 * Creates the boot-selected `HistoryProvider`:
 *  - `'simple'` → `SimpleHistoryProvider`, always.
 *  - `'git'` → the git provider via `loadGitProvider`; a missing hook throws (`'git provider not
 *    wired yet'`) and any load/construct failure propagates — an EXPLICIT git choice never silently
 *    swaps implementations.
 *  - `'auto'` → try the git path exactly as `'git'` would; on ANY failure (including the hook being
 *    absent) report the reason through `onDegrade` and return `SimpleHistoryProvider`.
 */
export async function createHistoryProvider(
  kind: HistoryProviderKind,
  deps: CreateHistoryProviderDeps,
): Promise<HistoryProvider> {
  if (kind === 'simple') {
    return new SimpleHistoryProvider({ snapshotStore: deps.snapshotStore });
  }
  if (kind === 'git') {
    return loadGit(deps);
  }
  try {
    return await loadGit(deps);
  } catch (error) {
    deps.onDegrade?.(error instanceof Error ? error.message : String(error));
    return new SimpleHistoryProvider({ snapshotStore: deps.snapshotStore });
  }
}

/** The one git acquisition path both `'git'` and `'auto'` go through — only the failure policy differs. */
async function loadGit(deps: CreateHistoryProviderDeps): Promise<HistoryProvider> {
  if (!deps.loadGitProvider) {
    throw new Error('git provider not wired yet');
  }
  const module = await deps.loadGitProvider();
  return module.createGitHistoryProvider(deps.snapshotStore);
}
