import type { CatalogRoot } from '../catalog/root-catalog';
import { promptDesignProviderKey, serializePromptDesign } from '../design/prompt-design-project';
import type { HistoryBoot } from '../hooks/use-history-boot';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import type { AdoptionResult } from './adopt-prompt';
import { assertAdoptionDestinations } from './adoption-destinations';

/** One durable draft contains source, design, definitions and supplied references. */
export async function saveAdoption(
  input: AdoptionResult,
  boot: HistoryBoot,
  workspace: WorkspaceProjectController,
  existingPath?: string,
): Promise<CatalogRoot> {
  const history = boot.history;
  if (!history || !workspace.project) throw new Error('Open a project before adding a prompt.');
  const archive = await workspace.exportProject();
  assertAdoptionDestinations(input.documents, archive, existingPath);
  await workspace.draft({ documents: input.documents, definitions: input.definitions });
  await history.provider.commit({
    projectId: history.activeProjectId,
    rootKey: input.id,
    text: input.text,
    message: `adopt prompt ${input.id}`,
  });
  await history.provider.commit({
    projectId: history.activeProjectId,
    rootKey: promptDesignProviderKey(input.id),
    text: serializePromptDesign(input.design),
    message: `define adopted prompt ${input.id}`,
  });
  await history.provider.persist();
  await workspace.save(`Adopt prompt ${input.id}`);
  const roots = await boot.refreshAuthoredRoots(history.activeProjectId);
  const root = roots.find((candidate) => candidate.id === input.id);
  if (!root) throw new Error('The prompt was saved but could not be opened. Reopen the project to continue.');
  return root;
}
