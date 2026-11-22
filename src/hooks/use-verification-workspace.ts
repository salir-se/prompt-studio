import { useRef, useState } from 'react';
import type { VerificationRunResult } from '../panels/root-verification';
import { useSemanticReview } from '../panels/verification/use-semantic-review';
import { WHOLE_PROMPT } from '../panels/verification/verification-editing';
import { verificationCoverage } from '../verification/coverage';
import { attributeVerificationToGraphModel, type DocumentEditor } from './use-document-editor';
import type { PanelState } from './use-panel-state';
import type { WorkspaceProjectController } from './use-workspace-project';

export interface VerificationTarget {
  scope: string;
  tab: 'findings' | 'checks' | 'ai';
  request: number;
}
export function useVerificationWorkspace({
  editor,
  workspace,
  panels,
  result,
}: {
  editor: DocumentEditor;
  workspace: WorkspaceProjectController;
  panels: PanelState;
  result: VerificationRunResult | null;
}) {
  const { selectedRoot: root, doc, tree } = editor;
  const document = workspace.project?.documents.find((document) => document.id === doc?.rootId);
  const project =
    workspace.project && document && root?.design
      ? { projectId: workspace.project.projectId, revision: workspace.project.revision, promptPath: document.path }
      : undefined;
  const currentResult =
    result &&
    result.text === doc?.text &&
    (!root?.verification || JSON.stringify(result.profiles) === JSON.stringify(root.verification.profiles))
      ? result
      : null;
  const semantic = useSemanticReview(currentResult, project, root?.id);
  const history = useRef<Record<string, VerificationRunResult>>({});
  const owner = `${workspace.project?.projectId ?? 'catalog'}:${root?.id ?? ''}`;
  if (result) history.current[owner] = result;
  const [target, setTarget] = useState<VerificationTarget>({ scope: WHOLE_PROMPT, tab: 'findings', request: 0 });
  const [runTab, setRunTab] = useState<'suites' | 'compare' | 'settings'>('suites');
  const coverage =
    root && tree
      ? verificationCoverage(root, tree, result ?? history.current[owner] ?? null, semantic.statusBySectionId)
      : undefined;
  return {
    target,
    semantic,
    project,
    coverage,
    runTab,
    pending: !!workspace.pending || !!workspace.error,
    attributed: tree && result ? attributeVerificationToGraphModel(tree, result) : null,
    open(scope = WHOLE_PROMPT, tab: VerificationTarget['tab'] = 'findings') {
      if (!doc || !root || !(panels.activePanel === 'verify' ? panels.confirmDiscard() : panels.openPanel('verify')))
        return;
      editor.runVerification();
      setTarget((previous) => ({ scope, tab, request: previous.request + 1 }));
    },
    toggleEvaluations() {
      if (project) panels.toggleEvaluations();
    },
    openEvaluations(tab: 'suites' | 'compare' | 'settings' = 'suites') {
      if (!project || !panels.openPanel('evaluate')) return;
      setRunTab(tab);
    },
  };
}
export type VerificationWorkspace = ReturnType<typeof useVerificationWorkspace>;
