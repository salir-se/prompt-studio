/**
 * The studio's boot (ADR-203 Stage C2 + ADR-235): ONE effect that resolves the active manifest,
 * loads the skill documents, boots the history provider, and lands the initial project list — plus
 * every state that boot owns (manifest, its file texts, skill roots, the booted `HistoryState`,
 * the 'auto'-degradation reason) and the derivations over them (catalog, allRoots, shippedTexts).
 * Extracted verbatim from App.tsx; see the boot effect's own comment for the ordering invariants
 * (skills load INSIDE the boot so the provider's first init seeds the full baseline).
 */

import { useEffect, useMemo, useState } from 'react';
import { buildRootCatalog, type CatalogRoot } from '../catalog/root-catalog';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { DEFAULT_MANIFEST } from '../manifest/default-manifest';
import { fetchActiveManifest, fetchManifestFileTexts } from '../manifest/fetch-manifest';
import type { WorkspaceProject } from '../prompt-repo/prompt-repo-client';
import { createWorkspacePrompt, readWorkspacePrompt } from '../prompt-repo/workspace-document';
import { loadSkillCatalogRoots } from '../skills/skill-catalog';
import { createHistoryProvider, type HistoryProviderKind } from '../vcs/history-factory';
import type { HistoryProvider, ProjectRef } from '../vcs/history-provider';
import { providerKeyFor } from '../vcs/provider-keys';
import { IndexedDbSnapshotStore, type SnapshotStore } from '../vcs/snapshot-store';

/**
 * Booted ADR-203 history layer, held as ONE nullable state atom: `null` while the provider boots,
 * after which the picker and auto-commit simply appear (no blocking spinner — the app renders as
 * before until history is ready). Kept as a single object so a project switch can never observe a
 * provider without its matching active-project id.
 */
export interface HistoryState {
  provider: HistoryProvider;
  activeProjectId: string;
  projects: readonly ProjectRef[];
}

/** Auto-created first project's display name (when the provider boots with no projects at all). */
const DEFAULT_PROJECT_NAME = 'Default';

/**
 * Every editable document's SHIPPED text, keyed exactly as the provider keys it (constants by
 * id, variants by `rootId@variant`, fragments by id). Pure derivation over the root list —
 * shared by the shipped-texts memo, the boot effect's baseline seeding (which builds its own
 * copy from the roots it has at boot time), and `handleResetConfiguration`'s "back to shipped
 * foundation" pass. One derivation, never two.
 */
function collectShippedTexts(roots: readonly CatalogRoot[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const root of roots) {
    if (root.loadability === 'constant') {
      texts.set(providerKeyFor(root.id), root.text ?? '');
    } else if (root.loadability === 'resolver-variants') {
      for (const variant of root.variants ?? []) {
        texts.set(providerKeyFor(root.id, variant.symbol), variant.text);
      }
    }
  }
  return texts;
}

export interface HistoryBootDeps {
  workspace?: WorkspaceProject;
  /** Test-only overrides from `AppProps` (see their docs there) — never change after mount. */
  historyProviderKind: HistoryProviderKind;
  snapshotStore?: SnapshotStore;
  /** Stable `useState` setter from `useBanners` — boot failures land in the error banner. */
  setErrorMessage: (message: string | null) => void;
}

export function useHistoryBoot({ historyProviderKind, snapshotStore, setErrorMessage, workspace }: HistoryBootDeps) {
  /**
   * The ACTIVE manifest (ADR-235): `DEFAULT_MANIFEST` until the boot's `fetchActiveManifest()`
   * replaces it with the server-resolved one (env override > baked copy > app tree — a
   * third-party operator's manifest drives the catalog, skills root, and picker baselines).
   * Until the fetch resolves the shipped default renders, so dev/test rendering is unchanged:
   * with no studio token (vitest) `fetchActiveManifest` IS the default manifest.
   */
  const [manifest, setManifest] = useState(DEFAULT_MANIFEST);
  /** File-sourced manifest documents' texts (bridge `.md` reads) — empty until boot fetched them. */
  const [manifestFileTexts, setManifestFileTexts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const catalog = useMemo(
    () => (workspace ? [] : buildRootCatalog(undefined, manifest, manifestFileTexts)),
    [manifest, manifestFileTexts, workspace],
  );

  /**
   * Skill documents (ADR-235, expectation 5): every SKILL.md under the manifest's skills root,
   * loaded through the bridge in dev AND container (one loading path — the dev server runs the
   * same /__studio plugin). Loaded INSIDE the history boot below so the provider's FIRST init
   * seeds the full baseline including skills — an effect re-run on late-arriving skills used to
   * re-boot the whole provider (discarding the active project selection and racing two provider
   * instances' persist() calls). Degrade-to-empty on any failure; once loaded they are ordinary
   * constant roots — selectable, editable, auto-committed, archived.
   */
  const [skillRoots, setSkillRoots] = useState<readonly CatalogRoot[]>([]);
  const [authoredRoots, setAuthoredRoots] = useState<readonly CatalogRoot[]>([]);

  /** The full sidebar/selection surface: inventory + manifest fragments + skill documents. */
  const allRoots = useMemo(() => {
    const workspaceSkills = new Set(
      workspace?.documents.filter((document) => document.group === 'skills').map((document) => document.id),
    );
    const roots = authoredRoots.map((root): CatalogRoot =>
      workspaceSkills.has(root.id) ? { ...root, group: 'skills' } : root,
    );
    return [...catalog, ...skillRoots, ...roots];
  }, [catalog, skillRoots, authoredRoots, workspace]);

  /** See {@link collectShippedTexts}. */
  const shippedTexts = useMemo(() => collectShippedTexts([...catalog, ...skillRoots]), [catalog, skillRoots]);

  // ADR-203 history layer — `null` until the boot effect below finishes (see `HistoryState`'s doc).
  const [history, setHistory] = useState<HistoryState | null>(null);
  // Non-null when the 'auto' boot degraded from git to simple — the dismissible amber banner's text.
  const [historyDegradedReason, setHistoryDegradedReason] = useState<string | null>(null);

  // History-provider boot (ADR-203 Stage C2). The kind is 'auto': try the lazily imported git
  // provider (isomorphic-git + memfs — it needs the browser `Buffer` shim, see `browser-globals.ts`),
  // and on ANY load/construct failure degrade to `SimpleHistoryProvider` with the reason surfaced as
  // the dismissible amber fallback banner — projects and history keep working either way. While
  // booting, `history` stays `null` and the app renders as before; the picker and auto-commit
  // appear when ready. A cancelled boot (unmount/StrictMode re-run) discards its provider instance.
  //
  // Skill documents load FIRST, inside the boot: the provider's init then seeds the FULL baseline
  // in one shot (both providers JOIN newly seen roots incrementally — pinned by the shared
  // contract suite), instead of a second boot re-running when a separate skills effect made
  // `shippedTexts` change identity. That second boot discarded the provider instance (resetting
  // the active project to the first-created one mid-session) and raced the two instances'
  // persist() calls — the last writer could drop a commit made against the other instance.
  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      // The ACTIVE manifest first — everything downstream (catalog, skills root, picker
      // baselines) is derived from it. Degrades to DEFAULT_MANIFEST on any failure, so this
      // never blocks the boot. The catalog is built LOCALLY from what this boot resolved (not
      // the state memo) so the provider's init always matches the roots the UI is about to show.
      const activeManifest = workspace
        ? { ...DEFAULT_MANIFEST, prompts: [], baselines: [] }
        : await fetchActiveManifest();
      if (cancelled) return;
      setManifest(activeManifest);
      const fileTexts = workspace ? new Map<string, string>() : await fetchManifestFileTexts(activeManifest);
      if (cancelled) return;
      setManifestFileTexts(fileTexts);
      const bootCatalog = workspace ? [] : buildRootCatalog(undefined, activeManifest, fileTexts);

      let loadedSkillRoots: readonly CatalogRoot[] = [];
      try {
        loadedSkillRoots = workspace ? [] : await loadSkillCatalogRoots(activeManifest.skillsRoot);
      } catch (error) {
        console.warn('[App] skill documents unavailable', error);
      }
      if (cancelled) return;
      setSkillRoots(loadedSkillRoots);

      const storage = snapshotStore ?? new IndexedDbSnapshotStore();
      const provider = await createHistoryProvider(historyProviderKind, {
        snapshotStore: workspace
          ? {
              load: (key) => storage.load(`${workspace.projectId}:${key}`),
              save: (key, value) => storage.save(`${workspace.projectId}:${key}`, value),
            }
          : storage,
        loadGitProvider: () => import('../vcs/git-history-provider'),
        onDegrade: (reason) => {
          if (!cancelled) setHistoryDegradedReason(reason);
        },
      });
      if (!workspace) await provider.restore();
      // `init` is idempotent AND incremental (both providers) — running it after a successful
      // restore joins roots newly shipped since the snapshot was written without duplicating
      // any existing seed.
      const seeds = collectShippedTexts([...bootCatalog, ...loadedSkillRoots]);
      if (workspace) {
        for (const document of workspace.documents) {
          const parsed = readWorkspacePrompt(document.text);
          const prompt = parsed ?? {
            ...createWorkspacePrompt({
              id: document.id,
              title: document.title,
              configuration: 'Default',
              tool: '',
              variable: '',
            }),
            text: document.text,
          };
          seeds.set(document.id, prompt.text);
          seeds.set(promptDesignProviderKey(document.id), serializePromptDesign(prompt.design));
        }
      }
      await provider.init(seeds);
      let projects = await provider.listProjects();
      if (projects.length === 0) {
        await provider.createProject(DEFAULT_PROJECT_NAME);
        projects = await provider.listProjects();
      }
      const activeProjectId = projects[0].id;
      const authored = authoredPromptRootsFromHeads(await provider.heads(activeProjectId));
      await provider.persist();
      // Default active project: the first existing one (creation order — `listProjects`' contract).
      if (!cancelled) {
        if (authored.errors.length > 0) setErrorMessage(authored.errors.join(' '));
        setAuthoredRoots(authored.roots);
        setHistory({ provider, activeProjectId, projects });
      }
    }
    boot().catch((error) => {
      if (!cancelled) {
        setErrorMessage(`Prompt history is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
    // `historyProviderKind`/`snapshotStore` are test-only overrides (see `AppProps`) that never
    // change after mount in production (no override at all) or within a single test's render, so
    // including them here is correctness, not a real re-run trigger. `catalog` is a `useMemo(…, [])`
    // constant — its identity never changes after mount, and the boot reads none of the
    // manifest-derived state (it resolves its own manifest and builds its own catalog snapshot),
    // so it runs exactly once. `shippedTexts`/`skillRoots`/`manifest` are deliberately NOT deps: the boot builds its own
    // baseline from the roots it loaded itself — re-running on a `shippedTexts` identity change is
    // exactly the second-boot bug the comment above describes. `setErrorMessage` is the stable
    // `useState` setter behind `useBanners`, so listing it never re-runs the boot.
  }, [historyProviderKind, snapshotStore, setErrorMessage, workspace]);

  return {
    manifest,
    catalog,
    allRoots,
    skillRoots,
    authoredRoots,
    shippedTexts,
    history,
    setHistory,
    async refreshAuthoredRoots(projectId: string): Promise<readonly CatalogRoot[]> {
      if (!history) return [];
      const authored = authoredPromptRootsFromHeads(await history.provider.heads(projectId));
      setAuthoredRoots(authored.roots);
      if (authored.errors.length > 0) setErrorMessage(authored.errors.join(' '));
      return authored.roots;
    },
    degradedReason: historyDegradedReason,
    dismissDegradation() {
      setHistoryDegradedReason(null);
    },
  };
}

export type HistoryBoot = ReturnType<typeof useHistoryBoot>;
