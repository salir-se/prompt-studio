/**
 * Project (configuration) actions over the booted history layer (ADR-203/ADR-235): switch, create
 * (with baseline template seeding), duplicate (fork semantics), rename, delete, and "reset to
 * starting configuration" — plus `activateProject`, the shared tail that applies new history state
 * and resets the working state, and the top-bar History button's disabled-reason derivation.
 * Provider-call failures funnel to the error banner (visible, never silent). All moved verbatim
 * from App.tsx; the config-origin persistence (`config-origin.ts`) lives here with its callers.
 */

import { bundledBaselineContentSource } from '../catalog/baseline-content-source';
import {
  applyTemplate,
  resetConfigurationToStart,
  shippedTemplate,
  templateFromBaseline,
} from '../configurations/apply-template';
import { forgetConfigOrigin, loadConfigOrigin, saveConfigOrigin } from '../configurations/config-origin';
import { forgetSkillsOverride } from '../skills/skills-selection';
import type { Banners } from './use-banners';
import type { CommitSignal } from './use-commit-signal';
import type { DocumentEditor } from './use-document-editor';
import type { HistoryBoot, HistoryState } from './use-history-boot';
import type { VariablesRegistryApi } from './use-variables-registry';

export interface ProjectActionsDeps {
  boot: HistoryBoot;
  editor: DocumentEditor;
  registry: VariablesRegistryApi;
  banners: Banners;
  /** Bumped (in `signal`) whenever a fire-and-forget commit lands — reset does the same. */
  signal: CommitSignal;
  /** The App-level working-state reset `activateProject` performs after switching projects. */
  resetWorkingState: () => void;
}

export function useProjectActions({ boot, editor, registry, banners, signal, resetWorkingState }: ProjectActionsDeps) {
  const { history, setHistory, shippedTexts } = boot;

  /**
   * Applies `next` as the booted/active history state and resets the working state — the same
   * reset switching roots performs today. Nothing is lost: every Apply was already committed to the
   * previous project. A selected constant root reloads as the pristine baseline here and the heads
   * effect above swaps in the new project's committed head; a loaded VARIANT document gets the
   * same treatment under its own shipped variant text (variants carry per-project history under
   * the composite `rootId@variantSymbol` key, ADR-235). Without the variant branch a dirty
   * variant document kept the PREVIOUS configuration's text across the switch, and its next edit
   * committed that text into the new configuration — a cross-configuration leak.
   */
  function activateProject(next: HistoryState): void {
    const selectedRootId = editor.selectedRootId;
    // Only a prompt authored inside the configuration can disappear with it. A manifest or skill document that
    // carries a saved design is still listed by the catalog in every configuration, so it stays open.
    const selectedWasAuthored =
      editor.selectedRoot?.design !== undefined &&
      ![...boot.catalog, ...boot.skillRoots].some((root) => root.id === selectedRootId);
    setHistory(next);
    resetWorkingState();
    void boot.refreshAuthoredRoots(next.activeProjectId).then((roots) => {
      if (selectedWasAuthored && !roots.some((root) => root.id === selectedRootId)) {
        editor.clearDocument();
      }
    });
    if (editor.selectedRootId) registry.rebuildForRoot(editor.selectedRootId, next.activeProjectId);
    editor.reloadSelectedDocument();
  }

  /** Shared failure funnel for every picker-initiated provider call — visible, never silent. */
  function historyOpFailed(error: unknown): void {
    banners.setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  function switchProject(projectId: string): void {
    if (!history || projectId === history.activeProjectId) return;
    activateProject({ ...history, activeProjectId: projectId });
  }

  /** Create (no `from`) forks from the baseline; duplicate passes the source project as `from`. */
  /**
   * The picker's "New configuration" (ADR-235): create the project, then — for a reference
   * baseline — seed its texts as ordinary commits before switching to it. The shipped default
   * commits nothing (the project inherits the shipped baseline by construction). The chosen
   * origin persists per-project (config-origin.ts) so "Reset to starting configuration" can
   * rebuild the same starting point later.
   */
  function createProject(name: string, baselineId: string = 'default'): void {
    if (!history) return;
    const { provider } = history;

    provider
      .createProject(name)
      .then(async (created) => {
        // What ACTUALLY got seeded decides both the stored origin and the message: the picker
        // offers manifest-declared references even when the baselines projection failed to load
        // (the container's degraded mode), and a project created in that state is really the
        // shipped default — recording the missing reference as its origin would make a later
        // reset hunt for seed text that does not exist, and a success notice would contradict
        // (and, sharing the banner slot, erase) the error explaining the fallback.
        let seededFrom = 'default';
        let degradation: string | null = null;
        if (baselineId !== 'default') {
          const baseline = bundledBaselineContentSource.getBaselines().find((candidate) => candidate.id === baselineId);
          if (baseline) {
            await applyTemplate(provider, created.id, templateFromBaseline(baseline));
            seededFrom = baselineId;
          } else {
            degradation = `Starting configuration "${baselineId}" has no seed text available — created with the shipped default instead.`;
          }
        }
        saveConfigOrigin(created.id, seededFrom);
        const projects = await provider.listProjects();
        await provider.persist();
        activateProject({ provider, activeProjectId: created.id, projects });
        // Messages come AFTER activateProject — it resets the working state, which clears both
        // banners, so anything set earlier (the old code's error) was silently erased and only
        // the success notice ever showed.
        if (degradation !== null) {
          banners.setErrorMessage(degradation);
        } else if (seededFrom !== 'default') {
          banners.setNoticeMessage(`Created "${name}" from the ${seededFrom} reference configuration.`);
        }
      })
      .catch(historyOpFailed);
  }

  /**
   * Duplicate (ADR-203 fork semantics, unchanged): fork from the SOURCE PROJECT's heads — no
   * template seeding, the fork point IS the text. The duplicated configuration inherits the
   * source's stored origin, so a later "reset to starting point" rebuilds the same baseline the
   * source started from.
   */
  function duplicateProject(fromProjectId: string, name: string): void {
    if (!history) return;
    const { provider } = history;
    const sourceOrigin = loadConfigOrigin(fromProjectId);
    provider
      .createProject(name, fromProjectId)
      .then(async (created) => {
        saveConfigOrigin(created.id, sourceOrigin);
        const projects = await provider.listProjects();
        await provider.persist();
        activateProject({ provider, activeProjectId: created.id, projects });
      })
      .catch(historyOpFailed);
  }

  /**
   * "Reset <configuration> to its starting point" (ADR-235): every editable document back to its
   * shipped text, then the stored starting configuration's seed texts on top — all append-only
   * commits, so the operation is fully visible in History and individually restorable. The
   * picker double-confirms; the busy state is the shared error/notice banners.
   */
  function resetConfiguration(projectId: string): void {
    if (!history) return;
    const { provider, activeProjectId } = history;
    const originId = loadConfigOrigin(projectId);
    const baseline = bundledBaselineContentSource.getBaselines().find((candidate) => candidate.id === originId);
    const template = baseline !== undefined ? templateFromBaseline(baseline) : shippedTemplate();
    resetConfigurationToStart(provider, projectId, template, shippedTexts)
      .then(async (applied) => {
        await provider.persist();
        signal.markCommitLanded();
        // Resetting the ACTIVE project must also refresh the working document: a dirty doc is
        // deliberately never head-swapped (the pristine-only guard), so re-activate the project —
        // the same switch-project semantics (pristine shipped doc, then the new head swaps in).
        // An inactive project's reset needs nothing: its heads load on the next switch.
        if (projectId === activeProjectId) {
          activateProject({ ...history, provider, activeProjectId });
        }
        banners.setNoticeMessage(`Reset configuration — ${applied} reset commits written (see History).`);
      })
      .catch(historyOpFailed);
  }

  function renameProject(id: string, name: string): void {
    if (!history) return;
    const { provider, activeProjectId } = history;
    provider
      .renameProject(id, name)
      .then(async () => {
        const projects = await provider.listProjects();
        await provider.persist();
        setHistory({ provider, activeProjectId, projects });
      })
      .catch(historyOpFailed);
  }

  /** The picker disables deleting the last project; deleting the ACTIVE one switches to the first remaining. */
  function deleteProject(id: string): void {
    if (!history) return;
    const { provider, activeProjectId } = history;
    provider
      .deleteProject(id)
      .then(async () => {
        const projects = await provider.listProjects();
        await provider.persist();
        forgetConfigOrigin(id);
        forgetSkillsOverride(id);
        if (id === activeProjectId && projects.length > 0) {
          activateProject({ provider, activeProjectId: projects[0].id, projects });
        } else {
          setHistory({ provider, activeProjectId, projects });
        }
      })
      .catch(historyOpFailed);
  }

  /**
   * Why the top-bar History button is disabled (`undefined` when enabled — like Verify's tooltip).
   * History exists for constant roots and (ADR-235) resolver-VARIANT documents on a booted
   * provider; inline/external/unselected-variant roots still have none.
   */
  function historyDisabledReason(): string | undefined {
    if (!editor.doc) return 'Load a prompt root first.';
    const loadable =
      editor.selectedRoot?.loadability === 'constant' ||
      (editor.selectedRoot?.loadability === 'resolver-variants' && editor.doc.variantSymbol !== undefined);
    if (!loadable) {
      return 'History tracks editable documents only — this root has no per-project history.';
    }
    if (!history) return 'Prompt history is still booting.';
    return undefined;
  }

  return {
    activateProject,
    switchProject,
    createProject,
    duplicateProject,
    renameProject,
    deleteProject,
    resetConfiguration,
    historyDisabledReason,
  };
}

export type ProjectActions = ReturnType<typeof useProjectActions>;
