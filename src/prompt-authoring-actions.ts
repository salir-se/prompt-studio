import type { PromptDesign } from '@prompt-studio/prompts';
import type { CatalogRoot } from './catalog/root-catalog';
import type { NewPromptInput } from './design/NewPromptDialog';
import { promptDesignProviderKey, serializePromptDesign } from './design/prompt-design-project';
import type { Banners } from './hooks/use-banners';
import type { DocumentEditor } from './hooks/use-document-editor';
import type { HistoryBoot } from './hooks/use-history-boot';
import type { WorkspaceProjectController } from './hooks/use-workspace-project';
import { validateProjectDefinitions } from './prompt-repo/project-definitions';
import {
  loadPromptRepository,
  savePromptVersion,
  studioJson,
  type WorkspaceProject,
} from './prompt-repo/prompt-repo-client';
import { createWorkspacePrompt, workspaceFileForDesign, workspaceFileForRoot } from './prompt-repo/workspace-document';

/** Verification repair retains its workspace while recovering this tab's guarded pending writes. */
export function createVerificationActions({
  editor,
  workspace,
  banners,
  onSaveDesign,
}: {
  editor: DocumentEditor;
  workspace: WorkspaceProjectController;
  banners: Banners;
  onSaveDesign: (design: PromptDesign) => Promise<void>;
}) {
  async function recover() {
    if (workspace.error && workspace.exportRecovery().patches.length) await workspace.retry({ keepEditor: true });
  }
  return {
    async saveText(text: string) {
      await recover();
      await editor.commitUndoableEdit(text, 'repair prompt from verification');
      banners.setErrorMessage(null);
    },
    async saveDesign(design: PromptDesign) {
      await recover();
      await onSaveDesign(design);
      banners.setErrorMessage(null);
    },
  };
}

/** Authored prompt commands share the existing history and durable-project mutation boundaries. */
export function createPromptAuthoringActions({
  boot,
  editor,
  workspace,
  banners,
  onCreated,
}: {
  boot: HistoryBoot;
  editor: DocumentEditor;
  workspace: WorkspaceProjectController;
  banners: Banners;
  onCreated: (root: CatalogRoot) => void;
}) {
  const { history } = boot;
  const { doc, selectedRoot } = editor;
  async function handleCreatePrompt(input: NewPromptInput): Promise<void> {
    if (!history) return;
    const configuration = history.projects.find((project) => project.id === history.activeProjectId)?.name ?? 'Default';
    try {
      let project = workspace.project;
      if (project) {
        if (workspace.error || workspace.exportRecovery().patches.length) await workspace.retry({ keepEditor: true });
        else await workspace.flush();
        const latest = await studioJson<WorkspaceProject>('/__studio/prompt-repo');
        if (!latest.open || latest.projectId !== project.projectId)
          throw new Error('A different project is open. Reopen your original project before creating this prompt.');
        project = latest;
      }
      const variableDefinition =
        project?.definitions.variables.find((entry) => entry.name === input.variable) ?? input.variableDefinition;
      const toolDefinition =
        project?.definitions.tools.find((entry) => entry.name === input.tool) ?? input.toolDefinition;
      if (variableDefinition || toolDefinition)
        validateProjectDefinitions({
          format: 'prompt-studio-project@1',
          name: input.title,
          variables: variableDefinition ? [variableDefinition] : [],
          tools: toolDefinition ? [toolDefinition] : [],
        });
      const created = createWorkspacePrompt({
        id: input.id,
        title: input.title,
        requestField: input.requestField,
        configuration,
        tool: input.tool,
        variable: input.variable,
        variableDefinition,
      });
      await history.provider.commit({
        projectId: history.activeProjectId,
        rootKey: input.id,
        text: created.text,
        message: `create prompt ${input.id}`,
      });
      await history.provider.commit({
        projectId: history.activeProjectId,
        rootKey: promptDesignProviderKey(input.id),
        text: serializePromptDesign(created.design),
        message: `define prompt ${input.id}`,
      });
      await history.provider.persist();
      if (project) {
        const definitions = project.definitions;
        const variables = [...definitions.variables];
        for (const variable of created.design.variables) {
          if (variable.name !== 'configuration' && !variables.some((known) => known.name === variable.name))
            variables.push(variable);
        }
        const tools = [...definitions.tools];
        if (input.tool && !tools.some((tool) => tool.name === input.tool))
          tools.push(
            toolDefinition ?? {
              name: input.tool,
              description: `Tool ${input.tool} available to this project.`,
              inputSchema: { type: 'object', properties: {} },
            },
          );
        await workspace.draft({ documents: [created.document], definitions: { ...definitions, variables, tools } });
        await workspace.save(`Create prompt ${input.id}`);
      } else {
        const opened = await loadPromptRepository();
        if (opened.open) {
          const saved = await savePromptVersion([created.document], `create prompt ${input.id}`);
          if (!saved.ok) throw new Error(saved.error ?? 'Could not save the prompt to the repository.');
        }
      }
      const roots = await boot.refreshAuthoredRoots(history.activeProjectId);
      const root = roots.find((candidate) => candidate.id === input.id);
      if (!root) throw new Error(`Created prompt ${input.id} could not be loaded.`);
      onCreated(root);
      banners.setErrorMessage(null);
      banners.setNoticeMessage(`Created "${input.title}". Write your prompt; new sections are set up automatically.`);
    } catch (error) {
      banners.setErrorMessage(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function handleSaveDesign(design: PromptDesign): Promise<void> {
    if (!history || !selectedRoot?.design) return;
    try {
      await history.provider.commit({
        projectId: history.activeProjectId,
        rootKey: promptDesignProviderKey(design.id),
        text: serializePromptDesign(design),
        message: `update prompt design ${design.id}@${design.version}`,
      });
      await history.provider.persist();
      // Later text edits must serialize the latest local design even if the durable draft fails.
      await boot.refreshAuthoredRoots(history.activeProjectId);
      if (workspace.project) {
        const existing = workspace.project.documents.find((document) => document.id === design.id);
        await workspace.draft({
          documents: [workspaceFileForRoot({ id: design.id, design }, doc?.text ?? '', existing)],
        });
      } else {
        const opened = await loadPromptRepository();
        if (opened.open) {
          const saved = await savePromptVersion(
            [workspaceFileForDesign(design, doc?.text ?? '', 'Default')],
            `update prompt design ${design.id}`,
          );
          if (!saved.ok) throw new Error(saved.error ?? 'Could not save the prompt to the repository.');
        }
      }
    } catch (error) {
      banners.setErrorMessage(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  return { create: handleCreatePrompt, saveDesign: handleSaveDesign };
}
