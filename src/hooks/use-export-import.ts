/**
 * The ZIP round-trip (ADR-202 §9 Stage C + ADR-203 decision 5): the top bar's Export opens the
 * gated `ExportDialog` (fresh findings + undeclared-use through `buildExportPlan` — the hard
 * "declare before use" gate), confirm/force builds and downloads the blueprint overlay, the
 * ungated Project-archive button saves the whole active project, and the hidden file input behind
 * the top bar's Import applies EITHER flavor back — a blueprint overlay onto the selected root, or
 * a project archive as a newly created project. Owns the open-gate state and the hidden input ref.
 * All logic moved verbatim from App.tsx.
 */

import type { PromptVerificationFinding } from '@prompt-studio/prompts';
import { useRef, useState } from 'react';
import { promptDesignProviderKey, serializePromptDesign } from '../design/prompt-design-project';
import { applyImportedBlueprint, buildExportPlan, buildExportZip } from '../export/export-flow';
import type { ExportGateResult } from '../export/export-gate';
import {
  buildProjectArchive,
  isProjectArchive,
  PROJECT_ARCHIVE_ZIP_LIMITS,
  readProjectArchiveHeads,
} from '../export/project-archive';
import { DEFAULT_ZIP_LIMITS, unpackZip, ZipImportError } from '../export/zip';
import { runRootVerification } from '../panels/VerificationPanel';
import { isSkillDocumentId } from '../skills/skill-catalog';
import type { Banners } from './use-banners';
import type { DocumentEditor } from './use-document-editor';
import type { HistoryBoot } from './use-history-boot';
import type { PanelState } from './use-panel-state';
import type { ProjectActions } from './use-project-actions';
import { filterDeclaredKnownPlaceholderFindings, type VariablesRegistryApi } from './use-variables-registry';

/**
 * Downloads `bytes` as `filename` via a transient object URL + anchor click — the standard SPA
 * download path. Its own tiny helper so tests can spy on `URL.createObjectURL`/`revokeObjectURL`
 * instead of driving a real navigation.
 */
function triggerDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface ExportImportDeps {
  boot: HistoryBoot;
  editor: DocumentEditor;
  registry: VariablesRegistryApi;
  projects: ProjectActions;
  panels: PanelState;
  banners: Banners;
}

export function useExportImport({ boot, editor, registry, projects, panels, banners }: ExportImportDeps) {
  const { doc, tree, selectedRoot } = editor;
  const { catalog, history } = boot;
  // Non-null exactly while the export dialog is open — holds the gate `buildExportPlan` computed
  // at Export-click time so confirm/force acts on the same result the dialog displayed.
  const [exportGate, setExportGate] = useState<ExportGateResult | null>(null);
  // Hidden `<input type="file">` the top bar's Import button forwards its click to.
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * FRESH findings for the export gate — the same run the Verify button does (never the stale
   * `verificationResult` panel state), filtered the same way the panel displays them. A root
   * without a registered verification profile exports with `findings: []`.
   */
  function computeExportFindings(): readonly PromptVerificationFinding[] {
    if (!doc || !selectedRoot) return [];
    const fresh = filterDeclaredKnownPlaceholderFindings(
      runRootVerification(selectedRoot, doc.text),
      registry.registry,
    );
    return fresh?.findings ?? [];
  }

  function openExport(): void {
    if (!doc || !tree) return;
    // Skill documents are refused by the OVERLAY export (ADR-202 §6: the blueprint ZIP carries
    // skill MOUNTS, never bodies — the IP boundary that keeps the exported overlay shareable).
    // The ungated Project-archive button in the same dialog still carries them (a save-file of
    // the developer's own repo content).
    if (isSkillDocumentId(doc.rootId)) {
      banners.setErrorMessage(
        'Blueprint export covers prompt documents only — a skill document leaves through the Project archive (ADR-202 §6).',
      );
      return;
    }
    banners.clearMessages();
    panels.closePanel();
    const { gate } = buildExportPlan({
      tree,
      registry: registry.registry,
      docText: doc.text,
      findings: computeExportFindings(),
    });
    setExportGate(gate);
  }

  async function confirmExport(force: boolean): Promise<void> {
    if (!tree || !exportGate) return;
    try {
      const { bytes, filename } = await buildExportZip({
        tree,
        registry: registry.registry,
        gate: exportGate,
        force,
        design: selectedRoot?.design,
      });
      triggerDownload(bytes, filename);
      setExportGate(null);
    } catch (error) {
      setExportGate(null);
      banners.setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Ungated project-archive export (ADR-203 decision 5): the gate + force semantics govern the
   * repo OVERLAY only — a save-file of the user's own project (working tree plus history, fenced
   * under `prompt-project-<slug>/`) needs no export gate. Builds the ACTIVE project's archive via
   * `buildProjectArchive` and downloads it; the dialog closes on success and on failure alike.
   */
  async function exportProjectArchive(): Promise<void> {
    if (!history) return;
    const { provider, activeProjectId, projects: projectList } = history;
    try {
      const projectName = projectList.find((project) => project.id === activeProjectId)?.name ?? activeProjectId;
      const { bytes, filename } = await buildProjectArchive(provider, activeProjectId, projectName);
      triggerDownload(bytes, filename);
      setExportGate(null);
    } catch (error) {
      setExportGate(null);
      banners.setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function importClick(): void {
    banners.clearMessages();
    importInputRef.current?.click();
  }

  /**
   * Applies an imported PROJECT ARCHIVE (ADR-203 decision 5): reads the archive's per-root HEAD
   * texts, creates a fresh project named `<name> (imported)` (the provider's own slug uniqueness
   * de-duplicates repeats as `-2`, `-3`, …), commits each head onto it (`import archive`), and
   * switches to it. Heads-only by design — full-history import needs a provider interface
   * addition; meanwhile the archive's `.git` stays inspectable offline with ordinary git tooling
   * (see `project-archive.ts`'s module doc). Roots the archive carries that THIS build's catalog
   * does not know are skipped, with the count noted in the success notice.
   */
  async function importProjectArchive(files: Readonly<Record<string, string>>): Promise<void> {
    if (!history) {
      banners.setErrorMessage('Prompt history is still booting — retry the project-archive import in a moment.');
      return;
    }
    const { provider } = history;
    const { name, heads } = readProjectArchiveHeads(files);
    const created = await provider.createProject(`${name} (imported)`);
    const constantRootIds = new Set(catalog.filter((root) => root.loadability === 'constant').map((root) => root.id));
    let importedCount = 0;
    let skippedCount = 0;
    for (const [rootKey, text] of heads) {
      if (!constantRootIds.has(rootKey)) {
        skippedCount += 1;
        continue;
      }
      await provider.commit({ projectId: created.id, rootKey, text, message: 'import archive' });
      importedCount += 1;
    }
    await provider.persist();
    const projectList = await provider.listProjects();
    projects.activateProject({ provider, activeProjectId: created.id, projects: projectList });
    banners.setNoticeMessage(
      `Imported project "${created.name}" — ${importedCount} root${importedCount === 1 ? '' : 's'}` +
        `${skippedCount > 0 ? `; ${skippedCount} unknown root${skippedCount === 1 ? '' : 's'} skipped` : ''}.`,
    );
  }

  /**
   * Imports a ZIP from the hidden file input — EITHER flavor (ADR-203 decision 5): a blueprint
   * OVERLAY applies onto the selected root; a PROJECT ARCHIVE (everything under one
   * `prompt-project-<slug>/` top dir) becomes a new project via `importProjectArchive`. The bytes
   * are unpacked ONCE with `PROJECT_ARCHIVE_ZIP_LIMITS` — safe because those limits only WIDEN the
   * overlay tier's bounds, and the overlay's tighter entry-count bound is re-checked manually right
   * after flavor detection, so an entry-bomb "overlay" cannot ride in on the project flavor's
   * headroom. (The byte-bomb bounds still reject pre-inflation, at the project tier's 8 MiB/entry,
   * 64 MiB total.) Overlay flavor: undoable text replacement plus a merge of the archive's SESSION
   * variables through `declareVariable` (an already-declared name is simply skipped — the local
   * declaration wins, duplicates are fine to skip). Any failure (`ZipImportError`,
   * `BlueprintParseError`, `ProjectArchiveError`, root mismatch) lands in the error banner and the
   * document is never touched.
   */
  async function importFile(file: File): Promise<void> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const files = unpackZip(bytes, PROJECT_ARCHIVE_ZIP_LIMITS);
      if (isProjectArchive(files)) {
        await importProjectArchive(files);
        return;
      }
      if (!doc) {
        banners.setErrorMessage('Select a prompt, then import the blueprint again.');
        return;
      }
      // Keep the overlay's stricter entry bound honest despite the single wider unpack above.
      if (Object.keys(files).length > DEFAULT_ZIP_LIMITS.maxEntries) {
        throw new ZipImportError('too-many-entries', `Archive has more than ${DEFAULT_ZIP_LIMITS.maxEntries} entries.`);
      }
      const { text, variables, design } = applyImportedBlueprint({ files, expectedRoot: doc.rootId });
      editor.commitUndoableEdit(text, 'import blueprint');
      registry.mergeSessionVariables(variables, doc.rootId);
      if (design && history) {
        await history.provider.commit({
          projectId: history.activeProjectId,
          rootKey: promptDesignProviderKey(design.id),
          text: serializePromptDesign(design),
          message: `import prompt design ${design.id}@${design.version}`,
        });
        await history.provider.persist();
        await boot.refreshAuthoredRoots(history.activeProjectId);
      }
      banners.setNoticeMessage(
        `Imported blueprint for "${doc.rootId}" — ${variables.length} session variable${
          variables.length === 1 ? '' : 's'
        } merged.`,
      );
    } catch (error) {
      banners.setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /** The hidden input's change handler — clearing `value` after each pick lets the same file be
   *  re-imported (the change event would not re-fire otherwise). */
  function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void importFile(file);
  }

  /** Closes the export dialog (cancel / working-state reset). */
  function close(): void {
    setExportGate(null);
  }

  return {
    exportGate,
    openExport,
    confirmExport,
    exportProjectArchive,
    importClick,
    importInputRef,
    handleFilePicked,
    close,
  };
}

export type ExportImport = ReturnType<typeof useExportImport>;
