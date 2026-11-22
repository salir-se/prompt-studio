import { promptSectionId } from '@prompt-studio/prompts';
import { useRef, useState } from 'react';
import { DeveloperProjectPicker } from './DeveloperProjectPicker';
import { StudioOverlays } from './StudioOverlays';
import { usePromptAdoption } from './adoption/use-prompt-adoption';
import type { CatalogRoot, CatalogVariant } from './catalog/root-catalog';
import { AppBanners } from './components/AppBanners';
import { ProjectSaveStatus } from './components/ProjectSaveStatus';
import { PromptExplorer } from './components/PromptExplorer';
import { PromptOutline } from './components/PromptOutline';
import { PromptWriter } from './components/PromptWriter';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { StudioEmptyState } from './components/StudioEmptyState';
import { TopBar } from './components/TopBar';
import type { PromptComposerHandle } from './composing/PromptComposer';
import { useAppControlChannel } from './control/use-app-control-channel';
import type { EditorEvent } from './control/editor-resource';
import { useBanners } from './hooks/use-banners';
import { useCommitSignal } from './hooks/use-commit-signal';
import { useDocumentEditor } from './hooks/use-document-editor';
import { useExplorerState } from './hooks/use-explorer-state';
import { useExportImport } from './hooks/use-export-import';
import { useHistoryBoot } from './hooks/use-history-boot';
import { useHistoryDrawer } from './hooks/use-history-drawer';
import { useNodeSelection } from './hooks/use-node-selection';
import { usePanelState } from './hooks/use-panel-state';
import { useProjectActions } from './hooks/use-project-actions';
import { usePromptDraft, usePromptSaveShortcut } from './hooks/use-prompt-draft';
import { useSkillsSelection } from './hooks/use-skills-selection';
import { useStructureEdits } from './hooks/use-structure-edits';
import { useStudioShortcuts } from './hooks/use-studio-shortcuts';
import { filterDeclaredKnownPlaceholderFindings, useVariablesRegistry } from './hooks/use-variables-registry';
import { useVerificationWorkspace } from './hooks/use-verification-workspace';
import { WHOLE_PROMPT } from './panels/verification/verification-editing';
import type { WorkspaceProjectController } from './hooks/use-workspace-project';
import { verifyDisabledReason } from './panels/VerificationPanel';
import { createPromptAuthoringActions } from './prompt-authoring-actions';
import { downloadProjectJson } from './prompt-repo/PromptRepoPanel';
import { workspaceFileForRoot } from './prompt-repo/workspace-document';
import { ProjectGraphWorkspace } from './references/ProjectGraphWorkspace';
import { useProjectFileEditor } from './references/use-project-file-editor';
import type { HistoryProviderKind } from './vcs/history-factory';
import type { SnapshotStore } from './vcs/snapshot-store';

export interface AppProps {
  historyProviderKind?: HistoryProviderKind;
  snapshotStore?: SnapshotStore;
}

export function StudioEditor({
  historyProviderKind = 'auto',
  snapshotStore,
  workspace,
}: AppProps & { workspace: WorkspaceProjectController }): React.JSX.Element {
  const { project } = workspace;
  const [initialWorkspace] = useState(project ?? undefined);
  const banners = useBanners();
  const { setErrorMessage } = banners;
  const [view, setView] = useState<'write' | 'graph'>(project ? 'write' : 'graph');
  const explorer = useExplorerState();
  const writer = useRef<PromptComposerHandle>(null);
  const [newPromptOpen, setNewPromptOpen] = useState(false);
  const [designSectionId, setDesignSectionId] = useState<string>();
  const [projectSection, setProjectSection] = useState<'project' | 'versions' | 'share'>('project');

  const boot = useHistoryBoot({ historyProviderKind, snapshotStore, setErrorMessage, workspace: initialWorkspace });
  const { manifest, allRoots, history } = boot;
  const signal = useCommitSignal();
  const editor = useDocumentEditor({
    boot,
    signal,
    setErrorMessage,
    saveDocument: project
      ? async (root, text) => {
          const existing = project?.documents.find((document) => document.id === root.id);
          const file = workspaceFileForRoot(root, text, existing);
          await workspace.draft({ documents: [file] });
        }
      : undefined,
  });
  const { doc, selectedRoot, tree, model } = editor;
  const [editorEvents, setEditorEvents] = useState<readonly EditorEvent[]>([]);
  function recordEditorEvent(action: EditorEvent['action'], rootId = doc?.rootId ?? null) {
    const next = { action, rootId, at: new Date().toISOString() };
    setEditorEvents((current) => {
      const previous = current.at(-1);
      const sameEdit = action === 'document.edited' && previous?.action === action && previous.rootId === rootId;
      const retained = sameEdit ? current.slice(0, -1) : current;
      return [...retained.slice(-19), next];
    });
  }
  const writing = usePromptDraft({
    document: doc,
    onApply(text, message) {
      editor.commitUndoableEdit(text, message);
      recordEditorEvent('document.applied');
    },
    onError: setErrorMessage,
  });
  const selection = useNodeSelection({ editor, banners });
  const referenceEditor = useProjectFileEditor(workspace, boot, editor, () => selection.selectNode(undefined));
  const panels = usePanelState(writing, referenceEditor);
  const { activePanel, openPanel, closePanel } = panels;

  const structure = useStructureEdits({ editor });
  const registry = useVariablesRegistry({ boot, editor, projectDefinitions: project?.definitions });
  const skills = useSkillsSelection({ boot, editor });

  const projects = useProjectActions({ boot, editor, registry, banners, signal, resetWorkingState });
  const drawer = useHistoryDrawer({ boot, editor, panels, signal, banners });
  const transfer = useExportImport({ boot, editor, registry, projects, panels, banners });

  const verificationWorkspace = useVerificationWorkspace({
    editor,
    workspace,
    panels,
    result: registry.displayedVerificationResult,
  });
  const attributedVerification = verificationWorkspace.attributed;

  function resetWorkingState(): void {
    selection.resetSelection();
    editor.discardWorkingState();
    banners.clearMessages();
    panels.closePanel();
    transfer.close();
    setDesignSectionId(undefined);
  }

  function handleSelectRoot(root: CatalogRoot): boolean {
    if (root.id === editor.selectedRootId && !activePanel) {
      explorer.reset();
      return true;
    }
    if (!panels.confirmDiscard()) return false;
    resetWorkingState();
    registry.rebuildForRoot(root.id, history?.activeProjectId ?? null);
    editor.loadDocument(root);
    explorer.reset();
    return true;
  }

  function handleSelectVariant(root: CatalogRoot, variant: CatalogVariant): boolean {
    if (doc?.rootId === root.id && doc.variantSymbol === variant.symbol && !activePanel) {
      explorer.reset();
      return true;
    }
    if (!panels.confirmDiscard()) return false;
    resetWorkingState();
    registry.rebuildForRoot(root.id, history?.activeProjectId ?? null);
    editor.loadDocument(root, variant);
    return true;
  }

  function handleRemoveSection(nodeId: string): boolean {
    const removed = structure.removeSection(nodeId);
    if (removed) selection.handleNodeRemoved(nodeId);
    return removed;
  }

  function handleCreatePrompt(): void {
    if (closePanel()) setNewPromptOpen(true);
  }

  function handleOpenSectionDesign(nodeId: string): void {
    const node = model.nodes.find((candidate) => candidate.id === nodeId);
    if (!selectedRoot?.design || node?.data.kind !== 'section') return;
    if (!panels.confirmDiscard()) return;
    setDesignSectionId(
      node.data.node.id === 'prose-document' ? undefined : promptSectionId(selectedRoot.id, node.data.node),
    );
    openPanel('design');
  }

  const authoring = createPromptAuthoringActions({
    boot,
    editor,
    workspace,
    banners,
    onCreated(root) {
      setNewPromptOpen(false);
      handleSelectRoot(root);
      setView('write');
    },
  });

  useAppControlChannel({
    roots: allRoots,
    loadedDocument: doc,
    projects: history?.projects ?? null,
    activeProjectId: history?.activeProjectId ?? null,
    provider: history?.provider ?? null,
    activeView: view,
    editorDraft: writing,
    editorEvents,
    selectRoot: (rootId) => {
      const root = allRoots.find((candidate) => candidate.id === rootId);
      return root !== undefined && handleSelectRoot(root);
    },
    selectVariant: (rootId, variantSymbol) => {
      const root = allRoots.find((candidate) => candidate.id === rootId);
      const variant = root?.variants?.find((candidate) => candidate.symbol === variantSymbol);
      return root !== undefined && variant !== undefined && handleSelectVariant(root, variant);
    },
    replaceLoadedText: (text, message) => {
      if (doc === null || !panels.confirmDiscard()) return false;
      editor.replaceDocumentText(text, message);
      return true;
    },
    resetLoadedToShipped: () => {
      if (!panels.confirmDiscard()) return false;
      editor.resetToShipped();
      return true;
    },
    createProject: (name, baselineId) => {
      if (!closePanel()) return false;
      projects.createProject(name, baselineId);
      return true;
    },
    switchProject: (projectId) => {
      if (!closePanel()) return false;
      projects.switchProject(projectId);
      return true;
    },
    sections: {
      loadedDocument: doc,
      tree,
      confirmDiscard: panels.confirmDiscard,
      structure: { ...structure, removeSection: handleRemoveSection },
    },
    design: {
      loadedDocument: doc,
      tree,
      design: selectedRoot?.design,
      confirmDiscard: panels.confirmDiscard,
      saveDesign: authoring.saveDesign,
      showDesign: (designSection) => {
        setDesignSectionId(designSection);
        openPanel('design');
      },
    },
    verification: {
      loadedDocument: doc,
      tree,
      root: selectedRoot,
      latest: verificationWorkspace.latest,
      runChecks: () => {
        const run = verificationWorkspace.open(WHOLE_PROMPT, 'findings');
        return run && filterDeclaredKnownPlaceholderFindings(run, registry.registry);
      },
      semantic: verificationWorkspace.semantic,
      proposals: verificationWorkspace.proposals.proposals,
      addProposal: verificationWorkspace.proposals.add,
      showChecks: (scope) => verificationWorkspace.open(scope, 'checks') !== null,
    },
    evaluation:
      verificationWorkspace.project && doc
        ? {
            ...verificationWorkspace.project,
            rootId: doc.rootId,
            source: writing.text,
            draft: writing.dirty,
            projectPending: verificationWorkspace.pending,
          }
        : undefined,
  });

  const adoption = usePromptAdoption({
    boot,
    editor,
    workspace,
    canOpen: closePanel,
    onAdopted(root, input) {
      resetWorkingState();
      registry.rebuildForRoot(root.id, history?.activeProjectId ?? null);
      editor.openVerifiedDocument(root);
      setView('write');
      openPanel('verify');
      banners.setNoticeMessage(
        `Saved "${root.title}" with ${input.design.sectionDesigns.length} native sections. Review verification findings.`,
      );
    },
  });
  usePromptSaveShortcut(
    view === 'write' &&
      !activePanel &&
      !newPromptOpen &&
      adoption.initial === undefined &&
      !selection.editingRoot &&
      !selection.editingSection,
    writing,
  );
  function changeView(to: 'write' | 'graph') {
    if (!(to === 'write' ? panels.closePanelKeepingWriting() : closePanel())) return false;
    setView(to);
    return true;
  }
  useStudioShortcuts({
    enabled: adoption.initial === undefined && !newPromptOpen,
    addExisting: project ? () => adoption.open() : undefined,
    explorer: explorer.toggle,
    changeView,
    verify: verificationWorkspace.open,
  });

  const isDirty = doc !== null && doc.text !== doc.originalText;

  return (
    <div className="flex h-dvh flex-col">
      <div
        inert={workspace.busy || panels.modal}
        className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      >
        <ProjectSaveStatus
          project={project}
          pending={workspace.pending}
          error={workspace.error}
          requiredTools={selectedRoot?.design?.tools ?? []}
          onRetry={() => {
            void workspace
              .retry({ keepEditor: true })
              .then(async () => {
                if (history) await boot.refreshAuthoredRoots(history.activeProjectId);
              })
              .catch((error) => setErrorMessage(String(error)));
          }}
          onOpenTools={() => openPanel('tools')}
        />
        <TopBar
          view={view}
          activePanel={activePanel}
          onViewChange={changeView}
          onBrowsePrompts={explorer.toggle}
          explorerOpen={explorer.open}
          selectedRoot={selectedRoot}
          isDirty={isDirty}
          persistence={project ? 'workspace' : 'browser'}
          canUndo={editor.canUndo}
          onUndo={() => {
            if (panels.confirmDiscard()) editor.undo();
          }}
          projectPicker={
            <DeveloperProjectPicker
              history={project ? null : history}
              baselines={manifest.baselines}
              actions={projects}
              canChange={closePanel}
            />
          }
          onAddExisting={project && history ? () => adoption.open() : undefined}
          onAdaptDocument={project && doc && selectedRoot?.design ? () => adoption.open(true) : undefined}
          canCreatePrompt={history !== null}
          onCreatePrompt={handleCreatePrompt}
          canOpenDesign={selectedRoot?.design !== undefined}
          onOpenDesign={() => {
            if (activePanel === 'design' && designSectionId === undefined) return;
            if (!panels.confirmDiscard()) return;
            setDesignSectionId(undefined);
            openPanel('design');
          }}
          onOpenRun={project && doc ? () => openPanel('run') : undefined}
          onOpenEvaluations={project && doc ? () => verificationWorkspace.toggleEvaluations() : undefined}
          canOpenFinalPrompt={doc !== null && selectedRoot !== undefined}
          onOpenFinalPrompt={() => openPanel('final-prompt')}
          onOpenTools={() => openPanel('tools')}
          onOpenVariables={() => openPanel('variables')}
          verifyDisabledReason={verifyDisabledReason(selectedRoot)}
          onVerify={() => verificationWorkspace.open()}
          historyDisabledReason={projects.historyDisabledReason()}
          onOpenHistory={drawer.openHistory}
          helpOpen={activePanel === 'help'}
          onOpenHelp={() => (activePanel === 'help' ? closePanel() : openPanel('help'))}
          canExport={project !== null || (doc !== null && tree !== null)}
          onExport={() => {
            if (!panels.confirmDiscard()) return;
            if (project) {
              void workspace
                .exportProject()
                .then((archive) => downloadProjectJson(archive, 'prompt-studio-project.json'))
                .catch((error) => setErrorMessage(String(error)));
            } else transfer.openExport();
          }}
          onImport={
            project
              ? () => {
                  if (openPanel('prompts')) setProjectSection('project');
                }
              : () => {
                  if (closePanel()) transfer.importClick();
                }
          }
          onOpenPrompts={() => {
            if (activePanel === 'prompts') closePanel();
            else if (openPanel('prompts')) setProjectSection('project');
          }}
          onOpenVersions={
            project
              ? () => {
                  if (openPanel('prompts')) setProjectSection('versions');
                }
              : undefined
          }
          onOpenShare={
            project
              ? () => {
                  if (openPanel('prompts')) setProjectSection('share');
                }
              : undefined
          }
        />

        <div className="relative flex min-h-0 flex-1">
          <PromptExplorer open={explorer.open} drawer={explorer.drawer} onClose={explorer.close}>
            <Sidebar
              outline={
                tree && (
                  <PromptOutline
                    key={`${doc?.rootId}@${doc?.variantSymbol ?? ''}`}
                    sections={tree.children}
                    selectedNodeId={selection.selectedNodeId}
                    onSelect={(id) => {
                      selection.selectNode(id);
                      if (view === 'write' && !activePanel) {
                        if (explorer.drawer) explorer.close();
                        writer.current?.revealSection(id.replace(/^section:/, ''), explorer.drawer);
                      }
                    }}
                    onEdit={(id) => {
                      if (panels.confirmDiscard()) selection.beginEditNode(id);
                    }}
                    onDesign={selectedRoot?.design ? handleOpenSectionDesign : undefined}
                    onAddAfter={(id, name) => {
                      if (panels.confirmDiscard()) structure.addSiblingSection(id, name);
                    }}
                    onAddChild={(id, name) => {
                      if (panels.confirmDiscard()) structure.addChildSection(id, name);
                    }}
                    onMove={(id, direction) => {
                      if (panels.confirmDiscard()) structure.moveSection(id, direction);
                    }}
                    onRemove={(id) => {
                      if (panels.confirmDiscard()) handleRemoveSection(id);
                    }}
                  />
                )
              }
              catalog={allRoots}
              selectedRootId={editor.selectedRootId}
              selectedVariantSymbol={doc?.variantSymbol}
              onSelectRoot={(root) => {
                if (handleSelectRoot(root)) recordEditorEvent('document.opened', root.id);
              }}
              onSelectVariant={handleSelectVariant}
              canCreatePrompt={history !== null}
              onCreatePrompt={handleCreatePrompt}
            />
          </PromptExplorer>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!doc && (
              <StudioEmptyState
                canCreate={history !== null}
                onCreate={handleCreatePrompt}
                onOpenProject={() => openPanel('prompts')}
              />
            )}
            {doc && view === 'write' && !selection.editingSection && !selection.editingRoot && (
              <PromptWriter
                ref={writer}
                key={writing.key}
                text={writing.text}
                dirty={writing.dirty}
                stale={writing.stale}
                variables={registry.knownVariables}
                tools={selectedRoot?.toolNames ?? []}
                workflow={selectedRoot?.design?.workflow}
                onChange={(text) => {
                  writing.change(text);
                  recordEditorEvent('document.edited');
                }}
                onApply={writing.apply}
                onDiscard={writing.discard}
              />
            )}
            <div className={doc && view === 'graph' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
              <ProjectGraphWorkspace
                key={view}
                inspectorHidden={activePanel !== null}
                onCloseInspector={() => selection.selectNode(undefined)}
                selectedNode={!activePanel ? selection.selectedGraphNode : undefined}
                selectedRoot={selectedRoot}
                onDesignSection={selectedRoot?.design ? handleOpenSectionDesign : undefined}
                fileEditor={referenceEditor}
                project={project}
                model={model}
                selectedNodeId={selection.selectedNodeId}
                onSelectNode={selection.selectNode}
                onEditNode={selection.beginEditNode}
                verificationByNodeId={attributedVerification?.verificationByNodeId}
                coverageByNodeId={verificationWorkspace.coverage?.byNodeId}
                onOpenVerification={verificationWorkspace.open}
                onAddSiblingSection={structure.addSiblingSection}
                onAddChildSection={structure.addChildSection}
                onRemoveSection={handleRemoveSection}
                onMoveSection={structure.moveSection}
              />
            </div>
          </main>
        </div>

        <StatusBar
          diagnosticsCount={tree?.diagnostics.length ?? 0}
          nodeCount={model.nodes.length}
          edgeCount={model.edges.length}
          text={doc?.text ?? ''}
          verificationFindingsCount={registry.displayedVerificationResult?.findings.length ?? null}
          undeclaredCount={registry.undeclaredNames.length}
          onOpenUndeclared={() => openPanel('variables')}
          docLevelFindingsCount={attributedVerification?.documentLevelCount ?? 0}
          onOpenVerifyDrawer={() => verificationWorkspace.open()}
        />
      </div>

      <div inert={workspace.busy || panels.modal}>
        <AppBanners
          errorMessage={banners.errorMessage}
          noticeMessage={banners.noticeMessage}
          degradedReason={boot.degradedReason}
          onDismissDegraded={boot.dismissDegradation}
          onDismissNotice={() => banners.setNoticeMessage(null)}
          onDismissError={() => banners.setErrorMessage(null)}
        />
      </div>
      <StudioOverlays
        verificationWorkspace={verificationWorkspace}
        adoption={adoption}
        panels={panels}
        workspace={workspace}
        boot={boot}
        editor={editor}
        registry={registry}
        skills={skills}
        drawer={drawer}
        transfer={transfer}
        banners={banners}
        selection={selection}
        newPromptOpen={newPromptOpen}
        runSource={writing.text}
        runDraft={writing.dirty}
        designSectionId={designSectionId}
        onCreatePrompt={authoring.create}
        onCancelCreate={() => setNewPromptOpen(false)}
        onSaveDesign={authoring.saveDesign}
        onEditorEvent={recordEditorEvent}
        projectSection={projectSection}
        onProjectSectionChange={setProjectSection}
      />
    </div>
  );
}
