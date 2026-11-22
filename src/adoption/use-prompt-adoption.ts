import { useState } from 'react';
import type { CatalogRoot } from '../catalog/root-catalog';
import type { DocumentEditor } from '../hooks/use-document-editor';
import type { HistoryBoot } from '../hooks/use-history-boot';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import type { AdoptionInitial } from './AdoptPromptDialog';
import type { AdoptionResult } from './adopt-prompt';
import { saveAdoption } from './save-adoption';

export function usePromptAdoption({
  boot,
  editor,
  workspace,
  canOpen,
  onAdopted,
}: {
  boot: HistoryBoot;
  editor: DocumentEditor;
  workspace: WorkspaceProjectController;
  canOpen: () => boolean;
  onAdopted: (root: CatalogRoot, result: AdoptionResult) => void;
}) {
  const [initial, setInitial] = useState<AdoptionInitial | null | undefined>();
  return {
    initial,
    open(adapt = false) {
      if (!workspace.project || !canOpen()) return;
      const { doc, selectedRoot } = editor;
      const file = workspace.project.documents.find((candidate) => candidate.id === selectedRoot?.id);
      setInitial(
        adapt && doc && selectedRoot && file
          ? {
              text: doc.text,
              filename: file.path,
              existing: { id: selectedRoot.id, title: selectedRoot.title, design: selectedRoot.design },
            }
          : null,
      );
    },
    cancel() {
      setInitial(undefined);
    },
    async save(input: AdoptionResult) {
      const root = await saveAdoption(input, boot, workspace, initial?.existing ? initial.filename : undefined);
      setInitial(undefined);
      onAdopted(root, input);
    },
  };
}
export type PromptAdoption = ReturnType<typeof usePromptAdoption>;
