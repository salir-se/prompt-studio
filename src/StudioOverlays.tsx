import { FragmentEditDialog } from '@prompt-studio/prompt-graph-ui';
import type { PromptDesign } from '@prompt-studio/prompts';
import { AdoptPromptDialog } from './adoption/AdoptPromptDialog';
import type { PromptAdoption } from './adoption/use-prompt-adoption';
import { StudioPanelFocus } from './components/StudioPanelFocus';
import { NewPromptDialog, type NewPromptInput } from './design/NewPromptDialog';
import { ExportDialog } from './export/ExportDialog';
import { buildExportPreviewPaths, selectExportVariables } from './export/export-flow';
import { HelpPanel } from './help/HelpPanel';
import type { Banners } from './hooks/use-banners';
import type { DocumentEditor } from './hooks/use-document-editor';
import type { ExportImport } from './hooks/use-export-import';
import type { HistoryBoot } from './hooks/use-history-boot';
import type { HistoryDrawer } from './hooks/use-history-drawer';
import type { NodeSelection } from './hooks/use-node-selection';
import type { PanelState } from './hooks/use-panel-state';
import type { SkillsSelection } from './hooks/use-skills-selection';
import type { VariablesRegistryApi } from './hooks/use-variables-registry';
import type { VerificationWorkspace } from './hooks/use-verification-workspace';
import type { WorkspaceProjectController } from './hooks/use-workspace-project';
import { FinalPromptPanel } from './panels/FinalPromptPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { PromptDesignPanel } from './panels/PromptDesignPanel';
import { ToolsPanel } from './panels/ToolsPanel';
import { VariablesPanel } from './panels/VariablesPanel';
import { VerificationPanel } from './panels/VerificationPanel';
import { createVerificationActions } from './prompt-authoring-actions';
import { ProjectDefinitionsPanel } from './prompt-repo/ProjectDefinitionsPanel';
import { type ProjectSection, PromptRepoPanel } from './prompt-repo/PromptRepoPanel';
import { readWorkspacePrompt } from './prompt-repo/workspace-document';
import { RunWorkspace } from './run/RunWorkspace';
import { useShortcutEducation } from './shortcuts/shortcut-context';

interface StudioOverlaysProps {
  verificationWorkspace: VerificationWorkspace;
  adoption: PromptAdoption;
  panels: PanelState;
  workspace: WorkspaceProjectController;
  boot: HistoryBoot;
  editor: DocumentEditor;
  registry: VariablesRegistryApi;
  skills: SkillsSelection;
  drawer: HistoryDrawer;
  transfer: ExportImport;
  banners: Banners;
  selection: NodeSelection;
  runSource: string;
  runDraft: boolean;
  newPromptOpen: boolean;
  designSectionId: string | undefined;
  onCreatePrompt: (input: NewPromptInput) => Promise<void>;
  onCancelCreate: () => void;
  onSaveDesign: (design: PromptDesign) => Promise<void>;
  projectSection: ProjectSection;
  onProjectSectionChange: (section: ProjectSection) => void;
}

/** Drawer/dialog composition; document and persistence ownership remain in the editor hooks. */
export function StudioOverlays({
  verificationWorkspace,
  adoption,
  panels,
  workspace,
  boot,
  editor,
  registry,
  skills,
  drawer,
  transfer,
  banners,
  selection,
  runSource,
  runDraft,
  newPromptOpen,
  designSectionId,
  onCreatePrompt,
  onCancelCreate,
  onSaveDesign,
  projectSection,
  onProjectSectionChange,
}: StudioOverlaysProps) {
  const education = useShortcutEducation();
  const { activePanel, dismissPanel: closePanel } = panels;
  const { manifest, allRoots, history } = boot;
  const { selectedRoot, doc, tree } = editor;
  const runDocument = workspace.project?.documents.find((document) => document.id === doc?.rootId);
  const verification = createVerificationActions({ editor, workspace, banners, onSaveDesign });
  return (
    <StudioPanelFocus modal={panels.modal}>
      {(activePanel === 'run' || panels.retainedEvaluation) && workspace.project && runDocument && (
        <RunWorkspace
          key={`${workspace.project.projectId}:${runDocument.path}:${panels.retainedEvaluation ? 'evaluate' : 'run'}`}
          dock={panels.retainedEvaluation}
          hidden={panels.retainedEvaluation && activePanel !== 'evaluate'}
          initialTab={panels.retainedEvaluation ? verificationWorkspace.runTab : 'single'}
          onOpenEvaluations={activePanel === 'run' ? () => verificationWorkspace.openEvaluations() : undefined}
          project={workspace.project}
          promptPath={runDocument.path}
          source={runSource}
          draft={runDraft}
          projectPending={!!workspace.pending || !!workspace.error}
          onClose={closePanel}
          onDirtyChange={panels.onDirtyChange}
        />
      )}
      {activePanel === 'prompts' && (
        <PromptRepoPanel
          workspace={workspace}
          onClose={closePanel}
          section={projectSection}
          onSectionChange={onProjectSectionChange}
        />
      )}
      {activePanel === 'help' && (
        <HelpPanel
          onDirtyChange={panels.onDirtyChange}
          context={{
            manifestName: manifest.name,
            rootCount: allRoots.length,
            selectedRootTitle: selectedRoot?.title ?? null,
          }}
          onClose={closePanel}
        />
      )}
      {activePanel === 'final-prompt' && doc && selectedRoot && (
        <FinalPromptPanel
          root={selectedRoot}
          text={doc.text}
          previewText={registry.finalPromptText}
          injectedSkills={skills.injectedSkills}
          availableSkills={skills.availableSkills}
          onToggleSkill={skills.toggleSkill}
          onClose={closePanel}
        />
      )}
      {activePanel === 'tools' && !workspace.project && (
        <ToolsPanel onClose={closePanel} usedToolNames={selectedRoot?.toolNames} />
      )}
      {workspace.project && (activePanel === 'tools' || activePanel === 'variables') && (
        <ProjectDefinitionsPanel
          key={`${workspace.project.projectId}:${activePanel}`}
          kind={activePanel}
          definitions={workspace.project.definitions}
          onSave={(definitions) => workspace.draft({ definitions })}
          onDirtyChange={panels.onDirtyChange}
          onClose={closePanel}
          references={Object.fromEntries(
            [...workspace.project.definitions.variables, ...workspace.project.definitions.tools].map((entry) => [
              entry.name,
              workspace
                .project!.documents.filter((document) => {
                  const stored = readWorkspacePrompt(document.text);
                  const selected = doc?.rootId === document.id;
                  const text = selected ? doc.text : (stored?.text ?? document.text);
                  const design = selected ? (selectedRoot?.design ?? stored?.design) : stored?.design;
                  return (
                    text.includes(`{{${entry.name}}}`) ||
                    design?.tools.includes(entry.name) ||
                    design?.variables.some((variable) => variable.name === entry.name)
                  );
                })
                .map((document) => readWorkspacePrompt(document.text)?.design.title ?? document.title),
            ]),
          )}
        />
      )}
      {activePanel === 'design' && doc && selectedRoot?.design && (
        <PromptDesignPanel
          design={selectedRoot.design}
          text={doc.text}
          sectionId={designSectionId}
          onDirtyChange={panels.onDirtyChange}
          onSave={onSaveDesign}
          onClose={closePanel}
        />
      )}
      {activePanel === 'variables' && !workspace.project && (
        <VariablesPanel
          onClose={closePanel}
          usedVariableNames={editor.model.nodes.flatMap((node) =>
            node.data.kind === 'variable' ? [node.data.name] : [],
          )}
          registry={registry.registry}
          onDeclare={registry.declare}
          undeclaredNames={registry.undeclaredNames}
        />
      )}
      {activePanel === 'verify' && selectedRoot && (
        <VerificationPanel
          key={`${selectedRoot.id}:${verificationWorkspace.target.request}`}
          root={selectedRoot}
          target={verificationWorkspace.target}
          semanticSession={verificationWorkspace.semantic}
          coverage={verificationWorkspace.coverage}
          executionPending={verificationWorkspace.pending}
          onOpenTests={verificationWorkspace.project ? () => verificationWorkspace.openEvaluations() : undefined}
          onOpenSettings={verificationWorkspace.project ? () => education.open('settings', 'execution') : undefined}
          text={doc?.text}
          result={registry.displayedVerificationResult}
          onClose={closePanel}
          onDirtyChange={panels.onDirtyChange}
          onRecheck={editor.runVerification}
          onSaveText={doc ? verification.saveText : undefined}
          onSaveDesign={selectedRoot.design ? verification.saveDesign : undefined}
        />
      )}
      {activePanel === 'history' && doc && (
        <HistoryPanel
          rootTitle={selectedRoot?.title ?? doc.rootId}
          commits={drawer.commits}
          error={banners.errorMessage}
          onRetry={drawer.openHistory}
          busy={drawer.busy}
          onRestore={editor.restoreCommit}
          onResetToShipped={editor.resetToShipped}
          onClose={closePanel}
        />
      )}

      {transfer.exportGate && tree && doc && (
        <ExportDialog
          open
          rootTitle={selectedRoot?.title ?? doc.rootId}
          gate={transfer.exportGate}
          sectionCount={tree.children.length}
          variableCount={selectExportVariables(registry.registry, tree.text).length}
          archivePaths={buildExportPreviewPaths({
            tree,
            registry: registry.registry,
            gate: transfer.exportGate,
            design: selectedRoot?.design,
          })}
          onCancel={transfer.close}
          onExport={transfer.confirmExport}
          onExportProjectArchive={history ? transfer.exportProjectArchive : undefined}
        />
      )}

      {/* Hidden file picker the top bar's Import button forwards to (see `useExportImport`). */}
      <input
        ref={transfer.importInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="import-file-input"
        onChange={transfer.handleFilePicked}
      />

      {adoption.initial !== undefined && workspace.project && (
        <AdoptPromptDialog
          initial={adoption.initial ?? undefined}
          definitions={workspace.project.definitions}
          projectFiles={workspace.project.files}
          existingIds={allRoots.map((root) => root.id)}
          onClose={adoption.cancel}
          onAdopt={adoption.save}
        />
      )}
      {newPromptOpen && (
        <NewPromptDialog
          open
          existingIds={allRoots.map((root) => root.id)}
          definitions={workspace.project?.definitions}
          onCreate={onCreatePrompt}
          onCancel={() => onCancelCreate()}
        />
      )}

      {selection.editingSection && (
        <FragmentEditDialog
          open={selection.editingNodeId !== undefined}
          title={selection.editingSection.title}
          initialText={selection.editingSectionText}
          error={selection.editingError}
          knownVariables={registry.knownVariables}
          toolNames={selectedRoot?.toolNames ?? []}
          onApply={selection.applySectionEdit}
          onCancel={selection.cancelEdit}
        />
      )}

      {/* Root-node editor: the WHOLE document as one markdown surface — sections, sub-sections,
          tags, and variables re-derive from the parse on Apply (ADR-202 §3). Same dialog component
          as a section edit, so Raw keeps the token highlighting and Rendered stays available. */}
      {selection.editingRoot && doc && (
        <FragmentEditDialog
          open
          title={`${selectedRoot?.title ?? doc.rootId} — full prompt markdown`}
          initialText={doc.text}
          knownVariables={registry.knownVariables}
          toolNames={selectedRoot?.toolNames ?? []}
          onApply={selection.applyRootEdit}
          onCancel={selection.cancelEdit}
        />
      )}
    </StudioPanelFocus>
  );
}
